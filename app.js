const RUNTIME_CONFIG = {
  PROXY_URL: "/api/ocr/proxy",
  PREPROCESS_URL: "/api/image/preprocess",
  POSTPROCESS_URL: "/api/ocr/postprocess",
  REQUEST_TIMEOUT_MS: 45000,
  USE_IMAGE_PREPROCESS: true,
  USE_MOCK_OCR: false,
  ...(window.OCR_RUNTIME_CONFIG || {}),
};

const OCR_APIS = [
  api("front-id", "อ่านหน้าบัตร", "บัตรประชาชนด้านหน้า", "/ocr/id", "idCardFront", "idCard"),
  api("front-id-custom", "อ่านหน้าบัตร Custom Result", "บัตรประชาชนด้านหน้า", "/ocrmid/", "idCardFront", "idCard", { extraFormFields: { type: "id" }, outputMode: "customResult" }),
  api("front-id-other", "อ่านหน้าบัตร Other", "บัตรประชาชนด้านหน้า", "https://facepoc.cdgs.co.th/ocr/api/v1/upload_front_file", "idCardFront", "idCard", { formFileKey: "file", authRequired: true, outputMode: "other" }),
  api("back-id", "อ่านหลังบัตร", "บัตรประชาชนด้านหลัง", "/ocr/back_id", "idCardBack", "idCard"),
  api("back-id-custom", "อ่านหลังบัตร Custom Result", "บัตรประชาชนด้านหลัง", "/ocrmid/", "idCardBack", "idCard", { extraFormFields: { type: "backid" }, outputMode: "customResult" }),
  api("back-id-other", "อ่านหลังบัตร Other", "บัตรประชาชนด้านหลัง", "https://facepoc.cdgs.co.th/ocr/api/v1/upload_back_file", "idCardBack", "idCard", { formFileKey: "file", authRequired: true, outputMode: "other" }),
  api("passport", "อ่านพาสปอร์ต", "พาสปอร์ต", "/ocr/passport", "passport", "passport", { aspectRatio: 1.42, resize: { minWidth: 1400, maxWidth: 2000, quality: 0.92 } }),
  api("passport-custom", "อ่านพาสปอร์ต Custom Result", "พาสปอร์ต", "/ocrmid/", "passport", "passport", { aspectRatio: 1.42, resize: { minWidth: 1400, maxWidth: 2000, quality: 0.92 }, extraFormFields: { type: "passport" }, outputMode: "customResult" }),
  api("custom-document", "อ่านเอกสาร Custom", "เอกสารอื่น ๆ", "/ocr/custom", "customDocument", "flexible", { aspectRatio: null, resize: { minWidth: 1200, maxWidth: 2200, quality: 0.9 } }),
];

function api(id, label, group, endpoint, documentType, framePreset, options = {}) {
  return {
    id, label, group, endpoint, documentType, framePreset,
    method: "POST", aspectRatio: 1.59, formFileKey: "image_file[]",
    authRequired: false, outputMode: "default", useProxy: true,
    resize: { minWidth: 1200, maxWidth: 1800, quality: 0.92 },
    ...options,
  };
}

const PRESETS = {
  idCard: { className: "id-card", targetKey: "idCard" },
  passport: { className: "passport", targetKey: "passport" },
  a4Portrait: { className: "a4-portrait", targetKey: "a4Portrait" },
  a4Landscape: { className: "a4-landscape", targetKey: "a4Landscape" },
  flexible: { className: "a4-portrait", targetKey: "a4Portrait" },
};
const ACCEPTED = /\.(pdf|jpe?g|png|tiff?|bmp)$/i;
const PROCESSABLE = /\.(jpe?g|png|bmp)$/i;
const MAX_CLIENT_UPLOAD_BYTES = 20 * 1024 * 1024;
const OCR_RESULT_AUTO_CLEAR_MS = 5 * 60 * 1000;
const PDF_RENDER_SCALE = 2.2;
const PDF_THUMBNAIL_SCALE = 0.22;
const DOCUMENT_TARGETS = {
  idCard: { label: "ID Card", width: 1000, height: 630, aspectRatio: 1000 / 630, quality: 0.92, maxUpscale: 2 },
  passport: { label: "Passport", width: 1000, height: 700, aspectRatio: 1000 / 700, quality: 0.92, maxUpscale: 2 },
  a4Portrait: { label: "A4 Portrait", width: 1240, height: 1754, aspectRatio: 1240 / 1754, quality: 0.9, maxUpscale: 2 },
  a4Landscape: { label: "A4 Landscape", width: 1754, height: 1240, aspectRatio: 1754 / 1240, quality: 0.9, maxUpscale: 2 },
};
const CAMERA_PRESET_OPTIONS = [
  { id: "idCard", label: "ID Card 1000 x 630" },
  { id: "passport", label: "Passport 1000 x 700" },
  { id: "a4Portrait", label: "A4 Portrait 1240 x 1754" },
  { id: "a4Landscape", label: "A4 Landscape 1754 x 1240" },
];
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}
const state = {
  page: "home", workspaceMode: "crop", fileKind: "", originalFile: null, originalImageUrl: "",
  processedFile: null, processedImageUrl: "", cropBox: null, detectedCropBox: null, manualCropBox: null,
  cropDrag: null, previewView: { zoom: 1, panX: 0, panY: 0, dragging: false, startX: 0, startY: 0, baseX: 0, baseY: 0 },
  selectedApiId: "front-id", preset: "idCard", stream: null, ocrResult: null, ocrResultClean: null,  ocrCompareView: "side-by-side", warnings: [],
  isPdfMode: false, pdfFile: null, pdfDocument: null, pdfTotalPages: 0, pdfRenderedPages: [],
  selectedPdfPageIndex: 0, selectedPdfPageImageFile: null, selectedPdfPageImageUrl: "",
  processedPdfPageFile: null, pdfRenderInfo: null, processedImageInfo: null, pdfOcrResults: [],
  ocrImagePreview: { src: "", key: "", message: "" },
  encodedPayloads: [], selectedEncodedPayloadIndex: 0, encodedPayloadExpanded: false, resultTab: "text",
  mockMode: RUNTIME_CONFIG.USE_MOCK_OCR,
  debugMode: false, debug: {}, apiStatus: {}, controller: null, loading: false, privacyClearTimer: null,
};
const els = {};
const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  ["homePage","cameraPage","previewPage","fileInput","uploadBtn","cameraBtn","backHomeBtn","captureBtn","restartCameraBtn","presetSelect","video","cameraPlaceholder","captureFrame","apiList","cancelOcrBtn","newImageBtn","clearDataBtn","cropStep","previewStep","resultStep","documentPanelTitle","pdfPagePanel","pdfPageTitle","pdfPageMeta","pdfPageGrid","ocrSelectedPdfPageBtn","cropStage","previewImg","previewDoc","previewPlaceholder","cropBox","imageMeta","fileModeBadge","cropToolbar","previewToolbar","comparePanel","compareSummary","compareRawJson","compareCleanJson","copyOriginalJsonBtn","downloadOriginalJsonBtn","copyPostProcessJsonBtn","downloadPostProcessJsonBtn","autoDetectBtn","trimWhiteBtn","resetCropBtn","applyCropBtn","skipCropBtn","zoomOutBtn","zoomInBtn","fitScreenBtn","actualSizeBtn","resetViewBtn","backToPdfPagesBtn","backToCropBtn","runOcrBtn","cropHint","warningList","selectedApiLabel","mockMode","debugMode","debugPanel","debugOutput","textTab","jsonTab","textOutput","jsonOutput","resultMeta","resultImagePanel","ocrFaceImage","ocrImageMessage","encodedPayloadPanel","encodedPayloadSelect","encodedPayloadToggleBtn","encodedPayloadCopyBtn","encodedPayloadOutput","copyJsonBtn","downloadTextBtn","downloadJsonBtn","homeMessage","workspaceMessage","loading","loadingCancelBtn","workCanvas"].forEach((id) => els[id] = $(id));
  renderCameraPresetOptions();
  bindEvents();
  setupMobileCollapsibles();
  render();
  refreshApiStatus();
});

function bindEvents() {
  els.uploadBtn.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", async (event) => { const [file] = event.target.files; if (file) await useFile(file); event.target.value = ""; });
  els.cameraBtn.addEventListener("click", openCameraPage);
  els.backHomeBtn.addEventListener("click", goHome);
  els.restartCameraBtn.addEventListener("click", startCamera);
  els.captureBtn.addEventListener("click", captureFromCamera);
  els.presetSelect.addEventListener("change", (event) => { state.preset = event.target.value; renderCameraFrame(); });
  els.apiList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-api-id]");
    if (!button) return;
    state.selectedApiId = button.dataset.apiId;
    state.preset = getSelectedApi().framePreset;
    clearOcrResultData();
    render();
    showSelectedApiNotice();
  });
  els.autoDetectBtn.addEventListener("click", () => detectAndSetCrop(false));
  els.trimWhiteBtn.addEventListener("click", () => detectAndSetCrop(true));
  els.resetCropBtn.addEventListener("click", resetCrop);
  els.applyCropBtn.addEventListener("click", applyCrop);
  els.skipCropBtn.addEventListener("click", skipCrop);
  els.ocrSelectedPdfPageBtn.addEventListener("click", prepareSelectedPdfPageForCrop);
  els.pdfPageGrid.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-pdf-page-index]");
    if (!button) return;
    const nextPageIndex = Number(button.dataset.pdfPageIndex);
    if (nextPageIndex !== state.selectedPdfPageIndex) {
      clearSelectedPdfPageData();
      state.selectedPdfPageIndex = nextPageIndex;
    }
    renderPdfPageSelector();
  });
  els.backToPdfPagesBtn.addEventListener("click", backToPdfPages);
  els.backToCropBtn.addEventListener("click", backToCrop);
  els.zoomInBtn.addEventListener("click", () => changePreviewZoom(0.15));
  els.zoomOutBtn.addEventListener("click", () => changePreviewZoom(-0.15));
  els.fitScreenBtn.addEventListener("click", fitPreviewToScreen);
  els.actualSizeBtn.addEventListener("click", actualPreviewSize);
  els.resetViewBtn.addEventListener("click", resetPreviewView);
  els.runOcrBtn.addEventListener("click", runOcr);
  els.cancelOcrBtn.addEventListener("click", cancelOcrSession);
  els.loadingCancelBtn.addEventListener("click", cancelOcrSession);
  els.newImageBtn.addEventListener("click", goHome);
  els.clearDataBtn.addEventListener("click", clearDataAndReturnHome);
  els.mockMode.addEventListener("change", (event) => { state.mockMode = event.target.checked; renderDebug(); });
  els.debugMode.addEventListener("change", (event) => { state.debugMode = event.target.checked; renderDebug(); });
  els.textTab.addEventListener("click", () => showResultTab("text"));
  els.jsonTab.addEventListener("click", () => showResultTab("json"));
  els.encodedPayloadSelect.addEventListener("change", (event) => { state.selectedEncodedPayloadIndex = Number(event.target.value) || 0; state.encodedPayloadExpanded = false; renderEncodedPayloadPanel(); });
  els.encodedPayloadToggleBtn.addEventListener("click", () => { state.encodedPayloadExpanded = !state.encodedPayloadExpanded; renderEncodedPayloadPanel(); });
  els.encodedPayloadCopyBtn.addEventListener("click", copyEncodedPayload);
  els.copyJsonBtn.addEventListener("click", copyJson);
  els.downloadTextBtn.addEventListener("click", downloadText);
  els.downloadJsonBtn.addEventListener("click", downloadJson);
  els.copyOriginalJsonBtn.addEventListener("click", copyCompareOriginalJson);
  els.downloadOriginalJsonBtn.addEventListener("click", downloadCompareOriginalJson);
  els.copyPostProcessJsonBtn.addEventListener("click", copyComparePostProcessJson);
  els.downloadPostProcessJsonBtn.addEventListener("click", downloadComparePostProcessJson);
  els.cropBox.addEventListener("pointerdown", startCropDrag);
  els.cropStage.addEventListener("pointerdown", startPreviewPan);
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", endPointerAction);
  els.previewImg.addEventListener("load", renderDocumentImage);
  window.addEventListener("resize", renderDocumentImage);
  window.addEventListener("beforeunload", clearSensitiveData);
  window.addEventListener("pagehide", clearSensitiveData);
}

function setupMobileCollapsibles() {
  const media = window.matchMedia("(max-width: 768px)");
  const details = [...document.querySelectorAll("[data-mobile-collapse]")];
  const sync = () => details.forEach((item) => item.toggleAttribute("open", !media.matches));
  sync();
  if (media.addEventListener) media.addEventListener("change", sync);
  else media.addListener(sync);
}

async function useFile(file) {
  clearCurrentDocument();
  state.page = "home";
  if (!ACCEPTED.test(file.name)) { render(); return showMessage("home", "รองรับเฉพาะ PDF, JPG, JPEG, PNG, TIFF และ BMP", true); }
  if (file.size > MAX_CLIENT_UPLOAD_BYTES) { render(); return showMessage("home", "ไฟล์มีขนาดใหญ่เกิน 20MB", true); }
  state.originalFile = file;
  state.fileKind = getFileKind(file);
  state.isPdfMode = state.fileKind === "pdf";
  if (state.isPdfMode) return loadPdfFile(file);
  state.originalImageUrl = URL.createObjectURL(file);
  state.warnings = await analyzeFile(file);
  state.page = "workspace";
  state.workspaceMode = canProcess(file) ? "crop" : "preview";
  render();
  if (canProcess(file)) await detectAndSetCrop(false);
}

async function loadPdfFile(file) {
  if (!window.pdfjsLib) {
    clearCurrentDocument();
    return showMessage("home", "ไม่สามารถโหลด PDF renderer ได้ กรุณาตรวจสอบ Internet หรือเปิดไฟล์รูปภาพแทน", true);
  }
  setLoading(true);
  try {
    const data = await file.arrayBuffer();
    const pdfDocument = await window.pdfjsLib.getDocument({ data }).promise;
    if (!pdfDocument.numPages) throw new Error("PDF นี้ไม่มีหน้าให้ OCR");
    Object.assign(state, {
      pdfFile: file,
      pdfDocument,
      pdfTotalPages: pdfDocument.numPages,
      pdfRenderedPages: [],
      selectedPdfPageIndex: 0,
      selectedPdfPageImageFile: null,
      selectedPdfPageImageUrl: "",
      processedPdfPageFile: null,
      processedImageInfo: null,
      pdfRenderInfo: null,
      pdfOcrResults: [],
      page: "workspace",
      workspaceMode: "pdf-pages",
      warnings: ["PDF จะถูกแปลงเป็นภาพรายหน้าก่อน OCR และจะไม่ส่ง PDF ต้นฉบับเข้า API โดยตรง"],
    });
    render();
    await renderPdfThumbnails();
    render();
  } catch (error) {
    clearCurrentDocument();
    showMessage("home", `ไม่สามารถอ่านไฟล์ PDF ได้: ${error.message || "กรุณาเลือกไฟล์ใหม่"}`, true);
  } finally {
    setLoading(false);
    renderPdfPageSelector();
  }
}

async function renderPdfThumbnails() {
  const pages = [];
  for (let pageNumber = 1; pageNumber <= state.pdfTotalPages; pageNumber++) {
    const page = await state.pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale: PDF_THUMBNAIL_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    pages.push({ pageNumber, canvas, width: canvas.width, height: canvas.height });
  }
  state.pdfRenderedPages = pages;
}

async function prepareSelectedPdfPageForCrop() {
  if (!state.pdfDocument) return showMessage("workspace", "กรุณาเลือกไฟล์ PDF ก่อน", true);
  setLoading(true);
  try {
    const pageNumber = state.selectedPdfPageIndex + 1;
    const page = await state.pdfDocument.getPage(pageNumber);
    clearSelectedPdfPageData();
    const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
    const canvas = els.workCanvas;
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    const blob = await canvasToBlob(canvas, 0.94);
    const imageFile = new File([blob], `${state.originalFile.name.replace(/\.pdf$/i, "")}-page-${pageNumber}.jpg`, { type: "image/jpeg" });
    revokeObjectUrl(state.selectedPdfPageImageUrl);
    setProcessedImageUrl(null);
    Object.assign(state, {
      selectedPdfPageImageFile: imageFile,
      selectedPdfPageImageUrl: URL.createObjectURL(imageFile),
      processedPdfPageFile: null,
      processedImageInfo: null,
      cropBox: null,
      detectedCropBox: null,
      manualCropBox: null,
      ocrResult: null,
      workspaceMode: "crop",
      pdfRenderInfo: { page: pageNumber, scale: PDF_RENDER_SCALE, width: canvas.width, height: canvas.height },
    });
    render();
    await detectAndSetCrop(false);
  } catch (error) {
    showMessage("workspace", `ไม่สามารถ render หน้า PDF นี้ได้: ${error.message || "กรุณาเลือกหน้าใหม่"}`, true);
  } finally {
    setLoading(false);
  }
}

async function openCameraPage() { state.page = "camera"; render(); await startCamera(); }
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) { goHome(); return showMessage("home", "Browser นี้ไม่รองรับการเปิดกล้อง", true); }
  try {
    stopCamera();
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
    els.video.srcObject = state.stream;
  } catch {
    goHome();
    showMessage("home", "เปิดกล้องไม่สำเร็จ กรุณาตรวจสอบสิทธิ์การใช้งานกล้อง", true);
  }
  render();
}
function stopCamera() { if (state.stream) state.stream.getTracks().forEach((track) => track.stop()); state.stream = null; if (els.video) els.video.srcObject = null; }
async function captureFromCamera() {
  if (!state.stream || !els.video.videoWidth) return;
  const target = getCameraTarget();
  const blob = await cropCameraFrameToJpeg(target);
  if (!blob) return showMessage("home", "สร้างภาพ JPG จากกล้องไม่สำเร็จ", true);
  stopCamera();
  await useFile(new File([blob], `camera-${target.width}x${target.height}-${Date.now()}.jpg`, { type: "image/jpeg" }));
  addWarning("กรุณาตรวจสอบกรอบเอกสารจากภาพที่ถ่ายก่อน Apply Crop");
}
async function cropCameraFrameToJpeg(target = getCameraTarget()) {
  const stage = els.video.getBoundingClientRect(), frame = els.captureFrame.getBoundingClientRect(), video = els.video;
  const scale = Math.max(stage.width / video.videoWidth, stage.height / video.videoHeight);
  const offsetX = (stage.width - video.videoWidth * scale) / 2, offsetY = (stage.height - video.videoHeight * scale) / 2;
  const sx = Math.max(0, (frame.left - stage.left - offsetX) / scale), sy = Math.max(0, (frame.top - stage.top - offsetY) / scale);
  const sw = Math.min(video.videoWidth - sx, frame.width / scale), sh = Math.min(video.videoHeight - sy, frame.height / scale);
  if (sw <= 0 || sh <= 0) return null;
  const canvas = els.workCanvas;
  canvas.width = target.width;
  canvas.height = target.height;
  const drawScale = Math.min(target.width / sw, target.height / sh);
  const drawWidth = Math.max(1, Math.round(sw * drawScale));
  const drawHeight = Math.max(1, Math.round(sh * drawScale));
  const dx = Math.round((target.width - drawWidth) / 2);
  const dy = Math.round((target.height - drawHeight) / 2);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(video, sx, sy, sw, sh, dx, dy, drawWidth, drawHeight);
  return canvasToBlob(canvas, target.quality || 0.92);
}

async function detectAndSetCrop(trimWhite) {
  const sourceFile = getCropSourceFile();
  if (!canProcess(sourceFile)) return;
  try {
    const img = await loadImage(sourceFile);
    const detected = detectDocumentBounds(img, trimWhite);
    state.cropBox = detected.box;
    state.detectedCropBox = { ...detected.box };
    state.manualCropBox = null;
    if (detected.confidence < 0.45) addWarning("ระบบตรวจจับขอบเอกสารไม่มั่นใจ กรุณาปรับกรอบด้วยตนเอง");
    if (trimWhite) addWarning("ระบบได้ตัดขอบขาวหรือพื้นที่ว่างรอบเอกสาร กรุณาตรวจสอบก่อน Apply Crop");
    renderDocumentImage();
  } catch {
    addWarning("ตรวจจับขอบเอกสารอัตโนมัติไม่สำเร็จ กรุณาปรับกรอบด้วยตนเอง");
    resetCrop();
  }
}
function detectDocumentBounds(img, trimWhite) {
  const maxSample = 900, scale = Math.min(1, maxSample / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale)), height = Math.max(1, Math.round(img.height * scale));
  const canvas = els.workCanvas; canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const cornerPoints = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]];
  const background = cornerPoints.reduce((sum, [x, y]) => { const i = (y * width + x) * 4; return [sum[0] + pixels[i], sum[1] + pixels[i + 1], sum[2] + pixels[i + 2]]; }, [0, 0, 0]).map((value) => value / 4);
  let minX = width, minY = height, maxX = -1, maxY = -1, matches = 0;
  const threshold = trimWhite ? 28 : 42;
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
    const i = (y * width + x) * 4, r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const distance = Math.abs(r - background[0]) + Math.abs(g - background[1]) + Math.abs(b - background[2]);
    const isContent = trimWhite ? (r + g + b) / 3 < 242 : distance > threshold;
    if (!isContent) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); matches++;
  }
  if (maxX < minX || maxY < minY) return { box: defaultCropBox(img), confidence: 0 };
  const padding = Math.max(4, Math.round(Math.min(width, height) * 0.025));
  minX = Math.max(0, minX - padding); minY = Math.max(0, minY - padding); maxX = Math.min(width, maxX + padding); maxY = Math.min(height, maxY + padding);
  const box = { x: minX / scale, y: minY / scale, width: (maxX - minX) / scale, height: (maxY - minY) / scale };
  const areaRatio = box.width * box.height / (img.width * img.height);
  const density = matches * 4 / Math.max(1, (maxX - minX) * (maxY - minY));
  return { box, confidence: Math.min(1, density * 2) * (areaRatio > 0.08 ? 1 : 0.35) };
}
function defaultCropBox(img) { const padX = img.width * 0.06, padY = img.height * 0.06; return { x: padX, y: padY, width: img.width - padX * 2, height: img.height - padY * 2 }; }
function getDocumentTarget(api, width, height) {
  if (api?.framePreset === "idCard") return DOCUMENT_TARGETS.idCard;
  if (api?.framePreset === "passport") return DOCUMENT_TARGETS.passport;
  return height >= width ? DOCUMENT_TARGETS.a4Portrait : DOCUMENT_TARGETS.a4Landscape;
}
function getCameraTarget() {
  const preset = PRESETS[state.preset] || PRESETS.idCard;
  return DOCUMENT_TARGETS[preset.targetKey] || DOCUMENT_TARGETS.idCard;
}
function warnForCropAspectRatio() {
  if (!state.cropBox) return;
  const target = getDocumentTarget(getSelectedApi(), state.cropBox.width, state.cropBox.height);
  const cropRatio = state.cropBox.width / Math.max(1, state.cropBox.height);
  const diff = Math.abs(cropRatio - target.aspectRatio) / target.aspectRatio;
  if (diff > 0.1) addWarning("สัดส่วนกรอบ Crop ไม่ตรงกับประเภทเอกสาร อาจทำให้ OCR อ่านผิดพลาดหรือมีขอบขาวมากเกินไป");
}
async function resetCrop() {
  const sourceFile = getCropSourceFile();
  if (!canProcess(sourceFile)) return;
  const img = await loadImage(sourceFile);
  state.cropBox = defaultCropBox(img);
  state.detectedCropBox = null; state.manualCropBox = null;
  renderDocumentImage();
}
async function applyCrop() {
  if (!canProcess(getCropSourceFile())) return await skipCrop();
  try {
    warnForCropAspectRatio();
    const cropped = await cropOriginalImage();
    const processed = await resizeAndEnhanceImage(cropped, getSelectedApi());
    if (state.isPdfMode) state.processedPdfPageFile = processed;
    else state.processedFile = processed;
    state.processedImageInfo = await readImageInfo(processed);
    setProcessedImageUrl(processed);
    enterPreviewMode();
  } catch {
    addWarning(state.isPdfMode ? "สร้างภาพหลัง Crop ไม่สำเร็จ กรุณาลอง Apply Crop ใหม่" : "สร้างภาพหลัง Crop ไม่สำเร็จ ระบบจะใช้ไฟล์ต้นฉบับ");
    if (!state.isPdfMode) await skipCrop();
  }
}
async function skipCrop() {
  if (state.isPdfMode) return showMessage("workspace", "ไฟล์ PDF ต้องเลือกหน้าและ Apply Crop ก่อนเรียก OCR", true);
  try {
    if (canProcess(state.originalFile)) {
      const processed = await resizeAndEnhanceImage(state.originalFile, getSelectedApi());
      state.processedFile = processed;
      state.processedImageInfo = await readImageInfo(processed);
      setProcessedImageUrl(processed);
    } else {
      state.processedFile = null;
      state.processedImageInfo = null;
      setProcessedImageUrl(null);
    }
    enterPreviewMode();
  } catch {
    showMessage("workspace", "สร้างภาพ JPG สำหรับ OCR ไม่สำเร็จ กรุณาลอง Apply Crop หรืออัปโหลดไฟล์ใหม่", true);
  }
}
function enterPreviewMode() { clearOcrResultData(); state.workspaceMode = "preview"; resetPreviewView(); render(); }
function backToCrop() { if (!canProcess(getCropSourceFile())) return; clearOcrResultData(); state.workspaceMode = "crop"; render(); }
function backToPdfPages() { clearSelectedPdfPageData(); state.workspaceMode = "pdf-pages"; render(); }

async function cropOriginalImage() {
  const sourceFile = getCropSourceFile();
  const img = await loadImage(sourceFile), box = state.cropBox || defaultCropBox(img), canvas = els.workCanvas;
  canvas.width = Math.max(1, Math.round(box.width)); canvas.height = Math.max(1, Math.round(box.height));
  const ctx = canvas.getContext("2d");
  ctx.filter = "none";
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, box.x, box.y, box.width, box.height, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas, 0.94);
  return new File([blob], sourceFile.name.replace(/\.[^.]+$/, "-crop.jpg"), { type: "image/jpeg" });
}
async function resizeAndEnhanceImage(file, resizeConfig) {
  const api = resizeConfig?.framePreset ? resizeConfig : getSelectedApi();
  const img = await loadImage(file), target = getDocumentTarget(api, img.width, img.height), canvas = els.workCanvas;
  const containScale = Math.min(target.width / img.width, target.height / img.height);
  const scale = Math.min(containScale, target.maxUpscale || containScale);
  const drawWidth = Math.max(1, Math.round(img.width * scale));
  const drawHeight = Math.max(1, Math.round(img.height * scale));
  const dx = Math.round((target.width - drawWidth) / 2);
  const dy = Math.round((target.height - drawHeight) / 2);
  if (img.width < target.width / 2 || img.height < target.height / 2 || containScale > (target.maxUpscale || containScale)) {
    addWarning("ภาพที่ครอบมีขนาดเล็กเกินไป อาจทำให้ OCR ไม่แม่น กรุณาอัปโหลดหรือถ่ายภาพที่ชัดขึ้น");
  }
  canvas.width = target.width; canvas.height = target.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.filter = "contrast(1.08) brightness(1.04)";
  ctx.drawImage(img, dx, dy, drawWidth, drawHeight);
  const blob = await canvasToBlob(canvas, target.quality || 0.9);
  return new File([blob], file.name.replace(/\.[^.]+$/, "-ocr.jpg"), { type: "image/jpeg" });
}

async function runOcr() {
  const api = getSelectedApi(), validationError = validateBeforeRunOcr(api);
  if (validationError) return showMessage("workspace", validationError, true);
  setLoading(true);
  clearOcrResultData();
  const started = performance.now();
  try {
    let file = getOcrFile();
    state.controller = new AbortController();
    const timeout = setTimeout(() => state.controller.abort("timeout"), RUNTIME_CONFIG.REQUEST_TIMEOUT_MS);
    let payload, status = 200;
    try {
      if (state.mockMode) { await delay(650, state.controller.signal); payload = buildMockResponse(api); }
      else {
        file = await preprocessBeforeOcr(file, api, state.controller.signal);
        const formData = buildFormData(api, file);
        const response = await fetch(RUNTIME_CONFIG.PROXY_URL, { method: api.method, body: formData, signal: state.controller.signal });
        status = response.status;
        const text = await response.text(); payload = parseJson(text) ?? { response: text };
        if (!response.ok) throw new Error(getErrorText(payload) || `HTTP ${response.status}`);
      }
    } finally { clearTimeout(timeout); }
    state.ocrResult = await normalizeOcrResponse(payload, api, Math.round(performance.now() - started));
    state.ocrResultClean = await runPostprocess(payload, api);
    state.ocrImagePreview = state.ocrResult.imagePreview || { src: "", key: "", message: "" };
    state.encodedPayloads = state.ocrResult.encodedPayloads || [];
    state.selectedEncodedPayloadIndex = 0;
    state.encodedPayloadExpanded = false;
    state.debug = buildDebugInfo(api, file, status, state.ocrResult.runtime);
    els.workspaceMessage.hidden = true;
    render();
    schedulePrivacyAutoClear();
  } catch (error) {
    const message = error.name === "AbortError" ? "OCR request ถูกยกเลิกหรือใช้เวลานานเกินกำหนด กรุณาลองใหม่" : `เรียก OCR API ไม่สำเร็จ: ${error.message || "กรุณาตรวจสอบการเชื่อมต่อ"}`;
    if (!state.originalFile) return;
    clearCurrentDocument();
    state.page = "home";
    render();
    showMessage("home", message, true);
  } finally { state.controller = null; setLoading(false); }
}
async function runPostprocess(rawPayload, api) {
  try {
    const response = await fetch(RUNTIME_CONFIG.POSTPROCESS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...rawPayload, __api_id__: api.id }),
      signal: state.controller?.signal,
    });
    const text = await response.text();
    const data = parseJson(text);
    if (!response.ok || !data) return null;
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw error;
    addWarning(`Post-process ไม่สำเร็จ: ${error.message}`);
    return null;
  }
}
function validateBeforeRunOcr(api) {
  if (!state.originalFile) return "กรุณาเลือกไฟล์หรือถ่ายภาพก่อน Run OCR";
  if (state.isPdfMode) {
    if (!state.selectedPdfPageImageFile) return "ไฟล์ PDF มีหลายหน้า กรุณาเลือกหน้าที่ต้องการ OCR";
    if (state.workspaceMode !== "preview") return "กรุณาเลือกหน้า PDF และ Apply Crop ก่อนเรียก OCR";
    if (!state.processedPdfPageFile) return "กรุณา Apply Crop หน้า PDF ก่อนเรียก OCR";
  } else if (state.workspaceMode !== "preview") return "กรุณา Apply Crop หรือ Skip Crop ก่อน Run OCR";
  if (!api?.endpoint || !api.method || !api.formFileKey) return "OCR API config ไม่สมบูรณ์";
  const file = getOcrFile();
  if (!file) return "ไม่พบไฟล์สำหรับส่ง OCR";
  if (file.size > MAX_CLIENT_UPLOAD_BYTES) return "ไฟล์มีขนาดใหญ่เกิน 20MB";
  if (!state.mockMode && api.authRequired && state.apiStatus[api.id]?.available === false) return "API Other ยังใช้งานไม่ได้: กรุณากำหนด OCR_OTHER_AUTH_TOKEN ในไฟล์ .env แล้วรัน python OCR/Backend/P2.py ใหม่";
  return "";
}
function buildFormData(api, file) { const data = new FormData(); data.append(api.formFileKey, file, file.name); Object.entries(api.extraFormFields || {}).forEach(([key, value]) => data.append(key, String(value))); data.append("apiId", api.id); return data; }
async function preprocessBeforeOcr(file, api, signal) {
  if (!RUNTIME_CONFIG.USE_IMAGE_PREPROCESS || !canProcess(file)) return file;
  const data = new FormData();
  data.append("file", file, file.name);
  data.append("apiId", api.id);
  data.append("framePreset", api.framePreset || "");
  data.append("documentType", api.documentType || "");

  try {
    const response = await fetch(RUNTIME_CONFIG.PREPROCESS_URL, { method: "POST", body: data, signal });
    if (!response.ok) {
      const text = await response.text();
      const payload = parseJson(text);
      addWarning(`Preprocess ไม่สำเร็จ ระบบจะส่งภาพเดิมเข้า OCR: ${getErrorText(payload) || `HTTP ${response.status}`}`);
      return file;
    }

    const blob = await response.blob();
    const warnings = parseHeaderJson(response.headers.get("X-OCR-Preprocess-Warnings"), []);
    const meta = parseHeaderJson(response.headers.get("X-OCR-Preprocess-Meta"), {});
    warnings.forEach(addWarning);
    const nextName = file.name.replace(/\.[^.]+$/, "-cv-ocr.jpg");
    const preprocessed = new File([blob], nextName, { type: "image/jpeg" });
    state.processedImageInfo = {
      width: meta.outputWidth || state.processedImageInfo?.width || 0,
      height: meta.outputHeight || state.processedImageInfo?.height || 0,
    };
    return preprocessed;
  } catch (error) {
    if (error.name === "AbortError") throw error;
    addWarning(`Preprocess ไม่สำเร็จ ระบบจะส่งภาพเดิมเข้า OCR: ${error.message || "ไม่ทราบสาเหตุ"}`);
    return file;
  }
}
function parseHeaderJson(value, fallback) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function startCropDrag(event) {
  if (state.workspaceMode !== "crop" || !state.cropBox) return;
  event.stopPropagation();
  state.cropDrag = { action: event.target.dataset.resize || "move", startX: event.clientX, startY: event.clientY, box: { ...state.cropBox } };
}
function handlePointerMove(event) {
  if (state.cropDrag) return moveCropBox(event);
  if (state.previewView.dragging) movePreviewPan(event);
}
function moveCropBox(event) {
  const metrics = getCropDisplayMetrics();
  if (!metrics) return;
  const dx = (event.clientX - state.cropDrag.startX) / metrics.scale, dy = (event.clientY - state.cropDrag.startY) / metrics.scale;
  const box = { ...state.cropDrag.box }, minSize = 40;
  if (state.cropDrag.action === "move") { box.x += dx; box.y += dy; }
  if (state.cropDrag.action.includes("w")) { box.x += dx; box.width -= dx; }
  if (state.cropDrag.action.includes("e")) box.width += dx;
  if (state.cropDrag.action.includes("n")) { box.y += dy; box.height -= dy; }
  if (state.cropDrag.action.includes("s")) box.height += dy;
  box.width = Math.max(minSize, Math.min(box.width, metrics.naturalWidth)); box.height = Math.max(minSize, Math.min(box.height, metrics.naturalHeight));
  box.x = Math.max(0, Math.min(box.x, metrics.naturalWidth - box.width)); box.y = Math.max(0, Math.min(box.y, metrics.naturalHeight - box.height));
  state.cropBox = box; state.manualCropBox = { ...box }; renderCropBox();
}
function endPointerAction() { state.cropDrag = null; state.previewView.dragging = false; }
function startPreviewPan(event) {
  if (state.workspaceMode !== "preview" || !canPreviewImage()) return;
  state.previewView.dragging = true; state.previewView.startX = event.clientX; state.previewView.startY = event.clientY;
  state.previewView.baseX = state.previewView.panX; state.previewView.baseY = state.previewView.panY;
}
function movePreviewPan(event) { const view = state.previewView; view.panX = view.baseX + event.clientX - view.startX; view.panY = view.baseY + event.clientY - view.startY; renderDocumentImage(); }
function changePreviewZoom(change) { state.previewView.zoom = Math.min(4, Math.max(0.25, state.previewView.zoom + change)); renderDocumentImage(); }
function fitPreviewToScreen() { resetPreviewView(); renderDocumentImage(); }
function actualPreviewSize() {
  if (!els.previewImg.naturalWidth) return;
  const fit = getImageFitScale(els.previewImg.naturalWidth, els.previewImg.naturalHeight);
  state.previewView.zoom = 1 / fit; state.previewView.panX = 0; state.previewView.panY = 0; renderDocumentImage();
}
function resetPreviewView() { Object.assign(state.previewView, { zoom: 1, panX: 0, panY: 0, dragging: false }); }

function render() {
  els.homePage.hidden = state.page !== "home"; els.cameraPage.hidden = state.page !== "camera"; els.previewPage.hidden = state.page !== "workspace";
  els.captureBtn.disabled = !state.stream; els.cameraPlaceholder.hidden = Boolean(state.stream); els.mockMode.checked = state.mockMode; els.debugMode.checked = state.debugMode;
  renderCameraPresetOptions();
  renderCameraFrame(); renderApiList(); renderWorkspace(); renderResult(); renderDebug();
}
function normalizeCameraPresetId(value) {
  if (CAMERA_PRESET_OPTIONS.some((option) => option.id === value)) return value;
  const targetKey = PRESETS[value]?.targetKey;
  return CAMERA_PRESET_OPTIONS.some((option) => option.id === targetKey) ? targetKey : "idCard";
}
function renderCameraPresetOptions() {
  if (!els.presetSelect) return;
  const currentPreset = normalizeCameraPresetId(state.preset);
  state.preset = currentPreset;
  if (els.presetSelect.dataset.rendered !== "true") {
    els.presetSelect.innerHTML = CAMERA_PRESET_OPTIONS.map((option) => `<option value="${option.id}">${escapeHtml(option.label)}</option>`).join("");
    els.presetSelect.dataset.rendered = "true";
  }
  els.presetSelect.value = currentPreset;
}
function renderCameraFrame() { els.captureFrame.className = `capture-frame ${(PRESETS[state.preset] || PRESETS.idCard).className}`.trim(); }
function renderApiList() {
  let group = "";
  els.apiList.innerHTML = OCR_APIS.map((api) => {
    const heading = api.group !== group ? `<div class="api-group">${escapeHtml(api.group)}</div>` : "";
    group = api.group;
    const unavailable = state.apiStatus[api.id]?.available === false;
    const meta = [api.endpoint, "Proxy", getApiExtraFieldsLabel(api), unavailable ? "ต้องตั้ง Token" : ""].filter(Boolean).join(" · ");
    return `${heading}<button class="api-option ${api.id === state.selectedApiId ? "active" : ""}" data-api-id="${api.id}" type="button"><strong>${escapeHtml(getApiDisplayLabel(api))}</strong><span>${escapeHtml(meta)}</span></button>`;
  }).join("");
  els.selectedApiLabel.textContent = getApiDisplayLabel(getSelectedApi());
}
function getApiExtraFieldsLabel(api) {
  const fields = Object.entries(api.extraFormFields || {});
  if (!fields.length) return "";
  return fields.map(([key, value]) => `${key}: ${value}`).join(", ");
}
function getApiDisplayLabel(api) {
  const type = api.extraFormFields?.type;
  return type ? `${api.label} (type: ${type})` : api.label;
}
function renderWorkspace() {
  if (!state.originalFile) return;
  const pdfPageMode = state.workspaceMode === "pdf-pages", cropMode = state.workspaceMode === "crop", processable = canProcess(getCropSourceFile());
  els.documentPanelTitle.textContent = pdfPageMode ? "Select PDF Page" : cropMode ? "Crop Document" : "Preview Document";
  const processedPreview = state.workspaceMode === "preview" && (state.processedFile || state.processedPdfPageFile);
  els.fileModeBadge.textContent = pdfPageMode ? "PDF Pages" : cropMode ? (state.isPdfMode ? "PDF Page Image" : "Original Image") : processedPreview ? "Crop + Resize + Enhance" : "Original File";
  els.pdfPagePanel.hidden = !pdfPageMode;
  els.cropStage.hidden = pdfPageMode;
  els.cropToolbar.hidden = !cropMode || !processable;
  els.skipCropBtn.hidden = state.isPdfMode;
  els.previewToolbar.hidden = cropMode || pdfPageMode;
  els.backToPdfPagesBtn.hidden = !(state.isPdfMode && state.workspaceMode === "preview");
  els.cropHint.textContent = pdfPageMode ? "เลือกหน้า PDF ที่ต้องการ OCR ระบบจะ render เป็นภาพ JPG แล้วส่งเข้า Crop Document Mode" : cropMode ? "ลากหรือปรับขนาดกรอบให้ครอบเอกสารทั้งใบ จากนั้นกด Apply Crop" : "ลากภาพเพื่อเลื่อนดูรายละเอียด หรือใช้ Zoom / Fit to Screen / 100%";
  const displayFile = getActiveDisplayFile();
  els.imageMeta.textContent = buildImageMeta(displayFile);
  renderPdfPageSelector(); renderSteps(); renderDocumentImage(); renderWarnings();
}
function renderSteps() {
  const hasResult = Boolean(state.ocrResult), previewMode = state.workspaceMode === "preview", pdfPageMode = state.workspaceMode === "pdf-pages";
  els.cropStep.className = `step ${previewMode ? "complete" : pdfPageMode || state.workspaceMode === "crop" ? "active" : ""}`;
  els.previewStep.className = `step ${previewMode && !hasResult ? "active" : hasResult ? "complete" : ""}`;
  els.resultStep.className = `step ${hasResult ? "active" : ""}`;
}
function renderPdfPageSelector() {
  if (!state.isPdfMode || !els.pdfPageGrid) return;
  els.pdfPageTitle.textContent = `PDF ทั้งหมด ${state.pdfTotalPages || 0} หน้า`;
  els.pdfPageMeta.textContent = `เลือกอยู่: Page ${state.selectedPdfPageIndex + 1} of ${state.pdfTotalPages || 0}`;
  els.ocrSelectedPdfPageBtn.disabled = !state.pdfDocument || !state.pdfRenderedPages.length || state.loading;
  els.pdfPageGrid.innerHTML = "";
  state.pdfRenderedPages.forEach((page, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `pdf-page-option ${index === state.selectedPdfPageIndex ? "active" : ""}`;
    button.dataset.pdfPageIndex = String(index);
    button.appendChild(page.canvas);
    const label = document.createElement("span");
    label.textContent = `Page ${page.pageNumber}`;
    button.appendChild(label);
    els.pdfPageGrid.appendChild(button);
  });
}
function renderDocumentImage() {
  if (!state.originalFile) return;
  els.previewImg.hidden = true; els.previewDoc.hidden = true; els.previewPlaceholder.hidden = true; els.cropBox.hidden = true;
  if (state.workspaceMode === "pdf-pages") return;
  const file = getActiveDisplayFile(), url = getActiveDisplayUrl();
  if (!canProcess(file)) { els.previewPlaceholder.textContent = `${file.name} พร้อมส่งเข้า OCR แต่ Browser ไม่รองรับ Preview/Crop สำหรับไฟล์นี้`; els.previewPlaceholder.hidden = false; return; }
  els.previewImg.src = url; els.previewImg.hidden = false;
  if (!els.previewImg.naturalWidth) return;
  const fit = getImageFitScale(els.previewImg.naturalWidth, els.previewImg.naturalHeight), zoom = state.workspaceMode === "preview" ? state.previewView.zoom : 1;
  els.previewImg.style.width = `${Math.round(els.previewImg.naturalWidth * fit)}px`; els.previewImg.style.height = `${Math.round(els.previewImg.naturalHeight * fit)}px`;
  els.previewImg.style.transform = state.workspaceMode === "preview" ? `translate(${state.previewView.panX}px, ${state.previewView.panY}px) scale(${zoom})` : "none";
  if (state.workspaceMode === "crop" && state.cropBox) renderCropBox();
}
function renderCropBox() {
  const metrics = getCropDisplayMetrics();
  if (!metrics || !state.cropBox) return;
  els.cropBox.hidden = false;
  els.cropBox.style.left = `${metrics.left + state.cropBox.x * metrics.scale}px`;
  els.cropBox.style.top = `${metrics.top + state.cropBox.y * metrics.scale}px`;
  els.cropBox.style.width = `${state.cropBox.width * metrics.scale}px`;
  els.cropBox.style.height = `${state.cropBox.height * metrics.scale}px`;
}
function getCropDisplayMetrics() {
  if (!els.previewImg.naturalWidth) return null;
  const stage = els.cropStage.getBoundingClientRect(), width = els.previewImg.offsetWidth, height = els.previewImg.offsetHeight;
  return { left: (stage.width - width) / 2, top: (stage.height - height) / 2, scale: width / els.previewImg.naturalWidth, naturalWidth: els.previewImg.naturalWidth, naturalHeight: els.previewImg.naturalHeight };
}
function getImageFitScale(width, height) { return Math.min(els.cropStage.clientWidth / width, els.cropStage.clientHeight / height); }
function renderWarnings() { els.warningList.hidden = !state.warnings.length; els.warningList.innerHTML = state.warnings.map((warning) => `<div>• ${escapeHtml(warning)}</div>`).join(""); }
function renderResult() {
  els.textOutput.textContent = state.ocrResult?.plainText || "กด Run OCR เพื่อเริ่มประมวลผล";
  els.jsonOutput.textContent = state.ocrResult ? JSON.stringify(state.ocrResult.rawJson, null, 2) : "กด Run OCR เพื่อดู JSON";
  els.resultMeta.textContent = state.ocrResult ? `${state.ocrResult.apiLabel} · ${state.ocrResult.runtime} ms` : "พร้อมประมวลผล";
  [els.copyJsonBtn, els.downloadTextBtn, els.downloadJsonBtn].forEach((button) => button.disabled = !state.ocrResult);
  [els.copyOriginalJsonBtn, els.downloadOriginalJsonBtn, els.copyPostProcessJsonBtn, els.downloadPostProcessJsonBtn].forEach((button) => {
    if (button) button.disabled = !state.ocrResultClean;
  });
  renderResultImage();
  renderEncodedPayloadPanel();
  applyResultTabVisibility();
  renderComparePanel();
}
function renderComparePanel() {
  const panel = els.comparePanel;
  if (!panel) return;
  if (state.resultTab !== "json" || !state.ocrResult || !state.ocrResultClean) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const raw = state.ocrResult.rawJson;
  const clean = state.ocrResultClean.normalized || state.ocrResultClean;
  const changes = state.ocrResultClean.changes || [];
  const summary = state.ocrResultClean.summary || "";
  const orderedRaw = buildOrderedOriginalJson(raw, clean, changes);

  const summaryEl = els.compareSummary;
  if (summaryEl) summaryEl.textContent = summary;

  if (els.compareRawJson) els.compareRawJson.textContent = JSON.stringify(orderedRaw, null, 2);
  if (els.compareCleanJson) els.compareCleanJson.textContent = JSON.stringify(clean, null, 2);
}

function getCompareOriginalJson() {
  if (!state.ocrResult || !state.ocrResultClean) return null;
  const clean = state.ocrResultClean.normalized || state.ocrResultClean;
  return buildOrderedOriginalJson(state.ocrResult.rawJson, clean, state.ocrResultClean.changes || []);
}
function getComparePostProcessJson() {
  if (!state.ocrResultClean) return null;
  return state.ocrResultClean.normalized || state.ocrResultClean;
}
function buildOrderedOriginalJson(raw, clean, changes) {
  const { cleanToRaw } = buildRenameMaps(changes);
  return reorderOriginalToCleanShape(raw, clean, cleanToRaw);
}
function buildRenameMaps(changes) {
  const cleanToRaw = {};
  const rawToClean = {};
  for (const change of changes || []) {
    const match = String(change).match(/^renamed:\s*(.+?)\s*(?:→|->|โ’)\s*(.+)$/);
    if (!match) continue;
    const rawKey = match[1].trim();
    const cleanKey = match[2].trim();
    cleanToRaw[cleanKey] = rawKey;
    rawToClean[rawKey] = cleanKey;
  }
  return { cleanToRaw, rawToClean };
}
function reorderOriginalToCleanShape(rawNode, cleanNode, cleanToRaw) {
  if (Array.isArray(cleanNode)) {
    if (!Array.isArray(rawNode)) return rawNode;
    return cleanNode.map((item, index) => reorderOriginalToCleanShape(rawNode[index], item, cleanToRaw));
  }
  if (!cleanNode || typeof cleanNode !== "object" || !rawNode || typeof rawNode !== "object" || Array.isArray(rawNode)) {
    return rawNode;
  }

  const output = {};
  const usedRawKeys = new Set();
  for (const cleanKey of Object.keys(cleanNode)) {
    const rawKey = cleanToRaw[cleanKey] || cleanKey;
    if (Object.prototype.hasOwnProperty.call(rawNode, rawKey)) {
      output[rawKey] = reorderOriginalToCleanShape(rawNode[rawKey], cleanNode[cleanKey], cleanToRaw);
      usedRawKeys.add(rawKey);
    } else if (Object.prototype.hasOwnProperty.call(rawNode, cleanKey)) {
      output[cleanKey] = reorderOriginalToCleanShape(rawNode[cleanKey], cleanNode[cleanKey], cleanToRaw);
      usedRawKeys.add(cleanKey);
    }
  }
  for (const [key, value] of Object.entries(rawNode)) {
    if (!usedRawKeys.has(key)) output[key] = value;
  }
  return output;
}

function flattenForCompare(obj, prefix = "", result = {}) {
  if (!obj || typeof obj !== "object") return result;
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => flattenForCompare(item, `${prefix}[${i}]`, result));
    return result;
  }
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flattenForCompare(v, path, result);
    else result[path] = v;
  }
  return result;
}
function renderResultImage() {
  const preview = state.ocrImagePreview || {};
  const hasPreview = Boolean(preview.src || preview.message);
  els.resultImagePanel.hidden = !hasPreview;
  if (!hasPreview) {
    els.ocrFaceImage.removeAttribute("src");
    els.ocrFaceImage.hidden = true;
    els.ocrImageMessage.textContent = "";
    return;
  }
  els.ocrFaceImage.hidden = !preview.src;
  if (preview.src) els.ocrFaceImage.src = preview.src;
  else els.ocrFaceImage.removeAttribute("src");
  els.ocrImageMessage.textContent = preview.message || `Source: ${preview.key}`;
}
function renderDebug() { els.debugPanel.hidden = !state.debugMode; els.debugOutput.textContent = JSON.stringify(state.debugMode ? state.debug : {}, null, 2); }
function renderEncodedPayloadPanel() {
  const payloads = state.encodedPayloads || [];
  const visible = Boolean(payloads.length && state.resultTab === "json");
  els.encodedPayloadPanel.hidden = !visible;
  if (!visible) {
    els.encodedPayloadOutput.value = "";
    return;
  }
  const selectedIndex = Math.min(state.selectedEncodedPayloadIndex, payloads.length - 1);
  state.selectedEncodedPayloadIndex = selectedIndex;
  els.encodedPayloadSelect.innerHTML = payloads.map((payload, index) => `<option value="${index}">${escapeHtml(payload.path)} (${payload.length.toLocaleString()} chars)</option>`).join("");
  els.encodedPayloadSelect.value = String(selectedIndex);
  const payload = payloads[selectedIndex];
  els.encodedPayloadToggleBtn.textContent = state.encodedPayloadExpanded ? "Show Short" : "Show Full";
  els.encodedPayloadOutput.value = state.encodedPayloadExpanded ? payload.value : payload.preview;
}
function buildDebugInfo(api, file, status, runtime) {
  return {
    apiId: api.id,
    apiLabel: getApiDisplayLabel(api),
    endpoint: RUNTIME_CONFIG.PROXY_URL,
    preprocessEndpoint: RUNTIME_CONFIG.PREPROCESS_URL,
    method: api.method,
    formFileKey: api.formFileKey,
    extraFormFields: api.extraFormFields || {},
    authRequired: api.authRequired,
    authorization: api.authRequired ? "******" : "not required",
    useProxy: true,
    useImagePreprocess: RUNTIME_CONFIG.USE_IMAGE_PREPROCESS,
    mockMode: state.mockMode,
    originalFile: state.originalFile.name,
    originalSize: formatBytes(state.originalFile.size),
    processedFile: file.name,
    processedSize: formatBytes(file.size),
    responseStatus: status,
    runtime: `${runtime} ms`,
    pdf: state.isPdfMode ? {
      fileName: state.pdfFile?.name || state.originalFile.name,
      totalPages: state.pdfTotalPages,
      selectedPageIndex: state.selectedPdfPageIndex,
      selectedPageNumber: state.selectedPdfPageIndex + 1,
      renderScale: state.pdfRenderInfo?.scale,
      renderedPageWidth: state.pdfRenderInfo?.width,
      renderedPageHeight: state.pdfRenderInfo?.height,
      processedPageWidth: state.processedImageInfo?.width,
      processedPageHeight: state.processedImageInfo?.height,
      processedJpgSize: formatBytes(state.processedPdfPageFile?.size || 0),
      ocrMode: "selected page",
    } : null,
  };
}

async function normalizeOcrResponse(rawJson, api, runtime) {
  const source = unwrapOcrPayload(rawJson), fields = findReadableFields(source), directText = findDirectText(source);
  const encodedPayloads = collectEncodedPayloads(rawJson);
  const imagePreview = await extractImagePreview(rawJson, api);
  return { rawJson: sanitizeOcrPayload(rawJson), plainText: directText || formatFieldsAsText(fields) || "OCR สำเร็จ แต่ไม่พบข้อความที่สามารถแสดงผลได้", fields, runtime, apiId: api.id, apiLabel: getApiDisplayLabel(api), outputMode: api.outputMode, imagePreview, encodedPayloads };
}
function unwrapOcrPayload(payload) { const source = payload?.result ?? payload?.data ?? payload; return Array.isArray(source) ? source[0] ?? {} : source; }
function findReadableFields(source) { if (!source || typeof source !== "object") return {}; return source.label || source.fields || source.result?.label || source.result?.fields || source; }
function findDirectText(source) { if (!source || typeof source !== "object") return typeof source === "string" ? source.trim() : ""; return source.text || source.plainText || source.plain_text || source.ocrText || source.ocr_text || ""; }
function formatFieldsAsText(fields, prefix = "") {
  if (!fields || typeof fields !== "object") return String(fields || "").trim();
  return Object.entries(fields).filter(([key, value]) => !isSensitivePayloadKey(key) && !(isImagePayloadKey(key) && typeof value === "string" && value.length > 80) && value !== "" && value != null).flatMap(([key, value]) => {
    const label = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value)) return value.map((item, index) => formatFieldsAsText(item, `${label}[${index + 1}]`)).filter(Boolean);
    if (typeof value === "object") return formatFieldsAsText(value, label);
    return `${label}: ${value}`;
  }).filter(Boolean).join("\n");
}
function sanitizeOcrPayload(value, key = "") {
  if (typeof value === "string" && isEncodedPayloadValue(value, key)) return summarizeEncodedPayload(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeOcrPayload(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, sanitizeOcrPayload(childValue, childKey)]));
  return typeof value === "string" && value.length > 2000 ? `${value.slice(0, 240)}… [truncated ${value.length - 240} chars]` : value;
}
function isSensitivePayloadKey(key) { return /(?:b64|base64|compress|portrait|image_blob|image_data)/i.test(key); }
function isEncodedPayloadValue(value, key = "") {
  const text = String(value || "").trim();
  return text.length > 80 && (isSensitivePayloadKey(key) || isImagePayloadKey(key) || /^data:image\/[a-z0-9.+-]+;base64,/i.test(text) || looksLikeLongBase64(text));
}
function summarizeEncodedPayload(value) {
  const text = String(value || "").trim();
  const previewLength = 160;
  if (text.length <= previewLength) return text;
  return `${text.slice(0, previewLength)}… [shortened ${text.length.toLocaleString()} chars, open Encoded Payloads below for full value]`;
}
function makeEncodedPayloadPreview(value) {
  const text = String(value || "").trim();
  const head = text.slice(0, 320);
  const tail = text.length > 520 ? text.slice(-160) : "";
  return tail ? `${head}\n\n… [shortened ${text.length.toLocaleString()} chars]\n\n${tail}` : text;
}
function collectEncodedPayloads(payload) {
  const seen = new Set(), items = [];
  const scan = (value, key = "", path = "$") => {
    if (value && typeof value === "object") {
      if (seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) value.forEach((item, index) => scan(item, String(index), `${path}[${index}]`));
      else Object.entries(value).forEach(([childKey, childValue]) => scan(childValue, childKey, path === "$" ? childKey : `${path}.${childKey}`));
      return;
    }
    if (typeof value !== "string" || !isEncodedPayloadValue(value, key)) return;
    const text = value.trim();
    items.push({ key, path, value: text, length: text.length, preview: makeEncodedPayloadPreview(text) });
  };
  scan(payload);
  return items.sort((a, b) => getImagePayloadPriority(a.key) - getImagePayloadPriority(b.key) || b.length - a.length);
}
function looksLikeLongBase64(value) {
  const text = String(value || "").replace(/^data:[^,]+,/, "").replace(/\s/g, "");
  return text.length > 240 && text.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(text);
}
function clearOcrImagePreview() {
  state.ocrImagePreview = { src: "", key: "", message: "" };
  if (els.ocrFaceImage) els.ocrFaceImage.removeAttribute("src");
  if (els.resultImagePanel) els.resultImagePanel.hidden = true;
  if (els.ocrImageMessage) els.ocrImageMessage.textContent = "";
}
async function extractImagePreview(payload, api) {
  const imagePayload = extractImagePayload(payload);
  if (!imagePayload) return { src: "", key: "", message: "" };
  try {
    const decoded = await decodeOcrImagePayload(imagePayload.value, imagePayload.key);
    if (!decoded.src) return decoded;
    try {
      const uploadedPreview = await buildUploadedFileImagePreview(decoded, api);
      return uploadedPreview || decoded;
    } catch {
      return decoded;
    }
  } catch {
    return { src: "", key: imagePayload.key, message: "ไม่สามารถแสดงรูปจาก image payload ได้" };
  }
}
async function buildUploadedFileImagePreview(decodedPreview, api) {
  const sourceFile = state.isPdfMode ? state.selectedPdfPageImageFile : state.originalFile;
  if (!sourceFile || !canProcess(sourceFile)) return null;

  const previewImage = await loadImageFromSrc(decodedPreview.src);
  const sourceImage = await loadImage(sourceFile);
  const documentBox = getOriginalDocumentBox(sourceImage);
  const matchedRegion = findUploadedImageMatchRegion(sourceImage, previewImage, documentBox);
  const region = matchedRegion || getKnownDocumentImageRegion(api, previewImage, documentBox);
  if (!region) return null;

  const canvas = els.workCanvas;
  canvas.width = previewImage.naturalWidth || previewImage.width;
  canvas.height = previewImage.naturalHeight || previewImage.height;
  const ctx = canvas.getContext("2d");
  ctx.filter = "none";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(sourceImage, region.x, region.y, region.width, region.height, 0, 0, canvas.width, canvas.height);
  return {
    src: canvas.toDataURL("image/jpeg", 0.94),
    key: decodedPreview.key,
    message: `${matchedRegion ? "Source: uploaded file color match" : "Source: uploaded file"} (${decodedPreview.key})`,
  };
}
function getOriginalDocumentBox(sourceImage) {
  const width = sourceImage.naturalWidth || sourceImage.width;
  const height = sourceImage.naturalHeight || sourceImage.height;
  if (state.cropBox) {
    return {
      x: Math.max(0, Math.round(state.cropBox.x)),
      y: Math.max(0, Math.round(state.cropBox.y)),
      width: Math.max(1, Math.min(width - state.cropBox.x, Math.round(state.cropBox.width))),
      height: Math.max(1, Math.min(height - state.cropBox.y, Math.round(state.cropBox.height))),
    };
  }
  return { x: 0, y: 0, width, height };
}
function findUploadedImageMatchRegion(sourceImage, previewImage, documentBox) {
  const previewWidth = previewImage.naturalWidth || previewImage.width || 0;
  const previewHeight = previewImage.naturalHeight || previewImage.height || 0;
  if (previewWidth < 8 || previewHeight < 8 || documentBox.width < 16 || documentBox.height < 16) return null;

  const aspect = previewWidth / Math.max(1, previewHeight);
  const scaledSource = getScaledDocumentImageData(sourceImage, documentBox, 340);
  const sampleWidth = clampInt(Math.round(28 * Math.sqrt(aspect)), 16, 44);
  const sampleHeight = clampInt(Math.round(sampleWidth / aspect), 16, 44);
  const targetFeature = getNormalizedImageFeature(previewImage, sampleWidth, sampleHeight);
  if (!targetFeature) return null;

  const sizes = buildImagePreviewCandidateSizes(scaledSource.width, scaledSource.height, aspect);
  let best = null;
  for (const size of sizes) {
    best = scanImagePreviewCandidates(scaledSource, targetFeature, size, sampleWidth, sampleHeight, best);
  }
  if (!best) return null;

  best = refineImagePreviewCandidate(scaledSource, targetFeature, best, sampleWidth, sampleHeight);
  if (!best || best.score < 0.18) return null;

  return {
    x: documentBox.x + best.x / scaledSource.scale,
    y: documentBox.y + best.y / scaledSource.scale,
    width: best.width / scaledSource.scale,
    height: best.height / scaledSource.scale,
  };
}
function getScaledDocumentImageData(sourceImage, documentBox, maxDimension) {
  const scale = Math.min(1, maxDimension / Math.max(documentBox.width, documentBox.height));
  const width = Math.max(1, Math.round(documentBox.width * scale));
  const height = Math.max(1, Math.round(documentBox.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.filter = "none";
  ctx.imageSmoothingEnabled = true;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(sourceImage, documentBox.x, documentBox.y, documentBox.width, documentBox.height, 0, 0, width, height);
  return { data: ctx.getImageData(0, 0, width, height).data, width, height, scale };
}
function getNormalizedImageFeature(image, sampleWidth, sampleHeight) {
  const canvas = document.createElement("canvas");
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.filter = "none";
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(image, 0, 0, sampleWidth, sampleHeight);
  return normalizeFeatureValues(getLumaValues(ctx.getImageData(0, 0, sampleWidth, sampleHeight).data));
}
function buildImagePreviewCandidateSizes(sourceWidth, sourceHeight, aspect) {
  const ratios = [0.1, 0.13, 0.16, 0.2, 0.25, 0.32, 0.4, 0.5, 0.62, 0.76, 0.9, 1];
  const sizes = [];
  const seen = new Set();
  const addSize = (width, height) => {
    width = Math.round(width);
    height = Math.round(height);
    if (width < 12 || height < 12 || width > sourceWidth || height > sourceHeight) return;
    const key = `${width}x${height}`;
    if (seen.has(key)) return;
    seen.add(key);
    sizes.push({ width, height });
  };
  for (const ratio of ratios) {
    addSize(sourceWidth * ratio, sourceWidth * ratio / aspect);
    addSize(sourceHeight * ratio * aspect, sourceHeight * ratio);
  }
  return sizes.sort((a, b) => a.width * a.height - b.width * b.height);
}
function scanImagePreviewCandidates(source, targetFeature, size, sampleWidth, sampleHeight, best) {
  const stride = Math.max(3, Math.round(Math.min(size.width, size.height) / 5));
  for (let y = 0; y <= source.height - size.height; y += stride) {
    for (let x = 0; x <= source.width - size.width; x += stride) {
      const feature = getNormalizedRegionFeature(source, x, y, size.width, size.height, sampleWidth, sampleHeight);
      if (!feature) continue;
      const score = scoreFeatureMatch(targetFeature, feature);
      if (!best || score > best.score) best = { x, y, width: size.width, height: size.height, score, stride };
    }
  }
  return best;
}
function refineImagePreviewCandidate(source, targetFeature, best, sampleWidth, sampleHeight) {
  const range = Math.max(4, best.stride * 2);
  const stride = Math.max(1, Math.round(best.stride / 3));
  const startX = Math.max(0, best.x - range);
  const endX = Math.min(source.width - best.width, best.x + range);
  const startY = Math.max(0, best.y - range);
  const endY = Math.min(source.height - best.height, best.y + range);
  let refined = best;
  for (let y = startY; y <= endY; y += stride) {
    for (let x = startX; x <= endX; x += stride) {
      const feature = getNormalizedRegionFeature(source, x, y, best.width, best.height, sampleWidth, sampleHeight);
      if (!feature) continue;
      const score = scoreFeatureMatch(targetFeature, feature);
      if (score > refined.score) refined = { ...best, x, y, score };
    }
  }
  return refined;
}
function getNormalizedRegionFeature(source, x, y, width, height, sampleWidth, sampleHeight) {
  const values = [];
  for (let sampleY = 0; sampleY < sampleHeight; sampleY++) {
    const py = Math.min(source.height - 1, Math.max(0, Math.round(y + (sampleY + 0.5) * height / sampleHeight)));
    for (let sampleX = 0; sampleX < sampleWidth; sampleX++) {
      const px = Math.min(source.width - 1, Math.max(0, Math.round(x + (sampleX + 0.5) * width / sampleWidth)));
      const index = (py * source.width + px) * 4;
      values.push(0.299 * source.data[index] + 0.587 * source.data[index + 1] + 0.114 * source.data[index + 2]);
    }
  }
  return normalizeFeatureValues(values);
}
function getLumaValues(data) {
  const values = [];
  for (let index = 0; index < data.length; index += 4) {
    values.push(0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]);
  }
  return values;
}
function normalizeFeatureValues(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length);
  const std = Math.sqrt(variance);
  if (std < 3) return null;
  return values.map((value) => (value - mean) / std);
}
function scoreFeatureMatch(a, b) {
  let score = 0;
  for (let index = 0; index < a.length; index++) score += a[index] * b[index];
  return score / Math.max(1, a.length);
}
function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function getKnownDocumentImageRegion(api, previewImage, documentBox) {
  const previewWidth = previewImage.naturalWidth || previewImage.width || 1;
  const previewHeight = previewImage.naturalHeight || previewImage.height || 1;
  const imageAspect = previewWidth / Math.max(1, previewHeight);
  const documentAspect = documentBox.width / Math.max(1, documentBox.height);
  const apiId = api?.id || state.selectedApiId || "";
  const documentType = api?.documentType || "";

  if (apiId.startsWith("front-id") || documentType === "idCardFront") {
    return buildRelativeCropRegion(documentBox, {
      centerX: 0.84,
      centerY: 0.68,
      widthRatio: 0.24,
      imageAspect,
      documentAspect,
      maxHeightRatio: 0.48,
    });
  }

  if (apiId.startsWith("passport") || documentType === "passport") {
    return buildRelativeCropRegion(documentBox, {
      centerX: 0.22,
      centerY: 0.52,
      widthRatio: 0.30,
      imageAspect,
      documentAspect,
      maxHeightRatio: 0.62,
    });
  }

  return null;
}
function buildRelativeCropRegion(documentBox, options) {
  const heightRatio = Math.min(
    options.maxHeightRatio,
    options.widthRatio * options.documentAspect / Math.max(0.2, options.imageAspect),
  );
  const width = documentBox.width * options.widthRatio;
  const height = documentBox.height * heightRatio;
  const centerX = documentBox.x + documentBox.width * options.centerX;
  const centerY = documentBox.y + documentBox.height * options.centerY;
  const x = Math.max(documentBox.x, Math.min(centerX - width / 2, documentBox.x + documentBox.width - width));
  const y = Math.max(documentBox.y, Math.min(centerY - height / 2, documentBox.y + documentBox.height - height));
  return { x, y, width, height };
}
function extractImagePayload(payload) {
  const seen = new Set(), candidates = [];
  const scan = (value, key = "") => {
    if (value && typeof value === "object") {
      if (seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) value.forEach((item, index) => scan(item, `${key}[${index}]`));
      else Object.entries(value).forEach(([childKey, childValue]) => scan(childValue, childKey));
      return;
    }
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (trimmed.length < 80 && !/^data:image\//i.test(trimmed)) return;
    if (isImagePayloadKey(key) || /^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed)) {
      candidates.push({ key, value: trimmed, priority: getImagePayloadPriority(key) });
    }
  };
  scan(payload);
  return candidates.sort((a, b) => a.priority - b.priority)[0] || null;
}
function isImagePayloadKey(key) {
  return /(?:idpic|face|portrait|photo|picture|image|img|b64|base64|compress|blob)/i.test(key);
}
function getImagePayloadPriority(key) {
  if (/idpic_b64_zlib_compress/i.test(key)) return 0;
  if (/idpic|face|portrait/i.test(key)) return 1;
  if (/image|photo|picture|img/i.test(key)) return 2;
  return 3;
}
async function decodeOcrImagePayload(value, key) {
  const raw = String(value || "").trim();
  const dataUrlMatch = raw.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  const cleanBase64 = (dataUrlMatch ? dataUrlMatch[2] : raw).replace(/\s/g, "");
  let bytes;
  try {
    bytes = base64ToUint8Array(cleanBase64);
  } catch {
    return { src: "", key, message: "พบ image payload แต่รูปแบบ base64 ไม่ถูกต้อง" };
  }

  const directMime = dataUrlMatch?.[1] || detectImageMime(bytes);
  if (directMime) {
    return { src: `data:${directMime};base64,${cleanBase64}`, key, message: `Source: ${key}` };
  }

  if (!/(?:zlib|compress)/i.test(key)) {
    return { src: "", key, message: "พบ image payload แต่ไม่ใช่รูปภาพ base64 ที่แสดงได้โดยตรง" };
  }

  try {
    const inflated = await inflateZlibBytes(bytes);
    const inflatedMime = detectImageMime(inflated);
    if (inflatedMime) {
      return { src: `data:${inflatedMime};base64,${uint8ArrayToBase64(inflated)}`, key, message: `Source: ${key}` };
    }
    const inflatedText = new TextDecoder().decode(inflated).trim().replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
    const inflatedTextBytes = base64ToUint8Array(inflatedText.replace(/\s/g, ""));
    const textMime = detectImageMime(inflatedTextBytes);
    if (textMime) {
      return { src: `data:${textMime};base64,${inflatedText.replace(/\s/g, "")}`, key, message: `Source: ${key}` };
    }
  } catch {
    return { src: "", key, message: "ไม่สามารถแสดงรูปจาก compressed payload ได้ ต้องใช้ zlib decoder เพิ่มเติม" };
  }
  return { src: "", key, message: "ไม่สามารถแสดงรูปจาก compressed payload ได้ ต้องใช้ zlib decoder เพิ่มเติม" };
}
function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
function detectImageMime(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length > 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return "";
}
async function inflateZlibBytes(bytes) {
  if (window.pako?.inflate) return window.pako.inflate(bytes);
  if (!window.DecompressionStream) throw new Error("No zlib decoder");
  return inflateWithDecompressionStream(bytes, "deflate");
}
async function inflateWithDecompressionStream(bytes, format) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function uint8ArrayToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}
function buildMockResponse(api) {
  const samples = { idCardFront: { IdNumber: "1-2345-67890-12-3", NameLastnameThai: "นาย ตัวอย่าง ทดสอบ" }, idCardBack: { LaserCode: "ME0-0000000-00" }, passport: { PassportNo: "AA0000000", Name: "SAMPLE TEST" }, customDocument: { text: "ตัวอย่างข้อความจากเอกสารทั่วไป" } };
  return { success: true, mode: "mock", result: { ...samples[api.documentType], text: Object.entries(samples[api.documentType]).map(([key, value]) => `${key}: ${value}`).join("\n") } };
}

async function analyzeFile(file) {
  if (getFileKind(file) === "pdf") return ["PDF จะถูกแปลงเป็นภาพรายหน้าก่อน OCR และห้ามส่ง PDF ต้นฉบับเข้า OCR API โดยตรง"];
  if (!canProcess(file)) return ["ไฟล์ประเภทนี้อัปโหลดได้ แต่ Browser อาจไม่รองรับ Preview หรือ Crop ระบบจะส่งไฟล์ต้นฉบับเข้า OCR"];
  try {
    const img = await loadImage(file), warnings = [];
    if (Math.min(img.width, img.height) < 900) warnings.push("ภาพมีความละเอียดต่ำ อาจทำให้ OCR อ่านข้อมูลได้ไม่ครบ");
    return warnings;
  } catch { return ["Browser ไม่สามารถวิเคราะห์ภาพนี้ได้ ระบบจะส่งไฟล์ต้นฉบับเข้า OCR"]; }
}
function loadImage(file) { return new Promise((resolve, reject) => { const url = URL.createObjectURL(file), img = new Image(); img.onload = () => { URL.revokeObjectURL(url); resolve(img); }; img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Cannot load image")); }; img.src = url; }); }
function loadImageFromSrc(src) { return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("Cannot load image preview")); img.src = src; }); }
async function readImageInfo(file) { const img = await loadImage(file); return { width: img.width, height: img.height }; }
function canvasToBlob(canvas, quality) { return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Canvas export failed")), "image/jpeg", quality)); }
function setProcessedImageUrl(file) { revokeObjectUrl(state.processedImageUrl); state.processedImageUrl = file ? URL.createObjectURL(file) : ""; }
function showResultTab(tab) {
  state.resultTab = tab === "json" ? "json" : "text";
  applyResultTabVisibility();
  renderEncodedPayloadPanel();
  renderComparePanel();
}
function applyResultTabVisibility() {
  const json = state.resultTab === "json";
  const hasCompareJson = Boolean(state.ocrResult && state.ocrResultClean);
  els.textOutput.hidden = json;
  els.jsonOutput.hidden = !json || hasCompareJson;
  els.textTab.classList.toggle("active", !json);
  els.jsonTab.classList.toggle("active", json);
}
function setLoading(value) { state.loading = value; els.loading.hidden = !value; els.runOcrBtn.disabled = value; els.cancelOcrBtn.hidden = !value; }
function abortCurrentRequest() { state.controller?.abort(); }
function cancelOcrSession() {
  clearCurrentDocument();
  state.page = "home";
  render();
  showMessage("home", "ยกเลิก OCR และล้างข้อมูลเอกสารออกจากหน้านี้แล้ว");
}
function goHome() { clearCurrentDocument(); state.page = "home"; if (els.homeMessage) els.homeMessage.hidden = true; if (els.workspaceMessage) els.workspaceMessage.hidden = true; render(); }
function clearDataAndReturnHome() {
  clearCurrentDocument();
  state.page = "home";
  render();
  showMessage("home", "ล้างข้อมูลเอกสารออกจากหน้านี้แล้ว");
}
function clearCurrentDocument() {
  clearSensitiveData();
  resetPreviewView();
}
function clearSensitiveData() {
  clearPrivacyAutoClearTimer();
  abortCurrentRequest();
  state.controller = null;
  setLoading(false);
  stopCamera();
  revokeObjectUrl(state.originalImageUrl);
  revokeObjectUrl(state.processedImageUrl);
  revokeObjectUrl(state.selectedPdfPageImageUrl);
  Object.assign(state, {
    originalFile: null,
    originalImageUrl: "",
    processedFile: null,
    processedImageUrl: "",
    fileKind: "",
    workspaceMode: "crop",
    cropBox: null,
    detectedCropBox: null,
    manualCropBox: null,
    ocrResult: null,
    warnings: [],
    debug: {},
    isPdfMode: false,
    pdfFile: null,
    pdfDocument: null,
    pdfTotalPages: 0,
    pdfRenderedPages: [],
    selectedPdfPageIndex: 0,
    selectedPdfPageImageFile: null,
    selectedPdfPageImageUrl: "",
    processedPdfPageFile: null,
    pdfRenderInfo: null,
    processedImageInfo: null,
    pdfOcrResults: [],
    ocrImagePreview: { src: "", key: "", message: "" },
    encodedPayloads: [],
    selectedEncodedPayloadIndex: 0,
    encodedPayloadExpanded: false,
  });
  clearImageElements();
  renderEncodedPayloadPanel();
  clearWorkCanvas();
  if (els.fileInput) els.fileInput.value = "";
}
function clearOcrResultData() {
  clearPrivacyAutoClearTimer();
  state.ocrResult = null;
  state.ocrResultClean = null;
  state.debug = {};
  state.pdfOcrResults = [];
  state.encodedPayloads = [];
  state.selectedEncodedPayloadIndex = 0;
  state.encodedPayloadExpanded = false;
  clearOcrImagePreview();
  renderEncodedPayloadPanel();
}
function clearSelectedPdfPageData() {
  revokeObjectUrl(state.selectedPdfPageImageUrl);
  setProcessedImageUrl(null);
  Object.assign(state, {
    selectedPdfPageImageFile: null,
    selectedPdfPageImageUrl: "",
    processedPdfPageFile: null,
    processedImageInfo: null,
    pdfRenderInfo: null,
    cropBox: null,
    detectedCropBox: null,
    manualCropBox: null,
  });
  clearOcrResultData();
  clearWorkCanvas();
}
function schedulePrivacyAutoClear() {
  clearPrivacyAutoClearTimer();
  state.privacyClearTimer = window.setTimeout(() => {
    clearCurrentDocument();
    state.page = "home";
    render();
    showMessage("home", "ระบบล้างข้อมูลเอกสารอัตโนมัติหลังจบ OCR session แล้ว");
  }, OCR_RESULT_AUTO_CLEAR_MS);
}
function clearPrivacyAutoClearTimer() {
  if (state.privacyClearTimer) window.clearTimeout(state.privacyClearTimer);
  state.privacyClearTimer = null;
}
function clearImageElements() {
  if (els.previewImg) els.previewImg.removeAttribute("src");
  if (els.previewDoc) els.previewDoc.removeAttribute("data");
  if (els.ocrFaceImage) {
    els.ocrFaceImage.removeAttribute("src");
    els.ocrFaceImage.hidden = true;
  }
  if (els.resultImagePanel) els.resultImagePanel.hidden = true;
  if (els.ocrImageMessage) els.ocrImageMessage.textContent = "";
}
function clearWorkCanvas() {
  if (!els.workCanvas) return;
  const ctx = els.workCanvas.getContext("2d");
  ctx.clearRect(0, 0, els.workCanvas.width, els.workCanvas.height);
  els.workCanvas.width = 0;
  els.workCanvas.height = 0;
}
function revokeObjectUrl(url) { if (url) URL.revokeObjectURL(url); }
function showMessage(scope, text, isError = false) { const el = scope === "workspace" ? els.workspaceMessage : els.homeMessage; el.textContent = text; el.className = `message${scope === "workspace" ? " workspace-message" : ""}${isError ? " error" : ""}`; el.hidden = false; }
function addWarning(text) { if (!state.warnings.includes(text)) state.warnings.push(text); renderWarnings(); }
function getSelectedApi() { return OCR_APIS.find((item) => item.id === state.selectedApiId) || OCR_APIS[0]; }
function getFileKind(file) { if (/\.pdf$/i.test(file.name)) return "pdf"; if (/\.tiff?$/i.test(file.name)) return "tiff"; return "image"; }
function canProcess(file) { return Boolean(file && PROCESSABLE.test(file.name)); }
function getCropSourceFile() { return state.isPdfMode ? state.selectedPdfPageImageFile : state.originalFile; }
function getOcrFile() { return state.isPdfMode ? state.processedPdfPageFile : state.processedFile || state.originalFile; }
function getActiveDisplayFile() {
  if (state.workspaceMode === "preview") return getOcrFile();
  if (state.isPdfMode) return state.selectedPdfPageImageFile || state.originalFile;
  return state.originalFile;
}
function getActiveDisplayUrl() {
  if (state.workspaceMode === "preview" && state.processedImageUrl) return state.processedImageUrl;
  if (state.isPdfMode) return state.selectedPdfPageImageUrl;
  return state.originalImageUrl;
}
function buildImageMeta(file) {
  if (state.workspaceMode === "pdf-pages") return `${state.originalFile.name} · PDF ทั้งหมด ${state.pdfTotalPages || 0} หน้า`;
  if (!file) return state.isPdfMode ? `${state.originalFile.name} · กรุณาเลือกหน้า PDF` : "ยังไม่มีเอกสาร";
  const pdfPage = state.isPdfMode ? ` · Page ${state.selectedPdfPageIndex + 1} of ${state.pdfTotalPages}` : "";
  const dimensions = state.workspaceMode === "preview" && state.processedImageInfo ? ` · ${state.processedImageInfo.width} × ${state.processedImageInfo.height} px · Cropped / Enhanced / Ready for OCR` : "";
  return `${file.name}${pdfPage} · ${formatBytes(file.size)}${dimensions}`;
}
function canPreviewImage() { return canProcess(getActiveDisplayFile()); }
function parseJson(text) { try { return JSON.parse(text); } catch { return null; } }
function getErrorText(payload) { return payload?.message || payload?.error || payload?.detail || ""; }
function delay(ms, signal) { return new Promise((resolve, reject) => { const timer = setTimeout(resolve, ms); signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Request aborted", "AbortError")); }, { once: true }); }); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function formatBytes(bytes) { if (!bytes) return "0 B"; const units = ["B","KB","MB","GB"], index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1); return `${(bytes / 1024 ** index).toFixed(index && bytes / 1024 ** index < 10 ? 1 : 0)} ${units[index]}`; }
async function refreshApiStatus() { try { const response = await fetch("/api/ocr/status"); if (!response.ok) return; state.apiStatus = (await response.json()).apis || {}; renderApiList(); showSelectedApiNotice(); } catch { showMessage("workspace", "เชื่อมต่อ Backend Proxy ไม่สำเร็จ กรุณาเปิดระบบด้วย python OCR/Backend/P2.py หรือ uvicorn OCR.Backend.P2:app --host 127.0.0.1 --port 3000", true); } }
function showSelectedApiNotice() { const api = getSelectedApi(); if (api.authRequired && state.apiStatus[api.id]?.available === false) showMessage("workspace", "API Other ต้องใช้ token ฝั่ง server: กำหนด OCR_OTHER_AUTH_TOKEN ในไฟล์ .env แล้วเปิด server ใหม่", true); else if (!state.loading) els.workspaceMessage.hidden = true; }
async function copyJson() { if (!state.ocrResult) return; await navigator.clipboard.writeText(JSON.stringify(state.ocrResult.rawJson, null, 2)); showMessage("workspace", "Copy JSON เรียบร้อยแล้ว"); }
async function copyCompareOriginalJson() {
  const payload = getCompareOriginalJson();
  if (!payload) return;
  await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  showMessage("workspace", "Copy Original JSON เรียบร้อยแล้ว");
}
async function copyComparePostProcessJson() {
  const payload = getComparePostProcessJson();
  if (!payload) return;
  await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  showMessage("workspace", "Copy Post Process JSON เรียบร้อยแล้ว");
}
async function copyEncodedPayload() {
  const payload = state.encodedPayloads?.[state.selectedEncodedPayloadIndex];
  if (!payload) return;
  await navigator.clipboard.writeText(payload.value);
  showMessage("workspace", "Copy encoded payload แบบเต็มเรียบร้อยแล้ว");
}
function downloadText() { if (state.ocrResult) downloadFile(state.ocrResult.plainText, "text/plain", "txt"); }
function downloadJson() { if (state.ocrResult) downloadFile(JSON.stringify(state.ocrResult.rawJson, null, 2), "application/json", "json"); }
function downloadCompareOriginalJson() {
  const payload = getCompareOriginalJson();
  if (payload) downloadFile(JSON.stringify(payload, null, 2), "application/json", "json", "ocr-original-json");
}
function downloadComparePostProcessJson() {
  const payload = getComparePostProcessJson();
  if (payload) downloadFile(JSON.stringify(payload, null, 2), "application/json", "json", "ocr-post-process-json");
}
function downloadFile(content, type, extension, name = "ocr-result") { const url = URL.createObjectURL(new Blob([content], { type })), link = document.createElement("a"); link.href = url; link.download = `${name}-${new Date().toISOString().slice(0, 10)}.${extension}`; link.click(); URL.revokeObjectURL(url); }
