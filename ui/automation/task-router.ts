import type { TaskType } from "./task-types";

function normalize(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function routeTaskType(userGoal: string): TaskType {
  const text = normalize(userGoal);
  const looksLikeMarketing =
    text.includes("promote") ||
    text.includes("marketing") ||
    text.includes("ads") ||
    text.includes("campaign") ||
    text.includes("keywords") ||
    text.includes("seo") ||
    text.includes("landing page") ||
    text.includes("linkedin") ||
    text.includes("facebook ad") ||
    text.includes("google ad");
  const looksLikeResearch =
    text.includes("compare") ||
    text.includes("research") ||
    text.includes("find prices") ||
    text.includes("check prices") ||
    text.includes("top 10") ||
    text.includes("list ") ||
    text.includes("courses") ||
    text.includes("fridges") ||
    text.includes("products");
  const looksLikeExcel =
    text.includes("excel") ||
    text.includes("workbook") ||
    text.includes("spreadsheet") ||
    text.includes("sheet") ||
    text.includes("cell");
  const looksLikeDesktop =
    text.includes("desktop") ||
    text.includes("icons") ||
    text.includes("folder") ||
    text.includes("windows") ||
    text.includes("settings") ||
    text.includes("whatsapp") ||
    text.includes("notepad");
  const looksLikeBrowser =
    text.includes("open ") ||
    text.includes("website") ||
    text.includes("browser") ||
    text.includes("youtube") ||
    text.includes("amazon") ||
    text.includes("google") ||
    text.includes("myntra") ||
    text.includes("tradingview");

  const matched = [looksLikeMarketing, looksLikeResearch, looksLikeExcel, looksLikeDesktop, looksLikeBrowser].filter(Boolean).length;
  if (matched > 1) {
    return "mixed";
  }
  if (looksLikeMarketing) return "marketing";
  if (looksLikeResearch) return "research";
  if (looksLikeExcel) return "excel";
  if (looksLikeDesktop) return "desktop";
  return "browser";
}

