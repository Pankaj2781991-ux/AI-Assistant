import type { TaskState } from "./task-types";

function normalize(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferChannels(goal: string) {
  const text = normalize(goal);
  const channels = [];
  if (text.includes("google") || text.includes("search") || text.includes("seo")) channels.push("Google");
  if (text.includes("facebook") || text.includes("instagram") || text.includes("meta")) channels.push("Meta");
  if (text.includes("linkedin")) channels.push("LinkedIn");
  if (!channels.length) channels.push("Google", "LinkedIn", "Meta");
  return channels;
}

function inferConversionGoal(goal: string) {
  const text = normalize(goal);
  if (text.includes("lead") || text.includes("demo") || text.includes("book") || text.includes("enquiry")) return "Lead generation";
  if (text.includes("sale") || text.includes("purchase") || text.includes("buy")) return "Sales";
  if (text.includes("traffic") || text.includes("visit") || text.includes("click")) return "Traffic";
  return "Qualified conversions";
}

function inferFunnelStage(goal: string) {
  const text = normalize(goal);
  if (text.includes("retarget") || text.includes("remarketing")) return "Bottom of funnel";
  if (text.includes("awareness") || text.includes("reach") || text.includes("brand")) return "Top of funnel";
  return "Middle of funnel";
}

export function generateMarketingAssetDraft(userGoal: string, taskState: TaskState) {
  const channels = inferChannels(userGoal);
  const brand = taskState.context.currentPageTitle || "Business";
  const asset = {
    type: "campaign_brief",
    title: "Digital Marketing Skill Brief",
    goal: userGoal,
    positioning: "Promote the business with one clear offer, one clear audience, and one direct conversion step.",
    conversionGoal: inferConversionGoal(userGoal),
    funnelStage: inferFunnelStage(userGoal),
    channels,
    audienceSegments: ["Primary buyer", "High-intent searcher", "Warm retargeting audience"],
    keywordClusters: ["core solution", "problem-aware intent", "comparison intent", "brand + offer"],
    messagingAngles: ["benefit-first hook", "pain-to-solution hook", "proof + CTA hook"],
    landingPageChecklist: [
      "Headline clearly states the offer",
      "CTA is visible early",
      "Proof or trust signal is present",
      "Objections are handled",
      "Form friction is low"
    ],
    deliverables: [
      "Positioning summary",
      "Audience segments",
      "Keyword clusters",
      "Messaging angles",
      "Landing page checklist"
    ],
    context: {
      currentUrl: taskState.context.currentUrl || "",
      currentPageTitle: brand
    }
  };

  return {
    asset,
    summary: `Generated a reusable digital-marketing skill brief for ${channels.join(", ")}.`
  };
}
