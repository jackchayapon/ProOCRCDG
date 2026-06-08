# OCR Auto Trace Mode

OCR Auto Trace Mode is for local, dev, test, or staging diagnostics only. It is off by default and production should leave it off.

## Enable For Testing

Backend `.env`:

```env
OCR_TRACE_MODE=true
OCR_TRACE_AUTO_OCR=true
OCR_TRACE_DIR=debug_traces
```

Frontend runtime config:

```html
<script>
  window.OCR_RUNTIME_CONFIG = {
    OCR_TRACE_CLIENT: true
  };
</script>
```

You can also use the app Debug Mode toggle to allow client trace requests while testing.

## Disable For Production

```env
OCR_TRACE_MODE=false
OCR_TRACE_AUTO_OCR=false
```

When disabled, `/api/trace/client-image` returns `{ "enabled": false }`, does not create a folder, and does not save physical files.

## Checkpoints

- `01-original-upload`: original file selected by the user.
- `01-pdf-page-rendered`: PDF page rendered to JPG for OCR.
- `02-after-canvas-crop`: image after browser canvas crop/resize/enhance.
- `02-after-canvas-skip`: full image after skip crop resize/enhance.
- `03-client-before-ocr`: file chosen by the frontend before OCR.
- `03-client-after-preprocess`: file returned from image preprocess before OCR.
- `03-preprocess-input`: file received by `/api/image/preprocess`.
- `03-after-opencv-preprocess`: OpenCV preprocess output.
- `04-proxy-before-ocr`: file received by `/api/ocr/proxy`.
- `05-web-ocr-response.json`: real OCR API response returned through the web flow.
- `{stage}-postman-response.json`: direct Postman-like OCR response, only when `OCR_TRACE_AUTO_OCR=true`.

## Reading The Trace

- If `01-original-upload` Postman-like response is correct, but crop/skip response is wrong, the issue is likely in canvas crop, skip, resize, or enhance.
- If crop/skip response is correct, but `05-web-ocr-response.json` is wrong, check frontend sending, backend proxy, form key, apiId, endpoint, postprocess, or normalize.
- If `03-client-before-ocr` differs from `04-proxy-before-ocr`, the issue is between frontend upload and backend receive.
- If web preview differs from `03-client-before-ocr`, the issue is a preview source mismatch.
- If `04-proxy-before-ocr` is correct but OCR output is wrong, check the OCR API or request format.

Trace JSON is sanitized. Sensitive encoded image payload fields are omitted, and auth tokens are never written to trace files.
