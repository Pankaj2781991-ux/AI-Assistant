const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { app, BrowserWindow, desktopCapturer, ipcMain, safeStorage, screen } = require("electron");

let bubbleWindow;
let panelWindow;
let overlayWindow;
const settingsFileName = "assistant-settings.json";

function getSettingsPath() {
  return path.join(app.getPath("userData"), settingsFileName);
}

async function readSettings() {
  try {
    const raw = await fs.readFile(getSettingsPath(), "utf8");
    return JSON.parse(raw);
  } catch (_error) {
    return { provider: "openai", encryptedApiKeys: {} };
  }
}

async function writeSettings(settings) {
  await fs.mkdir(path.dirname(getSettingsPath()), { recursive: true });
  await fs.writeFile(getSettingsPath(), JSON.stringify(settings, null, 2), "utf8");
}

function encryptText(plainText) {
  if (!plainText) {
    return "";
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return plainText;
  }
  return safeStorage.encryptString(plainText).toString("base64");
}

function decryptText(cipherText) {
  if (!cipherText) {
    return "";
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return cipherText;
  }
  try {
    return safeStorage.decryptString(Buffer.from(cipherText, "base64"));
  } catch (_error) {
    return "";
  }
}

function parseDataUrl(dataUrl) {
  const match = /^data:(.+);base64,(.+)$/.exec(dataUrl || "");
  if (!match) {
    return null;
  }
  return { mimeType: match[1], base64Data: match[2] };
}

async function parseErrorDetails(res) {
  try {
    const text = await res.text();
    if (!text) {
      return "";
    }
    return ` - ${text.slice(0, 300)}`;
  } catch (_error) {
    return "";
  }
}

async function fetchWithTimeout(url, options, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function buildGuidancePrompt(userQuestion, ocrElements = [], uiTreeElements = []) {
  const ocrPreview = (Array.isArray(ocrElements) ? ocrElements : [])
    .slice(0, 120)
    .map((el, i) => {
      const b = el?.bbox || {};
      return `${i + 1}. text="${String(el?.text || "").replace(/"/g, "'")}" bbox=(${Number(
        b.x || 0
      ).toFixed(3)},${Number(b.y || 0).toFixed(3)},${Number(b.w || 0).toFixed(3)},${Number(
        b.h || 0
      ).toFixed(3)})`;
    })
    .join("\n");

  const uiTreePreview = (Array.isArray(uiTreeElements) ? uiTreeElements : [])
    .slice(0, 120)
    .map((el, i) => {
      const b = el?.bbox || {};
      return `${i + 1}. name="${String(el?.name || "").replace(/"/g, "'")}" type="${String(
        el?.controlType || "unknown"
      )}" bbox=(${Number(b.x || 0).toFixed(3)},${Number(b.y || 0).toFixed(3)},${Number(
        b.w || 0
      ).toFixed(3)},${Number(b.h || 0).toFixed(3)})`;
    })
    .join("\n");

  return [
    "Analyze the screenshot and answer the user.",
    "Return strict JSON only, no markdown.",
    "Schema:",
    "{",
    '  "summary": "short answer",',
    '  "needsMoreContext": false,',
    '  "contextReason": "why screenshot is insufficient",',
    '  "nextUserAction": "exact navigation/scroll/page change request if context is missing",',
    '  "suggestedUrl": "http/https URL to open when visible and useful, otherwise empty string",',
    '  "steps": [',
    "    {",
    '      "step": 1,',
    '      "instruction": "what to click/type",',
    '      "action": "click|double_click|type|scroll|read|verify|open_local_html|open_url",',
    '      "confidence": 0.0,',
    '      "target": "element name",',
    '      "anchorText": "for click/type: exact visible UI text near target",',
    '      "textToType": "required when action=type, otherwise empty string",',
    '      "filePath": "required when action=open_local_html, project-relative path like landing/index.html",',
    '      "url": "required when action=open_url",',
    '      "howToGet": "required when action=type, short summary where value comes from",',
    '      "howToGetSteps": ["required when action=type, concrete click-by-click retrieval steps"],',
    '      "whatIs": "required when action=type, plain explanation of this field/value",',
    '      "whyRequired": "required when action=type, why platform asks for it",',
    '      "templateHint": "optional icon/control hint like settings/menu/search/close/back/next",',
    '      "bbox": {"x":0.0,"y":0.0,"w":0.0,"h":0.0}',
    "    }",
    "  ]",
    "}",
    "bbox coordinates must be normalized (0 to 1) relative to the full screenshot.",
    "bbox must be tight around the exact clickable/input control, not nearby labels or paragraph text.",
    "For buttons, bbox should tightly match the button bounds.",
    "For text fields, bbox should tightly match the editable input rectangle.",
    "Use up to 6 steps and include bbox only if reasonably confident.",
    "If action is type, provide exact textToType the user can copy-paste.",
    "If action is type, howToGet must explain source, and howToGetSteps must contain actionable steps.",
    "howToGetSteps must be specific like: go to X, click Y, copy Z, return here, paste.",
    "If action is type, always include whatIs and whyRequired in simple language.",
    "For click/type, anchorText should match visible label/button text on screen exactly.",
    "For click/type/double_click, include confidence from 0.0 to 1.0 for target accuracy.",
    "If confidence is below 0.78, avoid precise targeting and prefer needsMoreContext with navigation guidance.",
    "If the value is not visible, generate a safe default value and say that in howToGet.",
    "For fields like app name, URL, description, API keys, or command values, include precise textToType.",
    "If user asks to open a local HTML file in browser, use action open_local_html with filePath.",
    "If user asks to open a website, use action open_url with url.",
    "If screenshot is unclear or missing required UI, set needsMoreContext=true.",
    "When needsMoreContext=true and a URL is visible/known, set suggestedUrl and also include an open_url step as step 1.",
    "When needsMoreContext=true and no URL is available, set nextUserAction with concrete navigation steps for user.",
    "Do not guess click/type targets when confidence is low.",
    ocrPreview
      ? `Local OCR element map (normalized to screenshot):\n${ocrPreview}`
      : "Local OCR element map: unavailable or empty.",
    uiTreePreview
      ? `UI tree element map when available (normalized):\n${uiTreePreview}`
      : "UI tree element map: unavailable or empty.",
    "If a control appears icon-only, use templateHint (settings/menu/search/close/back/next).",
    `User question: ${userQuestion}`
  ].join("\n");
}

async function extractOcrElementsFromDataUrl(dataUrl) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed?.base64Data) {
    return { available: false, elements: [], error: "Invalid image data URL." };
  }

  const tmpFile = path.join(
    os.tmpdir(),
    `onscreen-ai-ocr-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}.png`
  );
  try {
    await fs.writeFile(tmpFile, Buffer.from(parsed.base64Data, "base64"));
    const escapedPath = toSingleQuotedPs(tmpFile);
    const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]

function Await($op) {
  $task = [System.WindowsRuntimeSystemExtensions]::AsTask($op)
  $task.Wait()
  return $task.Result
}

$file = Await([Windows.Storage.StorageFile]::GetFileFromPathAsync('${escapedPath}'))
$stream = Await($file.OpenAsync([Windows.Storage.FileAccessMode]::Read))
$decoder = Await([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream))
$bitmap = Await($decoder.GetSoftwareBitmapAsync())
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) {
  @{ elements = @() } | ConvertTo-Json -Compress -Depth 6
  exit 0
}
$result = Await($engine.RecognizeAsync($bitmap))
$w = [double]$bitmap.PixelWidth
$h = [double]$bitmap.PixelHeight
$items = @()
foreach ($line in $result.Lines) {
  foreach ($word in $line.Words) {
    $text = ($word.Text -replace '\\s+', ' ').Trim()
    if ($text.Length -lt 1) { continue }
    $b = $word.BoundingRect
    $x = [math]::Max(0, [math]::Min(1, $b.X / $w))
    $y = [math]::Max(0, [math]::Min(1, $b.Y / $h))
    $bw = [math]::Max(0.0005, [math]::Min(1, $b.Width / $w))
    $bh = [math]::Max(0.0005, [math]::Min(1, $b.Height / $h))
    $items += [PSCustomObject]@{
      text = $text
      bbox = [PSCustomObject]@{ x = $x; y = $y; w = $bw; h = $bh }
    }
  }
}
@{ elements = $items } | ConvertTo-Json -Compress -Depth 8
`;
    const { stdout } = await runPowerShell(script, 30000);
    const raw = String(stdout || "").trim();
    if (!raw) {
      return { available: true, elements: [] };
    }
    const parsedJson = JSON.parse(raw);
    const elements = Array.isArray(parsedJson?.elements)
      ? parsedJson.elements
          .map((el) => ({
            text: String(el?.text || "").trim(),
            bbox: {
              x: Number(el?.bbox?.x || 0),
              y: Number(el?.bbox?.y || 0),
              w: Number(el?.bbox?.w || 0),
              h: Number(el?.bbox?.h || 0)
            }
          }))
          .filter((el) => el.text && el.bbox.w > 0 && el.bbox.h > 0)
      : [];
    return { available: true, elements };
  } catch (error) {
    return { available: false, elements: [], error: error.message || "OCR failed." };
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}

async function detectUiTreeElements(captureMeta) {
  const bounds = captureMeta?.displayBoundsPx || captureMeta?.displayBoundsDip || captureMeta?.displayBounds;
  if (!bounds) {
    return { available: false, elements: [], error: "Capture bounds required." };
  }

  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32 {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
}
"@

$root = [System.Windows.Automation.AutomationElement]::RootElement
$fg = [Win32]::GetForegroundWindow()
if ($fg -eq [IntPtr]::Zero) {
  @{ elements = @() } | ConvertTo-Json -Compress -Depth 8
  exit 0
}

$condition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::NativeWindowHandleProperty,
  [int]$fg
)
$win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
if ($null -eq $win) {
  @{ elements = @() } | ConvertTo-Json -Compress -Depth 8
  exit 0
}

$desc = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$max = [Math]::Min(220, $desc.Count)
$items = @()
for ($i = 0; $i -lt $max; $i++) {
  $el = $desc.Item($i)
  $name = [string]$el.Current.Name
  if ([string]::IsNullOrWhiteSpace($name)) { continue }
  $r = $el.Current.BoundingRectangle
  if ($r.Width -le 1 -or $r.Height -le 1) { continue }
  $typeName = ""
  try { $typeName = [string]$el.Current.LocalizedControlType } catch {}
  $items += [PSCustomObject]@{
    name = ($name -replace '\\s+', ' ').Trim()
    controlType = ($typeName -replace '\\s+', ' ').Trim()
    rect = [PSCustomObject]@{
      x = [double]$r.X
      y = [double]$r.Y
      w = [double]$r.Width
      h = [double]$r.Height
    }
  }
}
@{ elements = $items } | ConvertTo-Json -Compress -Depth 8
`;

  try {
    const { stdout } = await runPowerShell(script, 20000);
    const raw = String(stdout || "").trim();
    if (!raw) {
      return { available: true, elements: [] };
    }
    const parsedJson = JSON.parse(raw);
    const left = Number(bounds.x) || 0;
    const top = Number(bounds.y) || 0;
    const width = Number(bounds.width) || 1;
    const height = Number(bounds.height) || 1;
    const elements = Array.isArray(parsedJson?.elements)
      ? parsedJson.elements
          .map((el) => {
            const r = el?.rect || {};
            const nx = (Number(r.x) - left) / width;
            const ny = (Number(r.y) - top) / height;
            const nw = Number(r.w) / width;
            const nh = Number(r.h) / height;
            return {
              name: String(el?.name || "").trim(),
              controlType: String(el?.controlType || "").trim(),
              bbox: {
                x: Math.max(0, Math.min(1, nx)),
                y: Math.max(0, Math.min(1, ny)),
                w: Math.max(0.0005, Math.min(1, nw)),
                h: Math.max(0.0005, Math.min(1, nh))
              }
            };
          })
          .filter((el) => el.name && el.bbox.w > 0 && el.bbox.h > 0)
      : [];
    return { available: true, elements };
  } catch (error) {
    return { available: false, elements: [], error: error.message || "UI tree detection failed." };
  }
}

function tryParseGuidance(rawText) {
  const text = (rawText || "").trim();
  if (!text) {
    return {
      summary: "",
      needsMoreContext: false,
      contextReason: "",
      nextUserAction: "",
      suggestedUrl: "",
      steps: []
    };
  }

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : text;
  let parsed = null;
  try {
    parsed = JSON.parse(candidate);
  } catch (_error) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(candidate.slice(start, end + 1));
      } catch (_error2) {
        parsed = null;
      }
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      summary: text,
      needsMoreContext: false,
      contextReason: "",
      nextUserAction: "",
      suggestedUrl: "",
      steps: []
    };
  }

  const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];
  function parseNormalizedBbox(input) {
    const box = input || {};
    const x = Number(box.x ?? box.left ?? box.x0);
    const y = Number(box.y ?? box.top ?? box.y0);
    const w = Number(box.w ?? box.width);
    const h = Number(box.h ?? box.height);
    const right = Number(box.right ?? box.x1);
    const bottom = Number(box.bottom ?? box.y1);

    let outX = x;
    let outY = y;
    let outW = w;
    let outH = h;

    if ((!Number.isFinite(outW) || !Number.isFinite(outH)) && Number.isFinite(right) && Number.isFinite(bottom)) {
      if (Number.isFinite(outX) && Number.isFinite(outY)) {
        outW = right - outX;
        outH = bottom - outY;
      }
    }

    const valid =
      Number.isFinite(outX) &&
      Number.isFinite(outY) &&
      Number.isFinite(outW) &&
      Number.isFinite(outH) &&
      outX >= 0 &&
      outY >= 0 &&
      outW > 0 &&
      outH > 0 &&
      outX <= 1 &&
      outY <= 1 &&
      outW <= 1 &&
      outH <= 1;
    if (!valid) {
      return null;
    }
    return { x: outX, y: outY, w: outW, h: outH };
  }

  const steps = rawSteps
    .slice(0, 6)
    .map((step, idx) => {
      const parsedBbox = parseNormalizedBbox(step?.bbox);

      return {
        step: Number(step?.step) || idx + 1,
        instruction: String(step?.instruction || "").trim(),
        action: String(step?.action || "read").trim(),
        confidence: Number.isFinite(Number(step?.confidence))
          ? Math.max(0, Math.min(1, Number(step?.confidence)))
          : 0,
        target: String(step?.target || "").trim(),
        anchorText: String(step?.anchorText || "").trim(),
        textToType: String(step?.textToType || "").trim(),
        filePath: String(step?.filePath || "").trim(),
        url: String(step?.url || "").trim(),
        howToGet: String(step?.howToGet || "").trim(),
        howToGetSteps: Array.isArray(step?.howToGetSteps)
          ? step.howToGetSteps.map((s) => String(s || "").trim()).filter(Boolean).slice(0, 5)
          : [],
        whatIs: String(step?.whatIs || "").trim(),
        whyRequired: String(step?.whyRequired || "").trim(),
        templateHint: String(step?.templateHint || "").trim(),
        bbox: parsedBbox
      };
    })
    .filter((step) => step.instruction);

  return {
    summary: String(parsed.summary || text).trim(),
    needsMoreContext: Boolean(parsed.needsMoreContext),
    contextReason: String(parsed.contextReason || "").trim(),
    nextUserAction: String(parsed.nextUserAction || "").trim(),
    suggestedUrl: String(parsed.suggestedUrl || "").trim(),
    steps
  };
}

async function callOpenAI({ apiKey, question, imageDataUrl }) {
  const res = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-5-mini",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: question },
            { type: "input_image", image_url: imageDataUrl }
          ]
        }
      ]
    })
  });

  if (!res.ok) {
    const details = await parseErrorDetails(res);
    throw new Error(`OpenAI request failed (${res.status})${details}`);
  }

  const data = await res.json();
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const textParts =
    data.output
      ?.flatMap((entry) => entry.content || [])
      ?.filter((part) => part.type === "output_text" && part.text)
      ?.map((part) => part.text) || [];
  return textParts.join("\n").trim() || "No response text returned by OpenAI.";
}

async function callGemini({ apiKey, question, imageDataUrl }) {
  const image = parseDataUrl(imageDataUrl);
  if (!image) {
    throw new Error("Gemini requires a valid image data URL.");
  }

  const requestBody = {
    contents: [
      {
        parts: [
          { text: question },
          {
            inline_data: {
              mime_type: image.mimeType,
              data: image.base64Data
            }
          }
        ]
      }
    ]
  };

  const modelsRes = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    { method: "GET" }
  );
  if (!modelsRes.ok) {
    const details = await parseErrorDetails(modelsRes);
    throw new Error(`Gemini ListModels failed (${modelsRes.status})${details}`);
  }
  const modelsData = await modelsRes.json();
  const availableModelNames =
    modelsData.models
      ?.filter((model) => (model.supportedGenerationMethods || []).includes("generateContent"))
      ?.map((model) => model.name)
      ?.filter(Boolean) || [];

  if (availableModelNames.length === 0) {
    throw new Error("No Gemini models with generateContent support were returned for this key.");
  }

  const preferredTokens = ["2.0-flash", "1.5-flash", "flash", "pro"];
  const modelCandidates = [
    ...preferredTokens.flatMap((token) =>
      availableModelNames.filter((name) => name.toLowerCase().includes(token))
    ),
    ...availableModelNames
  ].filter((name, idx, all) => all.indexOf(name) === idx);

  let lastError = "";
  for (const model of modelCandidates) {
    const normalizedModelPath = model.startsWith("models/") ? model : `models/${model}`;
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/` +
      `${normalizedModelPath}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });

    if (!res.ok) {
      const details = await parseErrorDetails(res);
      lastError = `Gemini model ${model} failed (${res.status})${details}`;
      if (res.status === 404) {
        continue;
      }
      throw new Error(lastError);
    }

    const data = await res.json();
    const text =
      data.candidates?.[0]?.content?.parts
        ?.filter((part) => typeof part.text === "string")
        ?.map((part) => part.text)
        ?.join("\n")
        ?.trim() || "";

    if (!text) {
      return `Model ${model} returned no text response.`;
    }
    return text;
  }

  throw new Error(
    `${lastError || "No compatible Gemini model found."} ` +
      "Check API key project access and available model list."
  );
}

function createBubbleWindow() {
  bubbleWindow = new BrowserWindow({
    width: 72,
    height: 72,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    movable: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, "preload-bubble.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  bubbleWindow.loadFile(path.join(__dirname, "ui", "bubble.html"));
  bubbleWindow.setAlwaysOnTop(true, "screen-saver");
}

function createPanelWindow() {
  const { workAreaSize } = screen.getPrimaryDisplay();
  panelWindow = new BrowserWindow({
    width: 360,
    height: 410,
    minWidth: 340,
    minHeight: 360,
    x: Math.max(workAreaSize.width - 390, 0),
    y: 64,
    frame: false,
    transparent: true,
    show: false,
    alwaysOnTop: true,
    resizable: true,
    movable: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload-panel.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  panelWindow.loadFile(path.join(__dirname, "ui", "panel.html"));
  panelWindow.setAlwaysOnTop(true, "screen-saver");
  panelWindow.webContents.on("render-process-gone", () => {
    try {
      panelWindow?.destroy();
    } catch (_error) {
      // ignore
    }
    panelWindow = null;
    createPanelWindow();
    syncBubbleWithPanelVisibility();
  });
  panelWindow.on("unresponsive", () => {
    panelWindow?.webContents.reloadIgnoringCache();
  });
}

function ensureOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow;
  }

  overlayWindow = new BrowserWindow({
    width: 300,
    height: 200,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    show: false,
    alwaysOnTop: true,
    focusable: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload-overlay.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.loadFile(path.join(__dirname, "ui", "overlay.html"));
  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });

  return overlayWindow;
}

function showOverlayForCapture({ steps, captureMeta }) {
  const win = ensureOverlayWindow();
  const bounds =
    captureMeta?.displayBoundsDip ||
    captureMeta?.displayBounds ||
    null;
  if (!bounds) {
    return;
  }

  win.setBounds({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height))
  });
  if (!win.isVisible()) {
    win.showInactive();
  }
  win.webContents.send("overlay-data", { steps: Array.isArray(steps) ? steps : [] });
}

function hideOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }
  overlayWindow.hide();
}

function showPanelWithCapture(payload) {
  if (!panelWindow) {
    return;
  }

  bubbleWindow?.hide();
  panelWindow.show();
  panelWindow.focus();
  panelWindow.webContents.send("screen-captured", {
    dataUrl: payload?.dataUrl || null,
    captureMeta: payload?.captureMeta || null
  });
}

function syncBubbleWithPanelVisibility() {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) {
    return;
  }
  const panelVisible = Boolean(panelWindow && !panelWindow.isDestroyed() && panelWindow.isVisible());
  if (panelVisible) {
    bubbleWindow.hide();
  } else {
    bubbleWindow.show();
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runPowerShell(script, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    execFile(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { timeout: timeoutMs, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message));
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

async function performGlobalClick(x, y) {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MouseOps {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
[MouseOps]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null
Start-Sleep -Milliseconds 70
[MouseOps]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
[MouseOps]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
`;
  await runPowerShell(script, 12000);
}

async function performGlobalDoubleClick(x, y) {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MouseOps {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
[MouseOps]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null
Start-Sleep -Milliseconds 60
[MouseOps]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
[MouseOps]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 70
[MouseOps]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
[MouseOps]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
`;
  await runPowerShell(script, 12000);
}

function toSingleQuotedPs(value) {
  return String(value || "").replace(/'/g, "''");
}

async function performGlobalType(text) {
  const escaped = toSingleQuotedPs(text);
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Set-Clipboard -Value '${escaped}'
Start-Sleep -Milliseconds 60
$wshell = New-Object -ComObject WScript.Shell
$wshell.SendKeys('^v')
`;
  await runPowerShell(script, 12000);
}

function resolveSafeLocalHtmlPath(filePath) {
  const cleaned = String(filePath || "").replace(/^["']|["']$/g, "");
  const resolved = path.resolve(__dirname, cleaned);
  const projectRoot = path.resolve(__dirname);
  const relative = path.relative(projectRoot, resolved);
  const isInside = relative && !relative.startsWith("..") && !path.isAbsolute(relative);
  if (!isInside) {
    throw new Error("File path is outside project.");
  }
  const ext = path.extname(resolved).toLowerCase();
  if (ext !== ".html" && ext !== ".htm") {
    throw new Error("Only .html/.htm files are allowed.");
  }
  return resolved;
}

async function openLocalHtmlInBrowser(filePath) {
  const absPath = resolveSafeLocalHtmlPath(filePath);
  const escaped = toSingleQuotedPs(absPath);
  const script = `Start-Process '${escaped}'`;
  await runPowerShell(script, 10000);
}

async function openUrlInBrowser(url) {
  const input = String(url || "").trim();
  if (!/^https?:\/\//i.test(input)) {
    throw new Error("URL must start with http:// or https://");
  }
  const escaped = toSingleQuotedPs(input);
  const script = `Start-Process '${escaped}'`;
  await runPowerShell(script, 10000);
}

async function performGlobalKeySequence(keys) {
  const escaped = toSingleQuotedPs(keys);
  const script = `
$wshell = New-Object -ComObject WScript.Shell
$wshell.SendKeys('${escaped}')
`;
  await runPowerShell(script, 10000);
}

async function captureWithoutAssistantWindows(captureFn) {
  const maskedWindows = [];
  const maybeMask = (win) => {
    if (!win || win.isDestroyed() || !win.isVisible()) {
      return;
    }
    maskedWindows.push({ win, opacity: win.getOpacity() });
    // Keep windows mounted but visually invisible to reduce flicker.
    win.setOpacity(0);
  };

  maybeMask(panelWindow);
  maybeMask(bubbleWindow);
  maybeMask(overlayWindow);

  try {
    // Let compositor apply opacity update before thumbnail capture.
    await wait(50);
    return await captureFn();
  } finally {
    maskedWindows.forEach(({ win, opacity }) => {
      if (win && !win.isDestroyed()) {
        win.setOpacity(typeof opacity === "number" ? opacity : 1);
      }
    });
    syncBubbleWithPanelVisibility();
  }
}

async function captureActiveDisplayDataUrl() {
  const cursorPoint = screen.getCursorScreenPoint();
  const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);
  const scaleFactor = Number(activeDisplay.scaleFactor) || 1;
  const displayBoundsDip = activeDisplay.bounds;
  const displayBoundsPx = {
    x: Math.round(displayBoundsDip.x * scaleFactor),
    y: Math.round(displayBoundsDip.y * scaleFactor),
    width: Math.round(displayBoundsDip.width * scaleFactor),
    height: Math.round(displayBoundsDip.height * scaleFactor)
  };
  const captureSize = {
    width: Math.max(displayBoundsPx.width, 1280),
    height: Math.max(displayBoundsPx.height, 720)
  };

  return captureWithoutAssistantWindows(async () => {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: captureSize
    });

    const exactMatch = sources.find(
      (source) => String(source.display_id) === String(activeDisplay.id)
    );
    const source = exactMatch || sources[0];
    if (!source) {
      throw new Error("No screen source available.");
    }
    return {
      dataUrl: source.thumbnail.toDataURL(),
      captureMeta: {
        displayBoundsDip,
        displayBoundsPx,
        scaleFactor
      }
    };
  });
}

app.whenReady().then(() => {
  createBubbleWindow();
  createPanelWindow();

  panelWindow.on("show", () => {
    syncBubbleWithPanelVisibility();
  });

  panelWindow.on("hide", () => {
    syncBubbleWithPanelVisibility();
    hideOverlay();
  });

  panelWindow.on("closed", () => {
    bubbleWindow?.show();
    panelWindow = null;
    hideOverlay();
  });

  ipcMain.on("open-help-panel", (_event, payload) => {
    showPanelWithCapture(payload || {});
  });

  ipcMain.on("close-help-panel", () => {
    panelWindow?.hide();
    hideOverlay();
  });

  ipcMain.handle("overlay:show", async (_event, payload) => {
    showOverlayForCapture({
      steps: payload?.steps || [],
      captureMeta: payload?.captureMeta || null
    });
    return { ok: true };
  });

  ipcMain.handle("overlay:hide", async () => {
    hideOverlay();
    return { ok: true };
  });

  ipcMain.on("move-bubble-window", (_event, payload) => {
    if (!bubbleWindow || bubbleWindow.isDestroyed()) {
      return;
    }
    const x = Math.round(Number(payload?.x) || 0);
    const y = Math.round(Number(payload?.y) || 0);
    bubbleWindow.setPosition(x, y);
  });

  ipcMain.handle("settings:get", async () => {
    const settings = await readSettings();
    const provider = settings.provider || "openai";
    return {
      provider,
      apiKey: decryptText(settings.encryptedApiKeys?.[provider] || "")
    };
  });

  ipcMain.handle("settings:set", async (_event, payload) => {
    const provider = payload?.provider === "gemini" ? "gemini" : "openai";
    const apiKey = (payload?.apiKey || "").trim();
    const settings = await readSettings();
    const encryptedApiKeys = settings.encryptedApiKeys || {};
    if (apiKey) {
      encryptedApiKeys[provider] = encryptText(apiKey);
    }
    const nextSettings = { provider, encryptedApiKeys };
    await writeSettings(nextSettings);
    return { ok: true };
  });

  ipcMain.handle("analyze:screen", async (_event, payload) => {
    const provider = payload?.provider === "gemini" ? "gemini" : "openai";
    const userQuestion = (payload?.question || "").trim();
    const ocrElements = Array.isArray(payload?.ocrElements) ? payload.ocrElements : [];
    const uiTreeElements = Array.isArray(payload?.uiTreeElements) ? payload.uiTreeElements : [];
    const question = buildGuidancePrompt(userQuestion, ocrElements, uiTreeElements);
    const imageDataUrl = payload?.imageDataUrl || "";
    if (!userQuestion) {
      throw new Error("Question is required.");
    }
    if (!imageDataUrl) {
      throw new Error("Screenshot is required.");
    }

    const settings = await readSettings();
    const inputKey = (payload?.apiKey || "").trim();
    const savedKey = decryptText(settings.encryptedApiKeys?.[provider] || "");
    const apiKey = inputKey || savedKey;
    if (!apiKey) {
      throw new Error(`No API key found for ${provider}. Save one first.`);
    }

    let answer = "";
    if (provider === "gemini") {
      answer = await callGemini({ apiKey, question, imageDataUrl });
    } else {
      answer = await callOpenAI({ apiKey, question, imageDataUrl });
    }
    const guidance = tryParseGuidance(answer);
    return { answer: guidance.summary || answer, guidance };
  });

  ipcMain.handle("capture:screen", async () => {
    return captureActiveDisplayDataUrl();
  });

  ipcMain.handle("ocr:extract", async (_event, payload) => {
    const imageDataUrl = String(payload?.imageDataUrl || "");
    if (!imageDataUrl) {
      return { available: false, elements: [], error: "Screenshot is required." };
    }
    return extractOcrElementsFromDataUrl(imageDataUrl);
  });

  ipcMain.handle("uitree:detect", async (_event, payload) => {
    return detectUiTreeElements(payload?.captureMeta || null);
  });

  ipcMain.handle("automation:click", async (_event, payload) => {
    const x = Number(payload?.x);
    const y = Number(payload?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error("Invalid click coordinates.");
    }
    await performGlobalClick(x, y);
    return { ok: true };
  });

  ipcMain.handle("automation:type", async (_event, payload) => {
    const text = String(payload?.text || "");
    if (!text.trim()) {
      throw new Error("No text provided for typing.");
    }
    await performGlobalType(text);
    return { ok: true };
  });

  ipcMain.handle("automation:open-local-html", async (_event, payload) => {
    const filePath = String(payload?.filePath || "").trim();
    if (!filePath) {
      throw new Error("No filePath provided.");
    }
    await openLocalHtmlInBrowser(filePath);
    return { ok: true };
  });

  ipcMain.handle("automation:open-url", async (_event, payload) => {
    const url = String(payload?.url || "").trim();
    if (!url) {
      throw new Error("No url provided.");
    }
    await openUrlInBrowser(url);
    return { ok: true };
  });

  ipcMain.handle("automation:double-click", async (_event, payload) => {
    const x = Number(payload?.x);
    const y = Number(payload?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error("Invalid double-click coordinates.");
    }
    await performGlobalDoubleClick(x, y);
    return { ok: true };
  });

  ipcMain.handle("automation:key", async (_event, payload) => {
    const keys = String(payload?.keys || "");
    if (!keys) {
      throw new Error("No key sequence provided.");
    }
    await performGlobalKeySequence(keys);
    return { ok: true };
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createBubbleWindow();
      createPanelWindow();
    }
  });
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception in main process:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection in main process:", error);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
