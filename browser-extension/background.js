const BRIDGE_PORT = 17333;
const BRIDGE_TOKEN = "onscreen-ai-dom-bridge-v1";

async function collectDomMapFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active tab.");
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      function visible(el) {
        const style = window.getComputedStyle(el);
        if (!style || style.visibility === "hidden" || style.display === "none") return false;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false;
        if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) {
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
    }
  });

  if (!result) {
    throw new Error("Failed to collect DOM map.");
  }
  return result;
}

async function sendDomMapToBridge(map) {
  const response = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/dom-map`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bridge-Token": BRIDGE_TOKEN
    },
    body: JSON.stringify(map)
  });
  if (!response.ok) {
    throw new Error(`Bridge request failed (${response.status}).`);
  }
  return response.json().catch(() => ({ ok: true }));
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "send-dom-map") {
    return false;
  }
  (async () => {
    try {
      const map = await collectDomMapFromActiveTab();
      const res = await sendDomMapToBridge(map);
      sendResponse({
        ok: true,
        count: map.elements?.length || 0,
        bridge: res?.ok !== false,
        url: map.sourceUrl || ""
      });
    } catch (error) {
      sendResponse({ ok: false, error: error.message || "Failed to send DOM map." });
    }
  })();
  return true;
});
