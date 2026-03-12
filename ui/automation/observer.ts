import { hasVisibleResearchListings } from "./research-tools";
import type { TaskState } from "./task-types";

type ObservationInput = {
  domElements?: any[];
  currentUrl?: string;
  currentPageTitle?: string;
  foregroundWindow?: string;
  activeWorkbook?: string;
};

export type AutomationObservation = {
  currentUrl: string;
  currentPageTitle: string;
  foregroundWindow: string;
  activeWorkbook: string;
  hasVisibleResearchListings: boolean;
  collectedCount: number;
  researchTargetCount: number;
  researchExportWritten: boolean;
  generatedAssetCount: number;
};

export function observeAutomationState(taskState: TaskState | null, input: ObservationInput = {}): AutomationObservation {
  const task = taskState || ({} as TaskState);
  const domElements = Array.isArray(input.domElements) ? input.domElements : [];
  return {
    currentUrl: String(input.currentUrl || task?.context?.currentUrl || "").trim(),
    currentPageTitle: String(input.currentPageTitle || task?.context?.currentPageTitle || "").trim(),
    foregroundWindow: String(input.foregroundWindow || task?.context?.foregroundWindow || "").trim(),
    activeWorkbook: String(input.activeWorkbook || task?.context?.activeWorkbook || "").trim(),
    hasVisibleResearchListings: hasVisibleResearchListings(domElements),
    collectedCount: Array.isArray(task?.memory?.collectedItems) ? task.memory.collectedItems.length : 0,
    researchTargetCount: Number(task?.memory?.researchTargetCount || 0),
    researchExportWritten: Boolean(task?.memory?.researchExportWritten),
    generatedAssetCount: Array.isArray(task?.memory?.generatedAssets) ? task.memory.generatedAssets.length : 0
  };
}

