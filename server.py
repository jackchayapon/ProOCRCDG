import os
from email.parser import BytesParser
from email.policy import default
from functools import partial
from pathlib import Path
import json
import requests
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.concurrency import run_in_threadpool
import re
import unicodedata

ROOT = Path(__file__).resolve().parent
FRONTEND_ROOT = Path(os.environ.get("FRONTEND_ROOT", ROOT)).resolve()
LEGACY_FRONTEND_ROOT = ROOT.parent / "Frontend"
if not (FRONTEND_ROOT / "index.html").exists() and (LEGACY_FRONTEND_ROOT / "index.html").exists():
    FRONTEND_ROOT = LEGACY_FRONTEND_ROOT


def load_env_file(path):
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


load_env_file(ROOT.parent / ".env")
load_env_file(ROOT / ".env")

HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "3000"))
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
REQUEST_TIMEOUT_SECONDS = 45
WEBSOLUTION_BASE_URL = os.environ.get("WEBSOLUTION_BASE_URL", "https://websolution.cdgs.co.th").rstrip("/")
PREPROCESS_TARGETS = {
    "idCard": (1000, 630),
    "passport": (1000, 700),
}
# Keep upstream routing and secrets on the server. The browser sends only apiId and a file.
PROXY_APIS = {
    "front-id": {
        "endpoint": f"{WEBSOLUTION_BASE_URL}/ocr/id",
        "form_file_key": "image_file[]",
    },
    "front-id-custom": {
        "endpoint": f"{WEBSOLUTION_BASE_URL}/ocrmid/",
        "form_file_key": "image_file[]",
        "extra_form_fields": {"type": "id"},
    },
    "front-id-other": {
        "endpoint": "https://facepoc.cdgs.co.th/ocr/api/v1/upload_front_file",
        "form_file_key": "file",
        "auth_header_name": "Authorization",
        "auth_env_key": "OCR_OTHER_AUTH_TOKEN",
    },
    "back-id": {
        "endpoint": f"{WEBSOLUTION_BASE_URL}/ocr/back_id",
        "form_file_key": "image_file[]",
    },
    "back-id-custom": {
        "endpoint": f"{WEBSOLUTION_BASE_URL}/ocrmid/",
        "form_file_key": "image_file[]",
        "extra_form_fields": {"type": "backid"},
    },
    "back-id-other": {
        "endpoint": "https://facepoc.cdgs.co.th/ocr/api/v1/upload_back_file",
        "form_file_key": "file",
        "auth_header_name": "Authorization",
        "auth_env_key": "OCR_OTHER_AUTH_TOKEN",
    },
    "passport": {
        "endpoint": f"{WEBSOLUTION_BASE_URL}/ocr/passport",
        "form_file_key": "image_file[]",
    },
    "passport-custom": {
        "endpoint": f"{WEBSOLUTION_BASE_URL}/ocrmid/",
        "form_file_key": "image_file[]",
        "extra_form_fields": {"type": "passport"},
    },
    "custom-document": {
        "endpoint": f"{WEBSOLUTION_BASE_URL}/ocr/custom",
        "form_file_key": "image_file[]",
    },
}

KEY_TRANSLATION_PROFILES: dict[str, dict[str, str]] = {
    "front-id": {
        "IdNumber": "เลขประจำตัวประชาชน",
        "NameLastnameThai": "ชื่อ-นามสกุล (ไทย)",
        "NameThai": "ชื่อ (ไทย)",
        "LastnameThai": "นามสกุล (ไทย)",
        "NameEnglish": "ชื่อ (อังกฤษ)",
        "NameLastnameEnglish": "ชื่อ-นามสกุล (อังกฤษ)",
        "DateOfBirth": "วันเกิด", "DOB": "วันเกิด", "BirthDate": "วันเกิด",
        "Religion": "ศาสนา", "Address": "ที่อยู่",
        "IssueDate": "วันออกบัตร", "DOI": "วันออกบัตร",
        "ExpiryDate": "วันหมดอายุ", "ExpireDate": "วันหมดอายุ", "DOE": "วันหมดอายุ",
        "Title": "คำนำหน้า", "Gender": "เพศ",
    },
    "front-id-custom": {
        "IdNumber": "เลขประจำตัวประชาชน",
        "NameLastnameThai": "ชื่อ-นามสกุล (ไทย)",
        "NameThai": "ชื่อ (ไทย)",
        "LastnameThai": "นามสกุล (ไทย)",
        "NameEnglish": "ชื่อ (อังกฤษ)",
        "NameLastnameEnglish": "ชื่อ-นามสกุล (อังกฤษ)",
        "DateOfBirth": "วันเกิด", "DOB": "วันเกิด", "BirthDate": "วันเกิด",
        "Religion": "ศาสนา", "Address": "ที่อยู่",
        "IssueDate": "วันออกบัตร", "DOI": "วันออกบัตร",
        "ExpiryDate": "วันหมดอายุ", "ExpireDate": "วันหมดอายุ", "DOE": "วันหมดอายุ",
        "Title": "คำนำหน้า", "Gender": "เพศ",
    },
    "front-id-other": {
        "id_number": "เลขประจำตัวประชาชน",
        "name": "ชื่อ-นามสกุล",
        "dob": "วันเกิด", "doi": "วันออกบัตร", "doe": "วันหมดอายุ",
        "address": "ที่อยู่",
    },
    "back-id": {
        "BACK_id": "เลขหลังบัตร",
    },
    "back-id-custom": {
        "BACK_id": "เลขหลังบัตร",
    },
    "back-id-other": {
        "LaserCode": "เลขหลังบัตร", 
    },
    "passport": {
        "P_no": "เลขพาสปอร์ต",
        "P_type": "ประเภทเอกสาร",
        "Name_eng": "ชื่อ (อังกฤษ)",
        "Name_tha": "ชื่อ (ไทย)",
        "Surname_eng": "นามสกุล (อังกฤษ)",
        "Id_no": "เลขประจำตัวประชาชน",
        "Pob": "สถานที่เกิด",
        "Country": "ประเทศที่ออก",
        "Code1": "MRZ บรรทัด 1",
        "Code2": "MRZ บรรทัด 2",
        "Height": "ส่วนสูง",
        "Nationality": "สัญชาติ",
        "DateOfBirth": "วันเกิด", "DOB": "วันเกิด", "Dob": "วันเกิด",
        "Sex": "เพศ", "Gender": "เพศ",
        "IssueDate": "วันออกเอกสาร", "DOI": "วันออกเอกสาร","Doi": "วันออกเอกสาร",
        "ExpiryDate": "วันหมดอายุ", "DOE": "วันหมดอายุ","Doe": "วันหมดอายุ",

   
    },
    "passport-custom": {
        "P_no": "เลขพาสปอร์ต",
        "P_type": "ประเภทเอกสาร",
        "Name_eng": "ชื่อ (อังกฤษ)",
        "Name_tha": "ชื่อ (ไทย)",
        "Surname_eng": "นามสกุล (อังกฤษ)",
        "Id_no": "เลขประจำตัวประชาชน",
        "Pob": "สถานที่เกิด",
        "Country": "ประเทศที่ออก",
        "Code1": "MRZ บรรทัด 1",
        "Code2": "MRZ บรรทัด 2",
        "Height": "ส่วนสูง",
        "Nationality": "สัญชาติ",
        "DateOfBirth": "วันเกิด", "DOB": "วันเกิด", "Dob": "วันเกิด",
        "Sex": "เพศ", "Gender": "เพศ",
        "IssueDate": "วันออกเอกสาร", "DOI": "วันออกเอกสาร","Doi": "วันออกเอกสาร",
        "ExpiryDate": "วันหมดอายุ", "DOE": "วันหมดอายุ","Doe": "วันหมดอายุ",
        "mrz":"MRZ",
    },
}

FIELD_ORDER_PROFILES: dict[str, list[str]] = {
    "front-id": [
        "เลขประจำตัวประชาชน", "คำนำหน้า",
        "ชื่อ (ไทย)", "ชื่อ-นามสกุล (ไทย)", "นามสกุล (ไทย)",
        "ชื่อ (อังกฤษ)", "ชื่อ-นามสกุล (อังกฤษ)",
        "วันเกิด", "ศาสนา", "ที่อยู่", "วันออกบัตร", "วันหมดอายุ",
    ],
    "front-id-custom": [
        "เลขประจำตัวประชาชน", "คำนำหน้า",
        "ชื่อ (ไทย)", "ชื่อ-นามสกุล (ไทย)", "นามสกุล (ไทย)",
        "ชื่อ (อังกฤษ)", "ชื่อ-นามสกุล (อังกฤษ)",
        "วันเกิด", "ศาสนา", "ที่อยู่", "วันออกบัตร", "วันหมดอายุ",
    ],
    "front-id-other": [
        "เลขประจำตัวประชาชน", "ชื่อ-นามสกุล",
        "วันเกิด", "ที่อยู่", "วันออกบัตร", "วันหมดอายุ",
    ],
    "back-id": [
        "เลขหลังบัตร", 
    ],
    "back-id-custom": [
        "เลขหลังบัตร", 
    ],
    "back-id-other": [
        "เลขหลังบัตร", 
    ],
    "passport": [
        "ประเภทเอกสาร",
        "ประเทศที่ออก",
        "เลขพาสปอร์ต",
        "นามสกุล (อังกฤษ)",
        "ชื่อ (อังกฤษ)",
        "ชื่อ (ไทย)",
        "สัญชาติ",
        "วันเกิด",
        "เลขประจำตัวประชาชน",
        "เพศ",
        "ส่วนสูง",
        "สถานที่เกิด",
        "วันออกเอกสาร",
        "วันหมดอายุ",
        "MRZ บรรทัด 1",
        "MRZ บรรทัด 2",
    ],
    "passport-custom": [
        "ประเภทเอกสาร",
        "ประเทศที่ออก",
        "เลขพาสปอร์ต",
        "นามสกุล (อังกฤษ)",
        "ชื่อ (อังกฤษ)",
        "ชื่อ (ไทย)",
        "สัญชาติ",
        "วันเกิด",
        "เลขประจำตัวประชาชน",
        "เพศ",
        "ส่วนสูง",
        "สถานที่เกิด",
        "วันออกเอกสาร",
        "วันหมดอายุ",
        "MRZ บรรทัด 1",
        "MRZ บรรทัด 2",
    ],

}

ID_CARD_LABEL_ALIASES = {
    "IdNumber": "เลขประจำตัวประชาชน",
    "id_number": "เลขประจำตัวประชาชน",
    "Dob": "วันเกิด",
    "DOB": "วันเกิด",
    "DobThai": "วันเกิด (ไทย)",
    "DateOfBirth": "วันเกิด",
    "BirthDate": "วันเกิด",
    "Doi": "วันออกบัตร",
    "DOI": "วันออกบัตร",
    "DoiThai": "วันออกบัตร (ไทย)",
    "IssueDate": "วันออกบัตร",
    "Doe": "วันหมดอายุ",
    "DOE": "วันหมดอายุ",
    "DoeThai": "วันหมดอายุ (ไทย)",
    "ExpiryDate": "วันหมดอายุ",
    "ExpireDate": "วันหมดอายุ",
    "NameEng": "ชื่อ (อังกฤษ)",
    "NameEnglish": "ชื่อ (อังกฤษ)",
    "LastnameEng": "นามสกุล (อังกฤษ)",
    "LastnameEnglish": "นามสกุล (อังกฤษ)",
    "NameLastnameThai": "ชื่อ-นามสกุล (ไทย)",
    "NameThai": "ชื่อ (ไทย)",
    "LastnameThai": "นามสกุล (ไทย)",
    "religion": "ศาสนา",
    "Religion": "ศาสนา",
    "adr1": "ที่อยู่บรรทัด 1",
    "adr2": "ที่อยู่บรรทัด 2",
    "Address": "ที่อยู่",
    "SN": "เลขควบคุม",
}

ID_CARD_FIELD_ORDER = [
    "เลขประจำตัวประชาชน",
    "ชื่อ-นามสกุล (ไทย)",
    "ชื่อ (ไทย)",
    "นามสกุล (ไทย)",
    "ชื่อ (อังกฤษ)",
    "นามสกุล (อังกฤษ)",
    "วันเกิด",
    "วันเกิด (ไทย)",
    "ศาสนา",
    "ที่อยู่",
    "ที่อยู่บรรทัด 1",
    "ที่อยู่บรรทัด 2",
    "วันออกบัตร",
    "วันออกบัตร (ไทย)",
    "วันหมดอายุ",
    "วันหมดอายุ (ไทย)",
    "เลขควบคุม",
]

FRONT_ID_API_IDS = {"front-id", "front-id-custom", "front-id-other"}
BACK_ID_API_IDS = {"back-id", "back-id-custom", "back-id-other"}
STATIC_FILES = {
    "/": "index.html",
    "/index.html": "index.html",
    "/styles.css": "styles.css",
    "/app.js": "app.js",
}
app = FastAPI(title="OCR Document Capture", version="1.0.0")
# ---------------------------------------------------------------------------
# OCR Post-process helpers
# ---------------------------------------------------------------------------


SENSITIVE_KEY_RE = re.compile(
    r"(?:b64|base64|compress|portrait|image_blob|image_data|idpic|face|photo)",
    re.IGNORECASE,
)


def _translate_keys(value, key_map: dict, changes: list, depth: int = 0):
    if depth > 10:
        return value
    if isinstance(value, list):
        return [_translate_keys(item, key_map, changes, depth + 1) for item in value]
    if isinstance(value, dict):
        result = {}
        for k, v in value.items():
            new_k = key_map.get(str(k), k)
            if new_k != k:
                changes.append(f"renamed: {k} → {new_k}")
            result[new_k] = _translate_keys(v, key_map, changes, depth + 1)
        return result
    return value


def _order_key(value) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", str(value))).strip()


def _reorder_fields(value, field_order: list):
    if isinstance(value, list):
        return [_reorder_fields(item, field_order) for item in value]
    if isinstance(value, dict):
        idx = {}
        for i, name in enumerate(field_order):
            idx.setdefault(_order_key(name), i)
        known = {k: v for k, v in value.items() if _order_key(k) in idx}
        unknown = {k: v for k, v in value.items() if _order_key(k) not in idx}
        merged = dict(sorted(known.items(), key=lambda x: idx[_order_key(x[0])]))
        merged.update(unknown)
        return {k: _reorder_fields(v, field_order) for k, v in merged.items()}
    return value


def postprocess_ocr(raw_payload: dict, api_id: str = "") -> dict:
    changes: list[str] = []

    key_map = KEY_TRANSLATION_PROFILES.get(api_id, {})
    if api_id in FRONT_ID_API_IDS:
        key_map = {**key_map, **ID_CARD_LABEL_ALIASES}
    translated = _translate_keys(raw_payload, key_map, changes) if key_map else raw_payload

    field_order = FIELD_ORDER_PROFILES.get(api_id, [])
    if api_id in FRONT_ID_API_IDS:
        field_order = [*ID_CARD_FIELD_ORDER, *field_order]
    reordered = _reorder_fields(translated, field_order) if field_order else translated

    if key_map:
        changes.append(f"key translation profile: {api_id}")
    if field_order:
        changes.append(f"field order profile: {api_id}")

    unique_changes = list(dict.fromkeys(changes))
    return {
        "normalized": reordered,
        "originalKeys": list(raw_payload.keys()) if isinstance(raw_payload, dict) else [],
        "changes": unique_changes,
        "apiId": api_id or None,
        "summary": (
            f"Applied {len(unique_changes)} change(s)" if unique_changes else "No changes"
        ),
    }



def no_store_json(status_code, payload):
    return JSONResponse(
        status_code=status_code,
        content=payload,
        headers={"Cache-Control": "no-store"},
    )


def parse_content_length(request):
    raw_value = request.headers.get("content-length", "0")
    try:
        return int(raw_value)
    except ValueError:
        return 0


def get_preprocess_target(fields):
    api_id = fields.get("apiId", "")
    frame_preset = fields.get("framePreset", "")
    if frame_preset == "passport" or api_id.startswith("passport"):
        return PREPROCESS_TARGETS["passport"]
    if frame_preset == "idCard" or api_id.startswith("front-id") or api_id.startswith("back-id"):
        return PREPROCESS_TARGETS["idCard"]
    return None


def cv2_preprocess_image(image_bytes, target_size):
    try:
        import cv2
        import numpy as np
    except ImportError as exc:
        raise RuntimeError("OpenCV is not installed. Install opencv-python-headless and numpy.") from exc

    raw = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(raw, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Cannot decode uploaded image")

    warnings = []
    meta = {"inputWidth": int(image.shape[1]), "inputHeight": int(image.shape[0])}
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blur_score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    brightness = float(gray.mean())
    contrast = float(gray.std())
    glare_ratio = float((gray > 245).mean())
    meta.update(
        {
            "blurScore": round(blur_score, 2),
            "brightness": round(brightness, 2),
            "contrast": round(contrast, 2),
            "glareRatio": round(glare_ratio, 4),
        }
    )

    if blur_score < 70:
        warnings.append("ภาพอาจเบลอ ควรถ่ายใหม่หรือใช้ภาพความละเอียดสูงขึ้น")
    if brightness < 75:
        warnings.append("ภาพค่อนข้างมืด ระบบปรับแสงให้ก่อนส่ง OCR แล้ว")
    elif brightness > 215:
        warnings.append("ภาพค่อนข้างสว่างมาก อาจมีส่วนรายละเอียดหาย")
    if contrast < 28:
        warnings.append("ภาพ contrast ต่ำ ระบบเพิ่ม contrast ให้ก่อนส่ง OCR แล้ว")
    if glare_ratio > 0.035:
        warnings.append("ตรวจพบพื้นที่สว่างจ้าหรือแสงสะท้อน อาจทำให้ OCR อ่านบางจุดผิด")

    if target_size:
        target_w, target_h = target_size
        image_h, image_w = image.shape[:2]
        target_ratio = target_w / target_h
        image_ratio = image_w / max(1, image_h)
        if target_ratio > 1 and image_ratio < 0.85:
            image = cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
            warnings.append("ระบบหมุนภาพให้ตรงกับแนวเอกสารก่อนส่ง OCR")

    image = enhance_for_ocr_cv2(image, cv2, np)
    if target_size:
        image = resize_to_target_canvas_cv2(image, target_size, cv2, np)

    ok, encoded = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), 94])
    if not ok:
        raise ValueError("Cannot encode preprocessed image")

    meta.update({"outputWidth": int(image.shape[1]), "outputHeight": int(image.shape[0]), "format": "image/jpeg"})
    return encoded.tobytes(), warnings, meta


def enhance_for_ocr_cv2(image, cv2, np):
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    lightness, channel_a, channel_b = cv2.split(lab)

    sigma = max(18, int(max(image.shape[:2]) / 28))
    background = cv2.GaussianBlur(lightness, (0, 0), sigmaX=sigma, sigmaY=sigma)
    normalized = cv2.divide(lightness, background, scale=255)
    clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8))
    enhanced_lightness = clahe.apply(normalized)

    merged = cv2.merge((enhanced_lightness, channel_a, channel_b))
    enhanced = cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)
    denoised = cv2.fastNlMeansDenoisingColored(enhanced, None, 4, 4, 7, 21)
    blurred = cv2.GaussianBlur(denoised, (0, 0), sigmaX=1.0)
    sharpened = cv2.addWeighted(denoised, 1.45, blurred, -0.45, 0)
    return np.clip(sharpened, 0, 255).astype("uint8")


def resize_to_target_canvas_cv2(image, target_size, cv2, np):
    target_w, target_h = target_size
    image_h, image_w = image.shape[:2]
    scale = min(target_w / image_w, target_h / image_h)
    resized_w = max(1, int(round(image_w * scale)))
    resized_h = max(1, int(round(image_h * scale)))
    interpolation = cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA
    resized = cv2.resize(image, (resized_w, resized_h), interpolation=interpolation)
    canvas = np.full((target_h, target_w, 3), 255, dtype=np.uint8)
    x = (target_w - resized_w) // 2
    y = (target_h - resized_h) // 2
    canvas[y : y + resized_h, x : x + resized_w] = resized
    return canvas

@app.get("/api/ocr/status")
def get_ocr_status():
    return no_store_json(
        200,
        {
            "apis": {
                api_id: {
                    "available": not api.get("auth_env_key") or bool(os.environ.get(api["auth_env_key"])),
                    "authRequired": bool(api.get("auth_env_key")),
                }
                for api_id, api in PROXY_APIS.items()
            }
        },
    )

@app.post("/api/image/preprocess")
async def preprocess_image_request(request: Request):
    content_type = request.headers.get("content-type", "")
    if not content_type.startswith("multipart/form-data;"):
        return no_store_json(400, {"error": "Expected multipart/form-data"})

    if parse_content_length(request) > MAX_UPLOAD_BYTES:
        return no_store_json(413, {"error": "Uploaded file is too large"})

    body = await request.body()
    if len(body) > MAX_UPLOAD_BYTES:
        return no_store_json(413, {"error": "Uploaded file is too large"})

    fields, uploads = parse_multipart_body(body, content_type)
    upload = uploads[0] if uploads else None
    if upload is None:
        return no_store_json(400, {"error": "Missing uploaded file"})

    if len(upload["content"]) > MAX_UPLOAD_BYTES:
        return no_store_json(413, {"error": "Uploaded file is too large"})

    target_size = get_preprocess_target(fields)
    try:
        image_bytes, warnings, meta = await run_in_threadpool(
            cv2_preprocess_image,
            upload["content"],
            target_size,
        )
    except RuntimeError as exc:
        return no_store_json(503, {"error": str(exc)})
    except ValueError as exc:
        return no_store_json(400, {"error": str(exc)})
    except Exception:
        return no_store_json(500, {"error": "Image preprocess failed"})

    filename = Path(upload["filename"] or "upload.jpg").stem
    headers = {
        "Cache-Control": "no-store",
        "Content-Disposition": f'inline; filename="{filename}-preprocessed.jpg"',
        "X-OCR-Preprocess-Warnings": json.dumps(warnings, ensure_ascii=True),
        "X-OCR-Preprocess-Meta": json.dumps(meta, ensure_ascii=True),
    }
    return Response(content=image_bytes, media_type="image/jpeg", headers=headers)

@app.post("/api/ocr/proxy")
async def proxy_ocr_request(request: Request):
    content_type = request.headers.get("content-type", "")
    if not content_type.startswith("multipart/form-data;"):
        return no_store_json(400, {"error": "Expected multipart/form-data"})

    if parse_content_length(request) > MAX_UPLOAD_BYTES:
        return no_store_json(413, {"error": "Uploaded file is too large"})

    body = await request.body()
    if len(body) > MAX_UPLOAD_BYTES:
        return no_store_json(413, {"error": "Uploaded file is too large"})

    fields, uploads = parse_multipart_body(body, content_type)
    api_id = fields.get("apiId", "")
    api = PROXY_APIS.get(api_id)
    if not api:
        return no_store_json(400, {"error": "Unsupported proxy API"})

    token = os.environ.get(api.get("auth_env_key", ""), "")
    if api.get("auth_env_key") and not token:
        return no_store_json(503, {"error": f"Missing server environment variable: {api['auth_env_key']}"})

    upload = uploads[0] if uploads else None
    if upload is None:
        return no_store_json(400, {"error": "Missing uploaded file"})

    if len(upload["content"]) > MAX_UPLOAD_BYTES:
        return no_store_json(413, {"error": "Uploaded file is too large"})

    filename = Path(upload["filename"] or "upload.jpg").name
    upload_content_type = upload["content_type"] or "application/octet-stream"
    files = {api["form_file_key"]: (filename, upload["content"], upload_content_type)}
    headers = {api["auth_header_name"]: token} if token else {}
    post_upstream = partial(
        requests.post,
        api["endpoint"],
        files=files,
        data=api.get("extra_form_fields", {}),
        headers=headers,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )

    try:
        upstream = await run_in_threadpool(post_upstream)
    except requests.Timeout:
        return no_store_json(504, {"error": "OCR request timed out", "apiId": api_id, "endpoint": api["endpoint"]})
    except requests.RequestException as exc:
        return no_store_json(
            502,
            {
                "error": "Cannot connect to upstream OCR API",
                "apiId": api_id,
                "endpoint": api["endpoint"],
                "detail": str(exc),
            },
        )

    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("Content-Type", "application/json; charset=utf-8"),
        headers={"Cache-Control": "no-store"},
    )


def parse_multipart_body(body, content_type):
    message = BytesParser(policy=default).parsebytes(
        b"Content-Type: " + content_type.encode("latin1") + b"\r\nMIME-Version: 1.0\r\n\r\n" + body
    )
    if not message.is_multipart():
        return {}, []

    fields = {}
    uploads = []
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if not name:
            continue
        content = part.get_payload(decode=True) or b""
        filename = part.get_filename()
        if filename:
            uploads.append(
                {
                    "name": name,
                    "filename": filename,
                    "content_type": part.get_content_type(),
                    "content": content,
                }
            )
        else:
            fields[name] = content.decode(part.get_content_charset() or "utf-8", errors="replace").strip()
    return fields, uploads

# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@app.post("/api/ocr/postprocess")
async def handle_postprocess(request: Request):
    content_length = parse_content_length(request)
    if content_length > 2 * 1024 * 1024:
        return no_store_json(413, {"error": "Payload too large"})

    body = await request.body()
    if len(body) > 2 * 1024 * 1024:
        return no_store_json(413, {"error": "Payload too large"})

    try:
        body_json: dict = json.loads(body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return no_store_json(400, {"error": "Invalid JSON body"})

    api_id = str(body_json.pop("__api_id__", "") or "")
    result = postprocess_ocr(body_json, api_id)
    return no_store_json(200, result)

@app.get("/{path:path}")
def serve_static_file(path: str, request: Request):
    request_path = request.url.path
    filename = STATIC_FILES.get(request_path)
    if not filename:
        return no_store_json(404, {"error": "Not found"})

    file_path = FRONTEND_ROOT / filename
    if not file_path.exists():
        return no_store_json(500, {"error": "Cannot read static file"})

    return FileResponse(
        file_path,
        headers={"Cache-Control": "no-store"},
    )


if __name__ == "__main__":
    print(f"OCR Document Capture running at http://{HOST}:{PORT}")
    uvicorn.run(app, host=HOST, port=PORT, reload=False)
