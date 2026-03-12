type DomElement = {
  text?: string;
  tag?: string;
  bbox?: { x?: number; y?: number; w?: number; h?: number };
};

function normalize(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyPrice(text: string) {
  return /(?:₹|rs\.?|inr|\$|€|£)\s?\d/i.test(text) || /\b\d[\d,]{2,}\b/.test(text);
}

function isLikelyRating(text: string) {
  return /\b\d(\.\d)?\s*out of\s*5\b/i.test(text) || /\b\d(\.\d)?\s*stars?\b/i.test(text) || /\b\d(\.\d)?\/5\b/i.test(text);
}

function isCandidateTitle(text: string) {
  const clean = String(text || "").trim();
  if (clean.length < 12 || clean.length > 180) return false;
  const normalized = normalize(clean);
  if (!normalized) return false;
  if (normalized.includes("sponsored") || normalized.includes("delivery") || normalized.includes("add to cart")) return false;
  if (isLikelyPrice(clean) || isLikelyRating(clean)) return false;
  return /[a-z]/i.test(clean);
}

function distance(a = 0, b = 0) {
  return Math.abs(Number(a) - Number(b));
}

export function extractVisibleResearchItems(domElements: DomElement[], currentUrl: string, userGoal: string) {
  const elements = Array.isArray(domElements) ? domElements : [];
  const titles = elements.filter((el) => isCandidateTitle(String(el?.text || "")));
  const items = titles
    .map((titleEl) => {
      const y = Number(titleEl?.bbox?.y || 0);
      const x = Number(titleEl?.bbox?.x || 0);
      let price = "";
      let rating = "";

      for (const el of elements) {
        const text = String(el?.text || "").trim();
        if (!text) continue;
        const otherY = Number(el?.bbox?.y || 0);
        const otherX = Number(el?.bbox?.x || 0);
        if (distance(y, otherY) > 0.08 || distance(x, otherX) > 0.22) {
          continue;
        }
        if (!price && isLikelyPrice(text)) {
          price = text;
        }
        if (!rating && isLikelyRating(text)) {
          rating = text;
        }
      }

      return {
        title: String(titleEl?.text || "").trim(),
        price,
        rating,
        sourceUrl: currentUrl
      };
    })
    .filter((item) => item.title)
    .slice(0, 20);

  const summary = items.length
    ? `Extracted ${items.length} visible research candidates from the current page.`
    : `No structured research candidates were found yet for "${userGoal}".`;

  return { items, summary };
}

export function getRequestedResearchCount(userGoal: string) {
  const match = String(userGoal || "").match(/\b(\d{1,2})\b/);
  if (!match) return 5;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return 5;
  return Math.min(20, value);
}

export function hasVisibleResearchListings(domElements: DomElement[]) {
  const elements = Array.isArray(domElements) ? domElements : [];
  return elements.filter((el) => isCandidateTitle(String(el?.text || ""))).length >= 3;
}

export function buildResearchExcelRows(items: Array<{ title?: string; price?: string; rating?: string; sourceUrl?: string }>) {
  const rows = [["Title", "Price", "Rating", "Source URL"]];
  for (const item of Array.isArray(items) ? items : []) {
    rows.push([
      String(item?.title || "").trim(),
      String(item?.price || "").trim(),
      String(item?.rating || "").trim(),
      String(item?.sourceUrl || "").trim()
    ]);
  }
  return rows;
}
