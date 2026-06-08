import json
import os
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import requests


TRUE_VALUES = {"true", "1", "yes", "on"}
DEFAULT_TRACE_DIR = "debug_traces"
SENSITIVE_KEY_RE = re.compile(
    r"(?:base64|b64|idpic|image|face|photo|portrait|picture|compress|blob)",
    re.IGNORECASE,
)
SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
TRACE_INDEX_NAME = ".trace-runs.json"
OMITTED_IMAGE_PAYLOAD = "[omitted from trace: sensitive encoded image payload]"


def _env_flag(name: str, default: str = "false") -> bool:
    return os.environ.get(name, default).strip().lower() in TRUE_VALUES


def is_trace_enabled() -> bool:
    return _env_flag("OCR_TRACE_MODE")


def is_auto_ocr_enabled() -> bool:
    return _env_flag("OCR_TRACE_AUTO_OCR")


def sanitize_name(value: Any) -> str:
    text = str(value or "").strip().replace("\\", "/").split("/")[-1]
    text = SAFE_NAME_RE.sub("-", text).strip(".-_")
    return text or "unknown"


def _trace_root() -> Path:
    return Path(os.environ.get("OCR_TRACE_DIR", DEFAULT_TRACE_DIR)).expanduser().resolve()


def _timestamp_id() -> str:
    now = datetime.now()
    return f"{now:%Y%m%d-%H%M%S}-{int(now.microsecond / 1000):03d}"


def create_trace_run_dir(api_id: str | None = None) -> Path | None:
    if not is_trace_enabled():
        return None
    root = _trace_root()
    folder = f"{_timestamp_id()}-{sanitize_name(api_id)}"
    run_dir = root / folder
    run_dir.mkdir(parents=True, exist_ok=False)
    return run_dir


def get_or_create_trace_run_dir(api_id: str | None = None, trace_run_id: str | None = None) -> Path | None:
    if not is_trace_enabled():
        return None
    if not trace_run_id:
        return create_trace_run_dir(api_id)

    root = _trace_root()
    root.mkdir(parents=True, exist_ok=True)
    index_path = root / TRACE_INDEX_NAME
    run_key = sanitize_name(trace_run_id)
    index = _read_json(index_path, {})
    existing = index.get(run_key)
    if existing:
        run_dir = Path(existing)
        if run_dir.exists():
            return run_dir

    run_dir = create_trace_run_dir(api_id or "unknown")
    if run_dir:
        index[run_key] = str(run_dir)
        _write_json(index_path, index)
    return run_dir


def _read_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _target_path(run_dir: Path, stage: str, filename: str) -> Path:
    safe_stage = sanitize_name(stage)
    safe_filename = sanitize_name(filename)
    name = safe_filename if safe_filename.startswith(safe_stage) else f"{safe_stage}-{safe_filename}"
    return run_dir / name


def save_trace_file(run_dir: Path | None, stage: str, filename: str, content: bytes) -> str | None:
    if not is_trace_enabled() or not run_dir:
        return None
    path = _target_path(Path(run_dir), stage, filename)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content or b"")
    return str(path)


def save_trace_json(run_dir: Path | None, stage: str, filename: str, data: Any) -> str | None:
    if not is_trace_enabled() or not run_dir:
        return None
    path = _target_path(Path(run_dir), stage, filename)
    _write_json(path, sanitize_trace_data(data))
    return str(path)


def append_trace_meta(run_dir: Path | None, data: dict[str, Any]) -> str | None:
    if not is_trace_enabled() or not run_dir:
        return None
    path = Path(run_dir) / "trace-meta.json"
    records = _read_json(path, [])
    if not isinstance(records, list):
        records = []
    record = {
        "timestamp": datetime.now().isoformat(timespec="milliseconds"),
        **sanitize_trace_data(data),
    }
    records.append(record)
    _write_json(path, records)
    return str(path)


def sanitize_trace_data(value: Any, key: str = "") -> Any:
    if SENSITIVE_KEY_RE.search(str(key)):
        return OMITTED_IMAGE_PAYLOAD
    if isinstance(value, dict):
        return {str(k): sanitize_trace_data(v, str(k)) for k, v in value.items()}
    if isinstance(value, list):
        return [sanitize_trace_data(item, key) for item in value]
    if isinstance(value, str):
        text = value.strip()
        if _looks_like_encoded_image_payload(text):
            return OMITTED_IMAGE_PAYLOAD
        if len(text) > 20000:
            return f"{text[:4000]}... [trace truncated {len(text) - 4000} chars]"
    return value


def _looks_like_encoded_image_payload(text: str) -> bool:
    if len(text) < 240:
        return False
    if text.lower().startswith("data:image/"):
        return True
    compact = re.sub(r"\s+", "", text)
    if len(compact) < 240 or len(compact) % 4 != 0:
        return False
    return bool(re.fullmatch(r"[A-Za-z0-9+/]+={0,2}", compact))


def run_postman_like_ocr(
    api_config: dict[str, Any] | None,
    api_id: str,
    file_bytes: bytes,
    filename: str,
    content_type: str,
    run_dir: Path | None,
    stage: str,
) -> str | None:
    if not is_trace_enabled() or not is_auto_ocr_enabled() or not run_dir:
        return None
    started = time.perf_counter()
    response_file = f"{sanitize_name(stage)}-postman-response.json"

    if not api_config:
        return save_trace_json(run_dir, stage, response_file, {"error": "Unknown OCR API config", "apiId": api_id})

    endpoint = api_config.get("endpoint")
    form_file_key = api_config.get("form_file_key") or "file"
    auth_env_key = api_config.get("auth_env_key")
    token = os.environ.get(auth_env_key or "", "")
    headers = {}
    if auth_env_key:
        if not token:
            return save_trace_json(
                run_dir,
                stage,
                response_file,
                {"error": f"Missing server environment variable: {auth_env_key}", "apiId": api_id},
            )
        headers[api_config.get("auth_header_name", "Authorization")] = token

    try:
        response = requests.post(
            endpoint,
            files={form_file_key: (filename, file_bytes, content_type or "application/octet-stream")},
            data=api_config.get("extra_form_fields", {}),
            headers=headers,
            timeout=45,
        )
        runtime_ms = round((time.perf_counter() - started) * 1000)
        append_trace_meta(
            run_dir,
            {
                "stage": f"{stage}-postman",
                "apiId": api_id,
                "filename": filename,
                "fileSize": len(file_bytes or b""),
                "contentType": content_type,
                "statusCode": response.status_code,
                "runtimeMs": runtime_ms,
                "endpointGroup": endpoint,
            },
        )
        return save_trace_json(
            run_dir,
            stage,
            response_file,
            {
                "statusCode": response.status_code,
                "runtimeMs": runtime_ms,
                "contentType": response.headers.get("Content-Type", ""),
                "body": _response_body(response),
            },
        )
    except Exception as exc:
        runtime_ms = round((time.perf_counter() - started) * 1000)
        append_trace_meta(
            run_dir,
            {
                "stage": f"{stage}-postman-error",
                "apiId": api_id,
                "filename": filename,
                "fileSize": len(file_bytes or b""),
                "contentType": content_type,
                "runtimeMs": runtime_ms,
                "endpointGroup": endpoint,
            },
        )
        return save_trace_json(
            run_dir,
            stage,
            response_file,
            {"error": str(exc), "runtimeMs": runtime_ms, "apiId": api_id},
        )


def _response_body(response: requests.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        text = response.text or ""
        return {"textPreview": text[:4000], "textLength": len(text)}
