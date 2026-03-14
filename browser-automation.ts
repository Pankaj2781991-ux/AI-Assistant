export {};

const os = require("os");
const path = require("path");

type Dict = Record<string, any>;

type BrowserActionStep = {
  action?: string;
  anchorText?: string;
  target?: string;
  instruction?: string;
  controlType?: string;
  textToType?: string;
  url?: string;
  bbox?: { x?: number; y?: number; w?: number; h?: number };
};

type BrowserAutomationOptions = {
  getSettings?: () => Promise<Record<string, any>>;
};

function hostMatches(url: string, expected: string) {
  try {
    return new URL(String(url || "")).hostname.toLowerCase().includes(expected.toLowerCase());
  } catch (_error) {
    return false;
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferRole(controlType: string, action: string) {
  const type = normalizeText(controlType);
  if (type.includes("button")) return "button";
  if (type.includes("link")) return "link";
  if (type.includes("textbox") || type.includes("text box") || type.includes("input") || action === "type") {
    return "textbox";
  }
  if (type.includes("checkbox")) return "checkbox";
  if (type.includes("radio")) return "radio";
  if (type.includes("tab")) return "tab";
  return "";
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const next = String(value || "").trim();
    if (!next) continue;
    const key = next.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  return out;
}

function extractQuotedPhrases(value: string) {
  const text = String(value || "");
  const matches = [...text.matchAll(/["']([^"']{2,120})["']/g)];
  return matches.map((match) => String(match[1] || "").trim()).filter(Boolean);
}

function stripInstructionNoise(value: string) {
  return String(value || "")
    .replace(/^(click|tap|select|open|choose|press|focus|go to|launch|visit)\s+/i, "")
    .replace(/\s+(button|link|field|box|textbox|input)\.?$/i, "")
    .replace(/\s+on\s+the\s+.+$/i, "")
    .replace(/\s+in\s+the\s+.+$/i, "")
    .replace(/\s+page\.?$/i, "")
    .replace(/\s+screen\.?$/i, "")
    .trim();
}

function getAnchorVariants(step: BrowserActionStep) {
  const raw = uniqueStrings([
    step?.anchorText || "",
    step?.target || "",
    step?.instruction || "",
    ...extractQuotedPhrases(step?.target || ""),
    ...extractQuotedPhrases(step?.instruction || "")
  ]);
  const expanded: string[] = [];
  for (const value of raw) {
    expanded.push(value);
    expanded.push(stripInstructionNoise(value));
    expanded.push(value.replace(/^(click|tap|select|open|type|enter|write|focus)\s+/i, "").trim());
    expanded.push(value.replace(/\s+(button|link|field|box|textbox|input)$/i, "").trim());
    const words = stripInstructionNoise(value).split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      expanded.push(words.slice(-2).join(" "));
    }
  }
  return uniqueStrings(expanded).filter((value) => value.length >= 2);
}

function looksLikeSearchStep(step: BrowserActionStep) {
  const text = normalizeText([step?.anchorText, step?.target, step?.instruction].filter(Boolean).join(" "));
  return text.includes("search");
}

function looksLikeFieldClick(step: BrowserActionStep) {
  const text = normalizeText([step?.anchorText, step?.target, step?.instruction, step?.controlType].filter(Boolean).join(" "));
  return (
    text.includes("field") ||
    text.includes("textbox") ||
    text.includes("text box") ||
    text.includes("input") ||
    text.includes("search") ||
    text.includes("search chats")
  );
}

function isClosedTargetError(error: any) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("target page, context or browser has been closed") ||
    message.includes("browser has been closed") ||
    message.includes("context has been closed") ||
    message.includes("page has been closed")
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function createBrowserAutomation(options: BrowserAutomationOptions = {}) {
  let playwright: any = null;
  let browser: any = null;
  let context: any = null;
  let page: any = null;
  let launchSignature = "";
  let lastDomMap = {
    receivedAt: 0,
    sourceUrl: "",
    pageTitle: "",
    viewport: null,
    elements: []
  };

  function resetSession() {
    page = null;
    context = null;
    browser = null;
    launchSignature = "";
  }

  function getEmptyDomMap() {
    return {
      ...lastDomMap,
      receivedAt: 0,
      sourceUrl: "",
      pageTitle: "",
      elements: []
    };
  }

  async function ensurePlaywright() {
    if (!playwright) {
      playwright = require("playwright");
    }
    return playwright;
  }

  function normalizeBrowserChannel(value: string) {
    const channel = String(value || "").trim().toLowerCase();
    if (channel === "msedge" || channel === "brave" || channel === "chromium") {
      return channel;
    }
    return "chrome";
  }

  function defaultUserDataDir(channel: string) {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    if (channel === "msedge") {
      return path.join(localAppData, "Microsoft", "Edge", "User Data");
    }
    if (channel === "brave") {
      return path.join(localAppData, "BraveSoftware", "Brave-Browser", "User Data");
    }
    if (channel === "chromium") {
      return path.join(localAppData, "Chromium", "User Data");
    }
    return path.join(localAppData, "Google", "Chrome", "User Data");
  }

  async function getLaunchConfig() {
    const settings = (await options.getSettings?.()) || {};
    const channel = normalizeBrowserChannel(String(settings.browserChannel || "chrome"));
    const executablePath = String(settings.browserExecutablePath || "").trim();
    const usePersistentProfile = Boolean(settings.browserUsePersistentProfile);
    const userDataDir = String(settings.browserUserDataDir || "").trim() || defaultUserDataDir(channel);
    const profileDirectory = String(settings.browserProfileDirectory || "").trim() || "Default";
    return {
      channel,
      executablePath,
      usePersistentProfile,
      userDataDir,
      profileDirectory
    };
  }

  async function closeSession() {
    if (page && !page.isClosed()) {
      await page.close().catch(() => {});
    }
    page = null;
    if (context) {
      await context.close().catch(() => {});
    }
    context = null;
    if (browser) {
      await browser.close().catch(() => {});
    }
    browser = null;
    launchSignature = "";
  }

  async function ensurePage() {
    const pw = await ensurePlaywright();
    const launchConfig = await getLaunchConfig();
    const nextSignature = JSON.stringify(launchConfig);
    if ((browser || context) && launchSignature && launchSignature !== nextSignature) {
      await closeSession();
    }

    if (!browser && !context) {
      const launchOptions = {
        headless: false,
        args: [
          "--disable-blink-features=AutomationControlled",
          `--profile-directory=${launchConfig.profileDirectory}`
        ]
      } as any;
      if (launchConfig.executablePath) {
        launchOptions.executablePath = launchConfig.executablePath;
      } else if (launchConfig.channel !== "chromium") {
        launchOptions.channel = launchConfig.channel;
      }

      try {
        if (launchConfig.usePersistentProfile) {
          context = await pw.chromium.launchPersistentContext(launchConfig.userDataDir, {
            ...launchOptions,
            viewport: { width: 1366, height: 900 }
          });
          browser = context.browser?.() || null;
        } else {
          browser = await pw.chromium.launch(launchOptions);
        }
      } catch (error) {
        const message = String(error?.message || error || "");
        if (launchConfig.usePersistentProfile && /(process_singleton|singleton|profile|user data dir|in use|locked)/i.test(message)) {
          throw new Error(
            `Chrome profile "${launchConfig.profileDirectory}" is already in use. Close Chrome windows using that profile, then retry.`
          );
        }
        if (launchConfig.executablePath) {
          throw new Error(`Could not launch browser from "${launchConfig.executablePath}". ${message}`.trim());
        }
        throw error;
      }
      browser.on?.("disconnected", () => {
        resetSession();
      });
      context?.on?.("close", () => {
        resetSession();
      });
      launchSignature = nextSignature;
    }
    if (!context) {
      context = await browser.newContext({
        viewport: { width: 1366, height: 900 }
      });
      context.on?.("close", () => {
        if (context && context.pages().length === 0) {
          resetSession();
        }
      });
    }
    if (!page || page.isClosed()) {
      const existingPages = context.pages?.().filter((item: any) => item && !item.isClosed?.()) || [];
      page = existingPages[0] || (await context.newPage());
      page.on("close", () => {
        if (context?.pages?.().filter((item: any) => item && !item.isClosed?.()).length <= 1) {
          resetSession();
        } else {
          page = null;
        }
      });
    }
    return page;
  }

  async function refreshDomMap() {
    if (!page || page.isClosed()) {
      return getEmptyDomMap();
    }
    const activePage = await ensurePage();
    let payload;
    try {
      payload = await activePage.evaluate(() => {
        function visible(el) {
          const style = window.getComputedStyle(el);
          if (!style || style.visibility === "hidden" || style.display === "none") return false;
          const rect = el.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) return false;
          if (rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) {
            return false;
          }
          return true;
        }

        function cleanText(el) {
          const raw =
            el.getAttribute("aria-label") ||
            el.getAttribute("title") ||
            el.innerText ||
            el.textContent ||
            el.value ||
            "";
          return String(raw).replace(/\s+/g, " ").trim();
        }

        const selectors = [
          "button",
          "a",
          "input",
          "textarea",
          "select",
          "[role='button']",
          "[role='link']",
          "[role='textbox']",
          "[contenteditable='true']",
          "label",
          "h1, h2, h3, h4",
          "[aria-label]",
          "[title]"
        ];

        const nodes = Array.from(document.querySelectorAll(selectors.join(",")));
        const seen = new Set();
        const elements = [];
        const pageW = Math.max(
          document.documentElement.scrollWidth || 0,
          document.body?.scrollWidth || 0,
          window.innerWidth
        );
        const pageH = Math.max(
          document.documentElement.scrollHeight || 0,
          document.body?.scrollHeight || 0,
          window.innerHeight
        );

        for (const el of nodes) {
          if (!visible(el)) continue;
          const txt = cleanText(el);
          if (!txt) continue;
          const rect = el.getBoundingClientRect();
          const docX = rect.left + window.scrollX;
          const docY = rect.top + window.scrollY;
          const key = `${Math.round(docX)}:${Math.round(docY)}:${Math.round(rect.width)}:${Math.round(
            rect.height
          )}:${txt.slice(0, 80)}`;
          if (seen.has(key)) continue;
          seen.add(key);

          elements.push({
            text: txt.slice(0, 280),
            tag: String(el.tagName || "").toLowerCase(),
            controlType: el.getAttribute("role") || "",
            bbox: {
              x: Math.max(0, Math.min(1, docX / pageW)),
              y: Math.max(0, Math.min(1, docY / pageH)),
              w: Math.max(0.0005, Math.min(1, rect.width / pageW)),
              h: Math.max(0.0005, Math.min(1, rect.height / pageH))
            }
          });
          if (elements.length >= 1000) break;
        }

        return {
          sourceUrl: location.href,
          pageTitle: document.title || "",
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            scrollX: window.scrollX,
            scrollY: window.scrollY
          },
          elements
        };
      });
    } catch (error) {
      if (isClosedTargetError(error)) {
        resetSession();
        return getEmptyDomMap();
      }
      throw error;
    }

    lastDomMap = {
      ...payload,
      receivedAt: Date.now()
    };
    return lastDomMap;
  }

  async function waitForPageReady(activePage: any) {
    await Promise.race([
      activePage.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {}),
      wait(1200)
    ]);
    await wait(350);
  }

  async function openUrl(url: string) {
    const activePage = await ensurePage();
    await activePage.goto(String(url || "").trim(), {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });
    await waitForPageReady(activePage);
    await refreshDomMap();
    return getState();
  }

  async function capturePage() {
    if (!page || page.isClosed()) {
      throw new Error("Browser session is not active. Open a page first.");
    }
    const activePage = await ensurePage();
    let shot;
    let dom;
    let body;
    try {
      await waitForPageReady(activePage);
      shot = await activePage.screenshot({
        fullPage: true,
        type: "png"
      });
      dom = await refreshDomMap();
      body = await activePage.evaluate(() => ({
        width: Math.max(
          document.documentElement.scrollWidth || 0,
          document.body?.scrollWidth || 0,
          window.innerWidth
        ),
        height: Math.max(
          document.documentElement.scrollHeight || 0,
          document.body?.scrollHeight || 0,
          window.innerHeight
        )
      }));
    } catch (error) {
      if (isClosedTargetError(error)) {
        resetSession();
        throw new Error("Browser session was closed. Start the browser task again.");
      }
      throw error;
    }
    return {
      dataUrl: `data:image/png;base64,${shot.toString("base64")}`,
      captureMeta: {
        fullPageCapture: true,
        sourceUrl: dom.sourceUrl || activePage.url(),
        displayBoundsDip: { x: 0, y: 0, width: Number(body.width) || 1366, height: Number(body.height) || 900 },
        displayBoundsPx: { x: 0, y: 0, width: Number(body.width) || 1366, height: Number(body.height) || 900 },
        scaleFactor: 1,
        browserAutomation: true
      }
    };
  }

  async function getState() {
    if (!page || page.isClosed()) {
      return {
        active: false,
        url: "",
        title: "",
        receivedAt: lastDomMap.receivedAt || 0
      };
    }
    let title = "";
    try {
      title = await page.title();
    } catch (error) {
      if (isClosedTargetError(error)) {
        resetSession();
        return {
          active: false,
          url: "",
          title: "",
          receivedAt: 0
        };
      }
      title = "";
    }
    return {
      active: true,
      url: page.url(),
      title,
      receivedAt: lastDomMap.receivedAt || 0
    };
  }

  async function tryLocatorClick(step: BrowserActionStep, clickKind: "click" | "dblclick") {
    const activePage = await ensurePage();
    const anchors = getAnchorVariants(step);
    if (!anchors.length) {
      return false;
    }

    const candidates: any[] = [];
    for (const anchor of anchors) {
      const role = inferRole(String(step?.controlType || ""), String(step?.action || ""));
      if (role) {
        candidates.push(activePage.getByRole(role, { name: anchor, exact: false }).first());
      }
      if (looksLikeFieldClick(step)) {
        candidates.push(activePage.getByRole("textbox", { name: anchor, exact: false }).first());
        candidates.push(activePage.getByPlaceholder(anchor, { exact: false }).first());
        candidates.push(
          activePage.locator(
            `input[placeholder*="${anchor.replace(/"/g, '\\"')}"], textarea[placeholder*="${anchor.replace(/"/g, '\\"')}"], input[aria-label*="${anchor.replace(/"/g, '\\"')}"], textarea[aria-label*="${anchor.replace(/"/g, '\\"')}"]`
          ).first()
        );
      }
      candidates.push(activePage.getByText(anchor, { exact: false }).first());
      candidates.push(activePage.getByLabel(anchor, { exact: false }).first());
      candidates.push(activePage.getByPlaceholder(anchor, { exact: false }).first());
      candidates.push(activePage.locator(`[aria-label*="${anchor.replace(/"/g, '\\"')}"]`).first());
      candidates.push(activePage.locator(`[title*="${anchor.replace(/"/g, '\\"')}"]`).first());
    }

    if (hostMatches(activePage.url(), "web.whatsapp.com") && looksLikeSearchStep(step)) {
      candidates.unshift(activePage.locator("[contenteditable='true'][data-tab]").first());
      candidates.unshift(activePage.locator("div[role='textbox']").first());
      candidates.unshift(activePage.locator("input[placeholder*='Search']").first());
      candidates.unshift(activePage.getByPlaceholder("Search or start new chat", { exact: false }).first());
    }

    for (const locator of candidates) {
      try {
        if ((await locator.count()) < 1) continue;
        await locator.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
        if (clickKind === "dblclick") {
          await locator.dblclick({ timeout: 4000 });
        } else {
          await locator.click({ timeout: 4000 });
        }
        return true;
      } catch (_error) {
        // Try next strategy.
      }
    }
    return false;
  }

  async function resolveEditableLocator(step: BrowserActionStep) {
    const activePage = await ensurePage();
    const anchors = getAnchorVariants(step);
    const candidates: any[] = [];

    if (hostMatches(activePage.url(), "youtube.com") && looksLikeSearchStep(step)) {
      candidates.push(activePage.locator("input#search").first());
      candidates.push(activePage.locator("input[name='search_query']").first());
      candidates.push(activePage.locator("ytd-searchbox input").first());
      candidates.push(activePage.locator("yt-searchbox input").first());
      candidates.push(activePage.locator("input[placeholder*='Search']").first());
    }

    for (const anchor of anchors) {
      candidates.push(activePage.getByRole("textbox", { name: anchor, exact: false }).first());
      candidates.push(activePage.getByLabel(anchor, { exact: false }).first());
      candidates.push(activePage.getByPlaceholder(anchor, { exact: false }).first());
      candidates.push(activePage.locator(`input[aria-label*="${anchor.replace(/"/g, '\\"')}"], textarea[aria-label*="${anchor.replace(/"/g, '\\"')}"]`).first());
      candidates.push(activePage.locator(`input[title*="${anchor.replace(/"/g, '\\"')}"], textarea[title*="${anchor.replace(/"/g, '\\"')}"]`).first());
      candidates.push(activePage.locator(`input[name*="${anchor.replace(/"/g, '\\"')}"], textarea[name*="${anchor.replace(/"/g, '\\"')}"]`).first());
      candidates.push(activePage.locator(`input[placeholder*="${anchor.replace(/"/g, '\\"')}"], textarea[placeholder*="${anchor.replace(/"/g, '\\"')}"]`).first());
    }

    for (const locator of candidates) {
      try {
        if ((await locator.count()) < 1) continue;
        await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        return locator;
      } catch (_error) {
        // Try next locator.
      }
    }

    const generic = activePage.locator("input, textarea, [contenteditable='true'], [role='textbox']").first();
    try {
      if ((await generic.count()) > 0) {
        await generic.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        return generic;
      }
    } catch (_error) {
      // Ignore generic fallback failure.
    }
    return null;
  }

  async function verifyEditableValue(locator: any, text: string) {
    try {
      const value = await locator.inputValue({ timeout: 1000 }).catch(() => "");
      if (String(value || "").trim() === text) {
        return true;
      }
    } catch (_error) {
      // Fall through to DOM evaluation fallback.
    }
    try {
      return await locator.evaluate((el: any, expected: string) => {
        const value =
          typeof el?.value === "string"
            ? el.value
            : typeof el?.textContent === "string"
              ? el.textContent
              : "";
        return String(value || "").trim() === expected;
      }, text);
    } catch (_error) {
      return false;
    }
  }

  async function verifyPageHasTypedValue(activePage: any, text: string) {
    try {
      return await activePage.evaluate((expected: string) => {
        const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | HTMLElement | null;
        if (!el) return false;
        const value =
          typeof (el as any).value === "string"
            ? (el as any).value
            : typeof el.textContent === "string"
              ? el.textContent
              : "";
        return String(value || "").trim() === expected;
      }, text);
    } catch (_error) {
      return false;
    }
  }

  async function fillFocusedEditable(activePage: any, text: string) {
    return activePage.evaluate((value) => {
      const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | HTMLElement | null;
      if (!el) return false;
      const tag = String((el as any).tagName || "").toLowerCase();
      const editable =
        tag === "input" ||
        tag === "textarea" ||
        (el as HTMLElement).isContentEditable ||
        el.getAttribute("role") === "textbox";
      if (!editable) return false;

      el.focus();
      if (tag === "input" || tag === "textarea") {
        const input = el as HTMLInputElement | HTMLTextAreaElement;
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }

      el.textContent = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, text);
  }

  async function clickByBbox(step: BrowserActionStep, clickKind: "click" | "dblclick") {
    const activePage = await ensurePage();
    const box = step?.bbox || {};
    const rawX = Number(box.x);
    const rawY = Number(box.y);
    const rawW = Number(box.w);
    const rawH = Number(box.h);
    if (![rawX, rawY, rawW, rawH].every(Number.isFinite)) {
      throw new Error("No valid bbox was provided for browser action.");
    }

    const pageSize = await activePage.evaluate(() => ({
      width: Math.max(
        document.documentElement.scrollWidth || 0,
        document.body?.scrollWidth || 0,
        window.innerWidth
      ),
      height: Math.max(
        document.documentElement.scrollHeight || 0,
        document.body?.scrollHeight || 0,
        window.innerHeight
      )
    }));
    const centerX = (rawX + rawW / 2) * pageSize.width;
    const centerY = (rawY + rawH / 2) * pageSize.height;
    await activePage.mouse.move(centerX, centerY);
    if (clickKind === "dblclick") {
      await activePage.mouse.dblclick(centerX, centerY);
    } else {
      await activePage.mouse.click(centerX, centerY);
    }
  }

  function hasValidBbox(step: BrowserActionStep) {
    const box = step?.bbox || {};
    return [box.x, box.y, box.w, box.h].every((value) => Number.isFinite(Number(value)));
  }

  async function findBboxFromDomMap(step: BrowserActionStep) {
    const dom = await refreshDomMap();
    const anchors = getAnchorVariants(step).map((value) => normalizeText(value));
    if (!anchors.length || !Array.isArray(dom?.elements) || !dom.elements.length) {
      return null;
    }

    let best: any = null;
    let bestScore = 0;
    for (const el of dom.elements) {
      const text = normalizeText(String(el?.text || ""));
      if (!text || !el?.bbox) continue;
      for (const anchor of anchors) {
        let score = 0;
        if (text === anchor) score = 1;
        else if (text.includes(anchor) || anchor.includes(text)) score = 0.92;
        else {
          const anchorTokens = anchor.split(" ").filter(Boolean);
          const textTokens = new Set(text.split(" ").filter(Boolean));
          const overlap = anchorTokens.filter((token) => textTokens.has(token)).length;
          if (overlap > 0) {
            score = overlap / Math.max(anchorTokens.length, 1);
          }
        }
        if (score > bestScore) {
          bestScore = score;
          best = el;
        }
      }
    }

    if (best && bestScore >= 0.72) {
      return best.bbox;
    }
    return null;
  }

  async function performType(step: BrowserActionStep) {
    const activePage = await ensurePage();
    const text = String(step?.textToType || "").trim();
    if (!text) {
      throw new Error("No textToType provided for browser typing.");
    }
    const editable = await resolveEditableLocator(step);
    if (editable) {
      try {
        await editable.click({ timeout: 3000 });
        await editable.fill(text, { timeout: 4000 });
        if (await verifyEditableValue(editable, text)) {
          return;
        }
      } catch (_error) {
        // Try other strategies below.
      }
      try {
        await editable.click({ timeout: 3000 });
        await editable.press("Control+A", { timeout: 2000 }).catch(() => {});
        await editable.type(text, { delay: 12, timeout: 5000 });
        if (await verifyEditableValue(editable, text)) {
          return;
        }
      } catch (_innerError) {
        // Continue to fallback strategies.
      }
      try {
        const handle = await editable.elementHandle({ timeout: 2000 });
        if (handle) {
          const setOk = await activePage.evaluate(
            (el: any, expected: string) => {
              if (!el) return false;
              el.focus?.();
              if (typeof el.value === "string") {
                el.value = expected;
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
                return String(el.value || "").trim() === expected;
              }
              if (el.isContentEditable) {
                el.textContent = expected;
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
                return String(el.textContent || "").trim() === expected;
              }
              return false;
            },
            handle,
            text
          );
          if (setOk) {
            return;
          }
        }
      } catch (_finalLocatorError) {
        // Continue to page-level fallbacks.
      }
    }
    const clicked = await tryLocatorClick(step, "click");
    if (!clicked) {
      const resolvedStep = hasValidBbox(step)
        ? step
        : { ...step, bbox: await findBboxFromDomMap(step) };
      if (hasValidBbox(resolvedStep)) {
        await clickByBbox(resolvedStep, "click");
      }
    }
    await wait(120);
    if ((await fillFocusedEditable(activePage, text)) && (await verifyPageHasTypedValue(activePage, text))) {
      return;
    }
    await activePage.keyboard.press("Control+A").catch(() => {});
    await activePage.keyboard.press("Backspace").catch(() => {});
    await activePage.keyboard.type(text, { delay: 12 });
    await wait(120);
    if (await verifyPageHasTypedValue(activePage, text)) {
      return;
    }
    throw new Error(`Typing verification failed for "${text}".`);
  }

  async function executeStep(step: BrowserActionStep) {
    const action = String(step?.action || "").toLowerCase();
    if (!action) {
      throw new Error("Step action is required.");
    }
    const activePage = await ensurePage();

    if (action === "open_url") {
      const url = String(step?.url || "").trim();
      if (!/^https?:\/\//i.test(url)) {
        throw new Error("open_url requires a valid http/https URL.");
      }
      await openUrl(url);
    } else if (action === "click") {
      const clicked = await tryLocatorClick(step, "click");
      if (!clicked) {
        const resolvedStep = hasValidBbox(step)
          ? step
          : { ...step, bbox: await findBboxFromDomMap(step) };
        if (!hasValidBbox(resolvedStep)) {
          throw new Error(`Could not find a clickable browser target for "${step?.instruction || step?.target || step?.anchorText || "step"}".`);
        }
        await clickByBbox(resolvedStep, "click");
      }
    } else if (action === "double_click") {
      const clicked = await tryLocatorClick(step, "dblclick");
      if (!clicked) {
        const resolvedStep = hasValidBbox(step)
          ? step
          : { ...step, bbox: await findBboxFromDomMap(step) };
        if (!hasValidBbox(resolvedStep)) {
          throw new Error(`Could not find a clickable browser target for "${step?.instruction || step?.target || step?.anchorText || "step"}".`);
        }
        await clickByBbox(resolvedStep, "dblclick");
      }
    } else if (action === "type") {
      await performType(step);
    } else if (action === "scroll") {
      await activePage.mouse.wheel(0, 700);
    } else if (action === "read" || action === "verify") {
      await wait(50);
    } else {
      throw new Error(`Browser action "${action}" is not supported yet.`);
    }

    await withTimeout(waitForPageReady(activePage), 12000, "Browser step");
    await refreshDomMap();
    return {
      ok: true,
      state: await getState()
    };
  }

  return {
    openUrl,
    capturePage,
    getState,
    getDomMap: async () => {
      if (!page || page.isClosed()) {
        return getEmptyDomMap();
      }
      return refreshDomMap();
    },
    executeStep,
    close: closeSession
  };
}

module.exports = {
  createBrowserAutomation
};
