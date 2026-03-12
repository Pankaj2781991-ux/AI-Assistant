import type { TaskState } from "./task-types";
import type { AutomationObservation } from "./observer";

export type EvaluationResult = {
  status: "continue" | "retry" | "pause" | "done";
  message: string;
};

export function evaluateAutomationProgress(taskState: TaskState | null, step: any, observation: AutomationObservation): EvaluationResult {
  if (!taskState) {
    return { status: "continue", message: "No active task state. Continuing." };
  }

  const action = String(step?.action || "").toLowerCase();

  if (taskState.taskType === "research") {
    if (observation.researchExportWritten) {
      return { status: "done", message: "Research collection completed and exported to Excel." };
    }
    if (action === "research_extract_listings") {
      const added = Number(taskState.memory.lastCollectionAdded || 0);
      if (added > 0) {
        return {
          status: "continue",
          message: `Collected ${observation.collectedCount}/${observation.researchTargetCount || observation.collectedCount} research items.`
        };
      }
      if (observation.hasVisibleResearchListings) {
        return { status: "retry", message: "No new items were collected from the current visible listings. Try a different collection move." };
      }
    }
    if (action === "excel_write_range") {
      return { status: "done", message: "Research comparison rows were written to Excel." };
    }
  }

  if (taskState.taskType === "marketing" && action === "marketing_generate_assets") {
    if (observation.generatedAssetCount > 0) {
      return { status: "done", message: "Marketing assets were generated." };
    }
  }

  if (action === "open_url" && !observation.currentUrl) {
    return { status: "retry", message: "Navigation did not produce a visible page URL yet." };
  }

  return { status: "continue", message: "Step made acceptable progress." };
}
