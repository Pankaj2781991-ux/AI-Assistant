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

export function generateMarketingAssetDraft(userGoal: string, taskState: TaskState) {
  const channels = inferChannels(userGoal);
  const asset = {
    type: "campaign_brief",
    title: "Draft Campaign Brief",
    goal: userGoal,
    positioning: "Promote the user's business or app with clear value and simple next-step messaging.",
    channels,
    deliverables: [
      "Audience summary",
      "Keyword or topic ideas",
      "Ad copy angles",
      "Social post starters",
      "Landing page messaging"
    ],
    context: {
      currentUrl: taskState.context.currentUrl || "",
      currentPageTitle: taskState.context.currentPageTitle || ""
    }
  };

  return {
    asset,
    summary: `Generated a reusable marketing draft for ${channels.join(", ")}.`
  };
}
