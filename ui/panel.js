const captureStatus = document.getElementById("captureStatus");
const preview = document.getElementById("preview");
const question = document.getElementById("question");
const analyzeBtn = document.getElementById("analyzeBtn");
const sendBtn = document.getElementById("sendBtn");
const stepNav = document.getElementById("stepNav");
const prevStepBtn = document.getElementById("prevStepBtn");
const nextStepBtn = document.getElementById("nextStepBtn");
const stepNavLabel = document.getElementById("stepNavLabel");
const response = document.getElementById("response");
const closeBtn = document.getElementById("closeBtn");
const providerEl = document.getElementById("provider");
const apiKeyEl = document.getElementById("apiKey");
const saveKeyBtn = document.getElementById("saveKeyBtn");
const captureAgainBtn = document.getElementById("captureAgainBtn");
const settingsPanel = document.getElementById("settingsPanel");
const capturePanel = document.getElementById("capturePanel");
const toggleSettingsBtn = document.getElementById("toggleSettingsBtn");
const toggleCaptureBtn = document.getElementById("toggleCaptureBtn");
const startDiyBtn = document.getElementById("startDiyBtn");
const stopDiyBtn = document.getElementById("stopDiyBtn");

let latestScreenshot = null;
let latestCaptureMeta = null;
let latestGuidance = null;
let latestOcrElements = [];
let latestUiTreeElements = [];
let lastPrimaryQuestion = "";
let currentStepIndex = 0;
let latestOverlaySteps = [];
let lastResolvedRegion = null;

let operationInFlight = false;

let diyModeEnabled = false;
let diyTimer = null;
let diyInFlight = false;
let lastDiySignature = "";
const MAX_AI_IMAGE_EDGE = 1600;
const AI_IMAGE_QUALITY = 0.82;
const STEP_CONFIDENCE_MIN = 0.78;
const MAX_OVERLAY_STEPS = 12;
const OCR_CACHE_MAX = 20;
const ANALYZE_CACHE_MAX = 30;
const ocrExtractionCache = new Map();
const analyzeResultCache = new Map();

function getQuickHelpText() {
  return [
    "How each button works:",
    "S: Open or hide API settings. Use this to choose provider and save your API key.",
    "C: Open or hide the screenshot/capture panel. Use it to view the latest capture and run Capture Again.",
    "N: Analyze the current screen one time only and return guidance for this single capture.",
    "D: Continuously take frequent screenshots and guide you step by step as the screen changes (you perform actions manually).",
    "d: Stop DIY mode immediately.",
    "Send: Capture the current screen and analyze your typed message once.",
    "On-screen prompts: shown only for high-confidence targets with anchor text match.",
    "Matching engine: local OCR + UI tree (when available) + fuzzy anchor resolution.",
    "Smart mode: region-aware filtering and local caching improve repeated-screen speed/accuracy.",
    "x: Close the assistant panel."
  ].join("\n");
}

async function captureCurrentScreen() {
  return window.panelApi.captureScreen();
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode screenshot."));
    img.src = dataUrl;
  });
}

async function prepareScreenshotForAi(dataUrl) {
  if (!dataUrl) {
    throw new Error("No screenshot available.");
  }
  const img = await loadImageFromDataUrl(dataUrl);
  const longEdge = Math.max(img.width, img.height);
  if (longEdge <= MAX_AI_IMAGE_EDGE) {
    return dataUrl;
  }

  const scale = MAX_AI_IMAGE_EDGE / longEdge;
  const targetW = Math.max(1, Math.round(img.width * scale));
  const targetH = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, targetW, targetH);
  return canvas.toDataURL("image/jpeg", AI_IMAGE_QUALITY);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(a, b) {
  const s = normalizeForMatch(a);
  const t = normalizeForMatch(b);
  const m = s.length;
  const n = t.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function fuzzySimilarity(a, b) {
  const s = normalizeForMatch(a);
  const t = normalizeForMatch(b);
  if (!s || !t) return 0;
  if (s === t) return 1;

  const sTokens = new Set(s.split(" ").filter(Boolean));
  const tTokens = new Set(t.split(" ").filter(Boolean));
  let inter = 0;
  sTokens.forEach((token) => {
    if (tTokens.has(token)) inter += 1;
  });
  const union = new Set([...sTokens, ...tTokens]).size || 1;
  const tokenScore = inter / union;

  const edit = levenshteinDistance(s, t);
  const editScore = 1 - edit / Math.max(s.length, t.length, 1);
  return Math.max(0, Math.min(1, tokenScore * 0.55 + editScore * 0.45));
}

function resolveAnchorsWithOcr(guidance, ocrElements) {
  if (!guidance?.steps?.length || !Array.isArray(ocrElements) || !ocrElements.length) {
    return guidance;
  }

  const steps = guidance.steps.map((step) => {
    const action = String(step?.action || "").toLowerCase();
    if (!(action === "click" || action === "double_click" || action === "type")) {
      return step;
    }
    const anchor = step.anchorText || step.target || step.instruction || "";
    if (!anchor) {
      return step;
    }

    let best = null;
    let bestScore = 0;
    for (const el of ocrElements) {
      const score = fuzzySimilarity(anchor, el?.text || "");
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    if (!best || bestScore < 0.72 || !best.bbox) {
      return step;
    }

    const mergedConfidence = Math.max(getStepConfidence(step), Math.min(0.99, bestScore));
    return {
      ...step,
      bbox: best.bbox,
      confidence: mergedConfidence,
      anchorText: step.anchorText || best.text,
      resolvedBy: "ocr-anchor"
    };
  });
  return { ...guidance, steps };
}

function inferTemplateHintFromText(value) {
  const text = normalizeForMatch(value);
  if (!text) return "";
  if (text.includes("setting") || text.includes("gear")) return "settings";
  if (text.includes("menu") || text.includes("hamburger")) return "menu";
  if (text.includes("search") || text.includes("find")) return "search";
  if (text.includes("close") || text.includes("cancel") || text.includes("x")) return "close";
  if (text.includes("back") || text.includes("previous")) return "back";
  if (text.includes("next") || text.includes("continue")) return "next";
  return "";
}

function predictAction(step) {
  const action = String(step?.action || "read").toLowerCase();
  const text = normalizeForMatch(
    [step?.instruction, step?.target, step?.anchorText, step?.textToType, step?.controlType].join(" ")
  );
  if (step?.textToType && (action === "read" || action === "click" || action === "verify")) {
    return "type";
  }
  if (text.includes("scroll") && action !== "open_url" && action !== "open_local_html") {
    return "scroll";
  }
  if ((text.includes("input") || text.includes("field") || text.includes("textbox")) && step?.textToType) {
    return "type";
  }
  return action;
}

function applyActionPrediction(guidance) {
  if (!guidance?.steps?.length) return guidance;
  const steps = guidance.steps.map((step) => {
    const predictedAction = predictAction(step);
    const templateHint =
      step.templateHint ||
      inferTemplateHintFromText([step?.target, step?.instruction, step?.anchorText].join(" "));
    return {
      ...step,
      action: predictedAction,
      templateHint
    };
  });
  return { ...guidance, steps };
}

function resolveAnchorsWithUiTree(guidance, uiElements) {
  if (!guidance?.steps?.length || !Array.isArray(uiElements) || !uiElements.length) {
    return guidance;
  }
  const steps = guidance.steps.map((step) => {
    const action = String(step?.action || "").toLowerCase();
    if (!(action === "click" || action === "double_click" || action === "type")) {
      return step;
    }
    const anchor = step.anchorText || step.target || step.instruction || "";
    if (!anchor) return step;

    let best = null;
    let bestScore = 0;
    for (const el of uiElements) {
      const base = fuzzySimilarity(anchor, el?.name || "");
      let typeBoost = 0;
      const ctype = normalizeForMatch(el?.controlType || "");
      if (action === "click" || action === "double_click") {
        if (ctype.includes("button") || ctype.includes("menu") || ctype.includes("tab")) typeBoost = 0.08;
      }
      if (action === "type") {
        if (ctype.includes("edit") || ctype.includes("text")) typeBoost = 0.1;
      }
      const score = Math.min(1, base + typeBoost);
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (!best || bestScore < 0.7 || !best.bbox) return step;
    return {
      ...step,
      bbox: best.bbox,
      confidence: Math.max(getStepConfidence(step), Math.min(0.99, bestScore)),
      anchorText: step.anchorText || best.name,
      controlType: best.controlType || step.controlType || "",
      resolvedBy: "ui-tree-anchor"
    };
  });
  return { ...guidance, steps };
}

function resolveTemplateHints(guidance, ocrElements, uiElements) {
  if (!guidance?.steps?.length) return guidance;
  const combined = [
    ...(Array.isArray(uiElements) ? uiElements.map((el) => ({ text: el.name, bbox: el.bbox })) : []),
    ...(Array.isArray(ocrElements) ? ocrElements : [])
  ];
  if (!combined.length) return guidance;

  const hintWords = {
    settings: ["settings", "preferences", "gear"],
    menu: ["menu", "more", "options"],
    search: ["search", "find"],
    close: ["close", "cancel"],
    back: ["back", "previous"],
    next: ["next", "continue"]
  };

  const steps = guidance.steps.map((step) => {
    if (step?.bbox || !step?.templateHint) return step;
    const words = hintWords[String(step.templateHint).toLowerCase()] || [];
    if (!words.length) return step;
    let best = null;
    let bestScore = 0;
    for (const el of combined) {
      const text = normalizeForMatch(el?.text || "");
      const hit = words.some((w) => text.includes(w));
      if (!hit) continue;
      const score = 0.68 + Math.min(0.25, text.length / 80);
      if (score > bestScore && el?.bbox) {
        bestScore = score;
        best = el;
      }
    }
    if (!best) return step;
    return {
      ...step,
      bbox: best.bbox,
      confidence: Math.max(getStepConfidence(step), bestScore),
      resolvedBy: "template-hint"
    };
  });
  return { ...guidance, steps };
}

function deriveRegionFromGuidance(guidance) {
  const steps = Array.isArray(guidance?.steps) ? guidance.steps : [];
  const targetBoxes = steps
    .filter((step) => isTargetStep(step) && step?.bbox && getStepConfidence(step) >= 0.65)
    .map((step) => step.bbox);
  const union = unionBoxes(targetBoxes);
  return expandRegion(union, 0.09);
}

function getStepConfidence(step) {
  const raw = Number(step?.confidence);
  if (!Number.isFinite(raw)) {
    return 0;
  }
  return Math.max(0, Math.min(1, raw));
}

function isTargetStep(step) {
  const action = String(step?.action || "").toLowerCase();
  return action === "click" || action === "type" || action === "double_click";
}

function isStepTrusted(step) {
  if (!isTargetStep(step)) {
    return true;
  }
  const confidence = getStepConfidence(step);
  const hasAnchor = String(step?.anchorText || "").trim().length >= 2;
  return confidence >= STEP_CONFIDENCE_MIN && hasAnchor;
}

function getOverlayEligibleSteps(guidance) {
  const steps = Array.isArray(guidance?.steps) ? guidance.steps : [];
  return steps
    .filter((step) => {
      const action = String(step?.action || "").toLowerCase();
      const hasBox = Boolean(step?.bbox);
      const supportsOverlay = action === "click" || action === "double_click" || action === "type";
      return supportsOverlay && hasBox && isStepTrusted(step);
    })
    .slice(0, MAX_OVERLAY_STEPS)
    .map((step) => ({
      step: step.step,
      action: step.action,
      target: step.target,
      instruction: step.instruction,
      anchorText: step.anchorText,
      templateHint: step.templateHint || "",
      controlType: step.controlType || "",
      textToType: step.textToType || "",
      howToGet: step.howToGet || "",
      confidence: getStepConfidence(step),
      bbox: step.bbox
    }));
}

function updateStepNavUi() {
  const total = latestOverlaySteps.length;
  const show = total > 1;
  stepNav?.classList.toggle("hidden", !show);
  if (!show) {
    if (stepNavLabel) {
      stepNavLabel.textContent = total === 1 ? "Step 1 / 1" : "No on-screen steps";
    }
    if (prevStepBtn) prevStepBtn.disabled = true;
    if (nextStepBtn) nextStepBtn.disabled = true;
    return;
  }
  if (stepNavLabel) {
    stepNavLabel.textContent = `Step ${currentStepIndex + 1} / ${total}`;
  }
  if (prevStepBtn) prevStepBtn.disabled = currentStepIndex <= 0;
  if (nextStepBtn) nextStepBtn.disabled = currentStepIndex >= total - 1;
}

async function renderCurrentOverlayStep() {
  if (!latestOverlaySteps.length || !latestCaptureMeta) {
    await window.panelApi.hideOverlay();
    updateStepNavUi();
    return;
  }
  currentStepIndex = Math.max(0, Math.min(currentStepIndex, latestOverlaySteps.length - 1));
  const step = latestOverlaySteps[currentStepIndex];
  await window.panelApi.showOverlay({
    steps: [step],
    captureMeta: latestCaptureMeta
  });
  updateStepNavUi();
}

async function syncOnScreenPrompts(guidance) {
  latestOverlaySteps = getOverlayEligibleSteps(guidance);
  if (!latestOverlaySteps.length || !latestCaptureMeta) {
    await window.panelApi.hideOverlay();
    updateStepNavUi();
    return;
  }
  currentStepIndex = Math.max(0, Math.min(currentStepIndex, latestOverlaySteps.length - 1));
  await renderCurrentOverlayStep();
}

function getScreenshotSignature(dataUrl) {
  if (!dataUrl) {
    return "";
  }
  return `${dataUrl.length}-${dataUrl.slice(-120)}`;
}

function cacheSet(map, key, value, maxSize) {
  if (!key) return;
  if (map.has(key)) {
    map.delete(key);
  }
  map.set(key, value);
  while (map.size > maxSize) {
    const first = map.keys().next().value;
    map.delete(first);
  }
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normalizeBox(box) {
  if (!box) return null;
  const x = clamp01(box.x);
  const y = clamp01(box.y);
  const w = clamp01(box.w);
  const h = clamp01(box.h);
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

function expandRegion(box, pad = 0.08) {
  const b = normalizeBox(box);
  if (!b) return null;
  const x = clamp01(b.x - pad);
  const y = clamp01(b.y - pad);
  const right = clamp01(b.x + b.w + pad);
  const bottom = clamp01(b.y + b.h + pad);
  return normalizeBox({ x, y, w: Math.max(0.01, right - x), h: Math.max(0.01, bottom - y) });
}

function unionBoxes(boxes) {
  const valid = boxes.map(normalizeBox).filter(Boolean);
  if (!valid.length) return null;
  const minX = Math.min(...valid.map((b) => b.x));
  const minY = Math.min(...valid.map((b) => b.y));
  const maxX = Math.max(...valid.map((b) => b.x + b.w));
  const maxY = Math.max(...valid.map((b) => b.y + b.h));
  return normalizeBox({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
}

function boxOverlapRatio(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const interW = Math.max(0, x2 - x1);
  const interH = Math.max(0, y2 - y1);
  const inter = interW * interH;
  const area = Math.max(0.00001, a.w * a.h);
  return inter / area;
}

function filterElementsByRegion(elements, region) {
  if (!region || !Array.isArray(elements) || !elements.length) {
    return Array.isArray(elements) ? elements : [];
  }
  return elements.filter((el) => {
    const b = normalizeBox(el?.bbox);
    if (!b) return false;
    return boxOverlapRatio(b, region) >= 0.25;
  });
}

function regionKey(region) {
  if (!region) return "full";
  return `${region.x.toFixed(3)}-${region.y.toFixed(3)}-${region.w.toFixed(3)}-${region.h.toFixed(3)}`;
}

function renderCaptureState() {
  if (latestScreenshot) {
    captureStatus.textContent = "Screen captured. Manual capture only.";
    preview.src = latestScreenshot;
  } else {
    captureStatus.textContent = "No capture yet. Click Capture Again or bubble icon.";
    preview.removeAttribute("src");
  }
}

function setPanelHidden(panelEl, hidden) {
  if (!panelEl) {
    return;
  }
  panelEl.classList.toggle("hidden", hidden);
}

function isPanelHidden(panelEl) {
  return !panelEl || panelEl.classList.contains("hidden");
}

function setDiyState(enabled) {
  diyModeEnabled = enabled;
  startDiyBtn.disabled = enabled;
  stopDiyBtn.disabled = !enabled;
}

function setActionButtonsEnabled(enabled) {
  if (analyzeBtn) {
    analyzeBtn.disabled = !enabled;
  }
  if (sendBtn) {
    sendBtn.disabled = !enabled;
  }
  captureAgainBtn.disabled = !enabled;
  startDiyBtn.disabled = !enabled || diyModeEnabled;
}

async function withOperationLock(fn) {
  if (operationInFlight) {
    throw new Error("Another operation is already running. Please wait.");
  }
  operationInFlight = true;
  setActionButtonsEnabled(false);
  try {
    return await fn();
  } finally {
    operationInFlight = false;
    setActionButtonsEnabled(true);
  }
}

function stopDiyMode() {
  if (diyTimer) {
    clearInterval(diyTimer);
    diyTimer = null;
  }
  diyInFlight = false;
  setDiyState(false);
}

window.panelApi.onScreenCaptured((payload) => {
  stopDiyMode();
  currentStepIndex = 0;
  latestScreenshot = payload?.dataUrl || null;
  latestCaptureMeta = payload?.captureMeta || null;
  latestOcrElements = [];
  latestUiTreeElements = [];
  latestGuidance = null;
  latestOverlaySteps = [];
  lastResolvedRegion = null;
  window.panelApi.hideOverlay().catch(() => {});
  updateStepNavUi();
  response.textContent = getQuickHelpText();
  renderCaptureState();
});

captureAgainBtn.addEventListener("click", async () => {
  stopDiyMode();
  currentStepIndex = 0;
  captureAgainBtn.disabled = true;
  captureStatus.textContent = "Waiting for manual screen selection...";
  try {
    const capture = await captureCurrentScreen();
    latestScreenshot = capture?.dataUrl || null;
    latestCaptureMeta = capture?.captureMeta || null;
    latestOcrElements = [];
    latestUiTreeElements = [];
    latestGuidance = null;
    latestOverlaySteps = [];
    lastResolvedRegion = null;
    window.panelApi.hideOverlay().catch(() => {});
    updateStepNavUi();
    response.textContent = getQuickHelpText();
    if (!latestScreenshot) {
      captureStatus.textContent = "Capture failed.";
    } else {
      renderCaptureState();
    }
  } catch (_error) {
    captureStatus.textContent = "Capture failed.";
  } finally {
    captureAgainBtn.disabled = false;
  }
});

saveKeyBtn.addEventListener("click", async () => {
  saveKeyBtn.disabled = true;
  try {
    await window.panelApi.saveSettings({
      provider: providerEl.value,
      apiKey: apiKeyEl.value
    });
    response.textContent = "API key saved securely for selected provider.";
    setPanelHidden(settingsPanel, true);
  } catch (error) {
    response.textContent = `Failed to save API key: ${error.message}`;
  } finally {
    saveKeyBtn.disabled = false;
  }
});

providerEl.addEventListener("change", async () => {
  try {
    await window.panelApi.saveSettings({ provider: providerEl.value, apiKey: "" });
    const settings = await window.panelApi.getSettings();
    apiKeyEl.value = settings.apiKey || "";
  } catch (_error) {
    // Keep UI responsive even if save fails.
  }
});

function renderGuidanceInResponse(guidance, summaryText) {
  function appendNavigationLink(container, url, sourceLabel) {
    if (!isHttpUrl(url)) {
      return;
    }
    const block = document.createElement("div");
    block.className = "step-how-list";

    const label = document.createElement("div");
    label.className = "step-source";
    label.textContent = sourceLabel || "Navigation link:";
    block.appendChild(label);

    const linkText = document.createElement("div");
    linkText.className = "type-block";
    linkText.textContent = url;
    block.appendChild(linkText);

    const openBtn = document.createElement("button");
    openBtn.className = "copy-btn";
    openBtn.textContent = "Open Link";
    openBtn.dataset.openUrl = url;
    block.appendChild(openBtn);

    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.textContent = "Copy Link";
    copyBtn.dataset.copyText = url;
    block.appendChild(copyBtn);

    container.appendChild(block);
  }

  response.innerHTML = "";
  const summary = document.createElement("div");
  summary.className = "response-summary";
  summary.textContent = summaryText || "Guidance generated.";
  response.appendChild(summary);

  if (guidance?.needsMoreContext) {
    const contextNote = document.createElement("div");
    contextNote.className = "step-how-list";
    const reason = guidance.contextReason || "Current screenshot is not sufficient for reliable guidance.";
    const next = guidance.nextUserAction || "Please navigate to the relevant page/section, then analyze again.";
    contextNote.textContent = `Need more context: ${reason}\nNext: ${next}`;
    response.appendChild(contextNote);
    const recoveryUrl = getContextRecoveryUrl(guidance, summaryText || guidance?.summary || "");
    appendNavigationLink(response, recoveryUrl, "Suggested page to continue:");
  }

  const steps = guidance?.steps || [];
  if (!steps.length) {
    const none = document.createElement("div");
    none.textContent = guidance?.needsMoreContext
      ? "Waiting for a clearer screen or link-based recovery."
      : "No actionable steps returned.";
    response.appendChild(none);
    return;
  }

  currentStepIndex = 0;
  latestOverlaySteps = [];
  steps.forEach((step) => {
    const card = document.createElement("div");
    card.className = "step-card";

    const title = document.createElement("div");
    title.className = "step-title";
    title.textContent = `${step.step}. ${step.instruction}`;
    card.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "step-meta";
    const confidencePct = Math.round(getStepConfidence(step) * 100);
    const resolver = step.resolvedBy ? ` | Resolved: ${step.resolvedBy}` : "";
    meta.textContent = `Action: ${step.action || "read"} | Target: ${step.target || "area"} | Confidence: ${confidencePct}%${resolver}`;
    card.appendChild(meta);

    if (isTargetStep(step) && step.anchorText) {
      const anchor = document.createElement("div");
      anchor.className = "step-source";
      anchor.textContent = `Match this on screen: "${step.anchorText}"`;
      card.appendChild(anchor);
    }

    if (step.templateHint) {
      const hint = document.createElement("div");
      hint.className = "step-source";
      hint.textContent = `Template hint: ${step.templateHint}`;
      card.appendChild(hint);
    }

    if (!isStepTrusted(step)) {
      const caution = document.createElement("div");
      caution.className = "step-how-list";
      caution.textContent =
        "Low target confidence on this step. Do not rely on exact click position. Use the matched text and request a clearer screenshot if needed.";
      card.appendChild(caution);
    }

    if ((step.action || "").toLowerCase() === "open_url" && isHttpUrl(step.url)) {
      appendNavigationLink(card, step.url, "Open this page:");
    }

    if ((step.action || "").toLowerCase() === "type") {
      const infoBtn = document.createElement("button");
      infoBtn.className = "info-btn";
      infoBtn.textContent = "i";
      infoBtn.title = "What is this and why required?";
      infoBtn.dataset.whatIs = step.whatIs || "";
      infoBtn.dataset.whyRequired = step.whyRequired || "";
      card.appendChild(infoBtn);

      const infoPanel = document.createElement("div");
      infoPanel.className = "info-panel";
      infoPanel.hidden = true;
      card.appendChild(infoPanel);

      const typeBlock = document.createElement("div");
      typeBlock.className = "type-block";
      typeBlock.textContent = step.textToType || "(No value returned)";
      card.appendChild(typeBlock);

      const sourceHint = document.createElement("div");
      sourceHint.className = "step-source";
      sourceHint.textContent = step.howToGet
        ? `How to get it: ${step.howToGet}`
        : "How to get it: Provide a valid value for this field.";
      card.appendChild(sourceHint);

      const retrievalSteps = Array.isArray(step.howToGetSteps) ? step.howToGetSteps : [];
      if (retrievalSteps.length) {
        const howList = document.createElement("div");
        howList.className = "step-how-list";
        howList.textContent = retrievalSteps.map((line, i) => `${i + 1}. ${line}`).join("\n");
        card.appendChild(howList);
      }

      const copyBtn = document.createElement("button");
      copyBtn.className = "copy-btn";
      copyBtn.textContent = step.textToType ? "Copy Text" : "Copy Unavailable";
      copyBtn.dataset.copyText = step.textToType || "";
      copyBtn.disabled = !step.textToType;
      card.appendChild(copyBtn);
    }

    response.appendChild(card);
  });
}

function fillTypeFallbacks(guidance) {
  if (!guidance?.steps?.length) {
    return guidance;
  }
  const nextSteps = guidance.steps.map((step) => {
    const action = String(step.action || "").toLowerCase();
    if (action !== "type" || step.textToType) {
      return step;
    }
    const target = normalizeText(step.target || step.instruction || "");
    if (target.includes("redirect") || target.includes("url")) {
      return {
        ...step,
        textToType: "https://localhost/callback",
        whatIs: step.whatIs || "This is the URL where users return after auth/consent.",
        whyRequired:
          step.whyRequired ||
          "Platform needs it to redirect securely back to your app after login/authorization.",
        howToGet:
          step.howToGet ||
          "Use your app callback URL. For local testing, localhost callback works if provider allows it.",
        howToGetSteps:
          step.howToGetSteps?.length
            ? step.howToGetSteps
            : [
                "Open your app/backend settings where callback/redirect URL is configured.",
                "Copy the callback URL from settings.",
                "Return to this form and paste it in Redirect URL field.",
                "If not configured yet, use https://localhost/callback for local testing."
              ]
      };
    }
    if (target.includes("app") && target.includes("name")) {
      return {
        ...step,
        textToType: "My Trading Assistant App",
        whatIs: step.whatIs || "A display name to identify this integration/app.",
        whyRequired:
          step.whyRequired || "Helps you and the platform distinguish this app from other apps.",
        howToGet: step.howToGet || "Use any unique app name you can recognize later.",
        howToGetSteps:
          step.howToGetSteps?.length
            ? step.howToGetSteps
            : [
                "Think of a clear name for this integration/app.",
                "Keep it unique so you can identify it later.",
                "Type that name in the app name field."
              ]
      };
    }
    if (target.includes("description")) {
      return {
        ...step,
        textToType: "Internal app for API integration and automated workflow testing.",
        whatIs: step.whatIs || "A short summary of what your app does.",
        whyRequired:
          step.whyRequired ||
          "Helps reviewers/admins understand your use case and expected API behavior.",
        howToGet: step.howToGet || "Write a short purpose of your app.",
        howToGetSteps:
          step.howToGetSteps?.length
            ? step.howToGetSteps
            : [
                "Summarize what this app does in one sentence.",
                "Mention API/integration purpose clearly.",
                "Paste the sentence into description field."
              ]
      };
    }
    return {
      ...step,
      whatIs: step.whatIs || "This field stores a required value for setup.",
      whyRequired: step.whyRequired || "The platform uses this value to configure or verify your app.",
      howToGet: step.howToGet || "Provide a valid value for this field.",
      howToGetSteps:
        step.howToGetSteps?.length
          ? step.howToGetSteps
          : [
              "Identify where this value is defined (settings, dashboard, or docs).",
              "Copy the value from source.",
              "Return here and paste it into the field."
            ]
    };
  });
  return { ...guidance, steps: nextSteps };
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function firstUrlFromText(value) {
  const match = String(value || "").match(/https?:\/\/[^\s"')\]]+/i);
  return match ? match[0] : "";
}

function parseQuestionMode(value) {
  const raw = String(value || "").trim();
  const forceNew = /^new\s*:/i.test(raw);
  const text = forceNew ? raw.replace(/^new\s*:/i, "").trim() : raw;
  return { forceNew, text };
}

function getContextRecoveryUrl(guidance, summaryText) {
  const suggested = String(guidance?.suggestedUrl || "").trim();
  if (isHttpUrl(suggested)) {
    return suggested;
  }
  const combined = [
    summaryText,
    guidance?.summary,
    guidance?.contextReason,
    guidance?.nextUserAction,
    ...(Array.isArray(guidance?.steps) ? guidance.steps.map((s) => s.url || "") : [])
  ].join("\n");
  const detected = firstUrlFromText(combined);
  return isHttpUrl(detected) ? detected : "";
}

async function analyzeCurrentScreenshot(userQuestion, options = {}) {
  const useRegion = Boolean(options.useRegion);
  const screenshotSig = getScreenshotSignature(latestScreenshot);
  const activeRegion = useRegion ? expandRegion(lastResolvedRegion, 0.06) : null;
  const regionId = regionKey(activeRegion);
  const questionKey = normalizeForMatch(userQuestion).slice(0, 600);
  const analyzeKey = `${providerEl.value}|${screenshotSig}|${regionId}|${questionKey}`;
  const cachedAnalyze = analyzeResultCache.get(analyzeKey);
  if (cachedAnalyze) {
    latestGuidance = cachedAnalyze.guidance;
    renderGuidanceInResponse(latestGuidance, cachedAnalyze.summaryText);
    await syncOnScreenPrompts(latestGuidance);
    return;
  }

  const aiImage = await prepareScreenshotForAi(latestScreenshot);
  let cachedExtract = ocrExtractionCache.get(screenshotSig);
  if (!cachedExtract) {
    let ocrElements = [];
    let uiTreeElements = [];
    try {
      const ocr = await window.panelApi.extractOcr({ imageDataUrl: latestScreenshot });
      ocrElements = Array.isArray(ocr?.elements) ? ocr.elements.slice(0, 500) : [];
    } catch (_error) {
      ocrElements = [];
    }
    try {
      const uiTree = await window.panelApi.detectUiTree({ captureMeta: latestCaptureMeta });
      uiTreeElements = Array.isArray(uiTree?.elements) ? uiTree.elements.slice(0, 400) : [];
    } catch (_error) {
      uiTreeElements = [];
    }
    cachedExtract = { ocrElements, uiTreeElements };
    cacheSet(ocrExtractionCache, screenshotSig, cachedExtract, OCR_CACHE_MAX);
  }
  let ocrElements = cachedExtract.ocrElements || [];
  let uiTreeElements = cachedExtract.uiTreeElements || [];
  if (activeRegion) {
    ocrElements = filterElementsByRegion(ocrElements, activeRegion);
    uiTreeElements = filterElementsByRegion(uiTreeElements, activeRegion);
  }
  latestOcrElements = ocrElements;
  latestUiTreeElements = uiTreeElements;

  const result = await window.panelApi.analyzeScreen({
    provider: providerEl.value,
    apiKey: apiKeyEl.value,
    question: userQuestion,
    imageDataUrl: aiImage,
    ocrElements,
    uiTreeElements
  });
  const summaryText = result.answer || "No response returned.";
  const withTypeFallback = fillTypeFallbacks(result.guidance || null);
  const withPredictions = applyActionPrediction(withTypeFallback);
  const withUiTree = resolveAnchorsWithUiTree(withPredictions, latestUiTreeElements);
  const withOcr = resolveAnchorsWithOcr(withUiTree, latestOcrElements);
  latestGuidance = resolveTemplateHints(withOcr, latestOcrElements, latestUiTreeElements);
  lastResolvedRegion = deriveRegionFromGuidance(latestGuidance) || lastResolvedRegion;
  renderGuidanceInResponse(latestGuidance, summaryText);
  await syncOnScreenPrompts(latestGuidance);
  cacheSet(analyzeResultCache, analyzeKey, { guidance: latestGuidance, summaryText }, ANALYZE_CACHE_MAX);
}

function buildContextualQuestion(userText) {
  const guidance = latestGuidance || {};
  const summary = String(guidance.summary || "").trim();
  const baseQuestion = String(lastPrimaryQuestion || "").trim();
  const steps = Array.isArray(guidance.steps)
    ? guidance.steps
        .slice(0, 6)
        .map(
          (step) =>
            `${step.step}. ${step.instruction} | action=${step.action || "read"} | target=${
              step.target || "area"
            }${step.textToType ? ` | text=${step.textToType}` : ""}`
        )
        .join("\n")
    : "";

  return [
    baseQuestion ? `Original goal:\n${baseQuestion}` : "",
    summary ? `Previous summary:\n${summary}` : "",
    steps ? `Previous steps:\n${steps}` : "",
    `Follow-up question:\n${userText}`,
    "Use current screenshot plus this context. Keep guidance practical."
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function submitUserMessage(options = {}) {
  const forceFreshContext = Boolean(options.forceFreshContext);
  const questionMode = parseQuestionMode(question.value);
  const q = questionMode.text;
  if (!q) {
    response.textContent = "Type your message first.";
    return;
  }
  if (diyModeEnabled) {
    response.textContent = "Stop DIY mode before sending a manual message.";
    return;
  }

  const originalSendLabel = sendBtn?.textContent || "Send";
  if (sendBtn) {
    sendBtn.textContent = "...";
  }
  captureStatus.textContent = "Capturing and analyzing current screen...";
  response.textContent = "Working on your request...";

  try {
    await withOperationLock(async () => {
      const capture = await captureCurrentScreen();
      latestScreenshot = capture?.dataUrl || null;
      latestCaptureMeta = capture?.captureMeta || null;
      if (!latestScreenshot) {
        throw new Error("Capture failed.");
      }
      preview.src = latestScreenshot;

      const hasContext = !forceFreshContext && !questionMode.forceNew && Boolean(latestGuidance?.steps?.length);
      const prompt = hasContext ? buildContextualQuestion(q) : q;
      await analyzeCurrentScreenshot(prompt, { useRegion: hasContext });
      if (forceFreshContext || questionMode.forceNew || !lastPrimaryQuestion) {
        lastPrimaryQuestion = q;
      }
    });
  } catch (error) {
    latestOverlaySteps = [];
    updateStepNavUi();
    window.panelApi.hideOverlay().catch(() => {});
    response.textContent = `Analyze failed: ${error.message}`;
  } finally {
    captureStatus.textContent = "Screen captured. Manual capture only.";
    if (sendBtn) {
      sendBtn.textContent = originalSendLabel;
    }
  }
}

sendBtn?.addEventListener("click", submitUserMessage);
analyzeBtn?.addEventListener("click", async () => {
  await submitUserMessage({ forceFreshContext: true });
});
question.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submitUserMessage();
  }
});

async function runDiyTick() {
  if (!diyModeEnabled || diyInFlight) {
    return;
  }
  const q = question.value.trim();
  if (!q) {
    captureStatus.textContent = "DIY paused: enter your goal/question.";
    return;
  }

  diyInFlight = true;
  try {
    captureStatus.textContent = "DIY: capturing current page...";
    const capture = await captureCurrentScreen();
    latestScreenshot = capture?.dataUrl || null;
    latestCaptureMeta = capture?.captureMeta || null;
    if (!latestScreenshot) {
      captureStatus.textContent = "DIY: capture failed.";
      return;
    }
    preview.src = latestScreenshot;

    const sig = getScreenshotSignature(latestScreenshot);
    if (sig === lastDiySignature) {
      captureStatus.textContent = "DIY: waiting for page change...";
      return;
    }
    lastDiySignature = sig;

    captureStatus.textContent = "DIY: analyzing latest screen...";
    await analyzeCurrentScreenshot(q, { useRegion: true });
    captureStatus.textContent = "DIY active.";
  } catch (error) {
    latestOverlaySteps = [];
    updateStepNavUi();
    window.panelApi.hideOverlay().catch(() => {});
    response.textContent = `DIY failed: ${error.message}`;
    captureStatus.textContent = "DIY error.";
  } finally {
    diyInFlight = false;
  }
}

startDiyBtn.addEventListener("click", async () => {
  if (diyModeEnabled) {
    return;
  }
  if (operationInFlight) {
    response.textContent = "Wait for current operation to finish before starting DIY.";
    return;
  }
  lastDiySignature = "";
  setDiyState(true);
  captureStatus.textContent = "DIY active.";
  await runDiyTick();
  diyTimer = setInterval(runDiyTick, 4500);
});

stopDiyBtn.addEventListener("click", () => {
  stopDiyMode();
  captureStatus.textContent = "DIY stopped.";
});

response.addEventListener("click", async (event) => {
  const infoButton = event.target.closest(".info-btn");
  if (infoButton) {
    const card = infoButton.closest(".step-card");
    const panel = card?.querySelector(".info-panel");
    if (panel) {
      const whatIs = infoButton.dataset.whatIs || "This is a required setup value.";
      const whyRequired = infoButton.dataset.whyRequired || "It is needed for platform configuration.";
      panel.textContent = `What it is: ${whatIs}\nWhy required: ${whyRequired}`;
      panel.hidden = !panel.hidden;
    }
    return;
  }

  const openUrlBtn = event.target.closest("[data-open-url]");
  if (openUrlBtn) {
    const url = openUrlBtn.dataset.openUrl || "";
    if (!isHttpUrl(url)) {
      response.textContent = "Invalid link.";
      return;
    }
    try {
      await window.panelApi.automationOpenUrl({ url });
      openUrlBtn.textContent = "Opened";
      setTimeout(() => {
        openUrlBtn.textContent = "Open Link";
      }, 1200);
    } catch (error) {
      response.textContent = `Open link failed: ${error.message}`;
    }
    return;
  }

  const button = event.target.closest(".copy-btn");
  if (!button) {
    return;
  }
  const value = button.dataset.copyText || "";
  if (!value) {
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = "Copy Text";
    }, 1200);
  } catch (_error) {
    response.textContent = "Copy failed. You can still select text manually.";
  }
});

closeBtn.addEventListener("click", () => {
  stopDiyMode();
  latestOverlaySteps = [];
  window.panelApi.hideOverlay().catch(() => {});
  setActionButtonsEnabled(true);
  window.panelApi.close();
});

prevStepBtn?.addEventListener("click", async () => {
  if (!latestOverlaySteps.length) return;
  currentStepIndex = Math.max(0, currentStepIndex - 1);
  await renderCurrentOverlayStep();
});

nextStepBtn?.addEventListener("click", async () => {
  if (!latestOverlaySteps.length) return;
  currentStepIndex = Math.min(latestOverlaySteps.length - 1, currentStepIndex + 1);
  await renderCurrentOverlayStep();
});

toggleSettingsBtn.addEventListener("click", () => {
  const hidden = isPanelHidden(settingsPanel);
  setPanelHidden(settingsPanel, !hidden);
});

toggleCaptureBtn.addEventListener("click", () => {
  const hidden = isPanelHidden(capturePanel);
  setPanelHidden(capturePanel, !hidden);
});

async function initializeSettings() {
  try {
    const settings = await window.panelApi.getSettings();
    providerEl.value = settings.provider || "openai";
    apiKeyEl.value = settings.apiKey || "";
    setPanelHidden(settingsPanel, Boolean(settings.apiKey));
  } catch (_error) {
    providerEl.value = "openai";
  }
}

renderCaptureState();
response.textContent = getQuickHelpText();
setDiyState(false);
setActionButtonsEnabled(true);
updateStepNavUi();
initializeSettings();
