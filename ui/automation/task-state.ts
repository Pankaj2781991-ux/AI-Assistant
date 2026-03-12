import type { GoalState, TaskState, TaskType } from "./task-types";

function inferResearchTargetCount(userGoal: string) {
  const match = String(userGoal || "").match(/\b(\d{1,2})\b/);
  if (!match) return 5;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return 5;
  return Math.min(20, value);
}

function makeId() {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createTaskState(taskType: TaskType, userGoal: string, goalState: GoalState): TaskState {
  return {
    id: makeId(),
    taskType,
    userGoal,
    goalState,
    progress: {
      completedSteps: [],
      currentStep: "",
      retries: 0,
      status: "running"
    },
    context: {
      currentUrl: "",
      currentPageTitle: "",
      foregroundWindow: "",
      activeWorkbook: ""
    },
    memory: {
      visitedUrls: [],
      visitedWindows: [],
      collectedItems: [],
      generatedAssets: [],
      lastError: "",
      researchTargetCount: taskType === "research" ? inferResearchTargetCount(userGoal) : 0,
      lastCollectionAdded: 0,
      researchExportWritten: false,
      lastResearchLoopAction: ""
    },
    blockedReason: ""
  };
}

export function recordObservation(taskState: TaskState, observation: {
  currentUrl?: string;
  currentPageTitle?: string;
  foregroundWindow?: string;
  activeWorkbook?: string;
}) {
  if (observation.currentUrl) {
    taskState.context.currentUrl = observation.currentUrl;
    if (!taskState.memory.visitedUrls.includes(observation.currentUrl)) {
      taskState.memory.visitedUrls.push(observation.currentUrl);
    }
  }
  if (observation.currentPageTitle) {
    taskState.context.currentPageTitle = observation.currentPageTitle;
  }
  if (observation.foregroundWindow) {
    taskState.context.foregroundWindow = observation.foregroundWindow;
    if (!taskState.memory.visitedWindows.includes(observation.foregroundWindow)) {
      taskState.memory.visitedWindows.push(observation.foregroundWindow);
    }
  }
  if (observation.activeWorkbook) {
    taskState.context.activeWorkbook = observation.activeWorkbook;
  }
}

export function recordStepStarted(taskState: TaskState, label: string) {
  taskState.progress.currentStep = String(label || "").trim();
}

export function recordStepSucceeded(taskState: TaskState, label: string) {
  const next = String(label || "").trim();
  if (next && !taskState.progress.completedSteps.includes(next)) {
    taskState.progress.completedSteps.push(next);
  }
  taskState.progress.currentStep = "";
  taskState.progress.status = "running";
  taskState.blockedReason = "";
}

export function recordStepFailed(taskState: TaskState, errorMessage: string) {
  taskState.progress.retries += 1;
  taskState.progress.status = "blocked";
  taskState.blockedReason = String(errorMessage || "").trim();
  taskState.memory.lastError = taskState.blockedReason;
}

export function recordTaskDone(taskState: TaskState) {
  taskState.progress.status = "done";
  taskState.progress.currentStep = "";
  taskState.blockedReason = "";
}

export function addCollectedItems(taskState: TaskState, items: any[]) {
  const nextItems = Array.isArray(items) ? items : [];
  let added = 0;
  for (const item of nextItems) {
    const label = String(item?.title || item?.name || "").trim().toLowerCase();
    if (!label) continue;
    const exists = taskState.memory.collectedItems.some((entry) => {
      const entryLabel = String(entry?.title || entry?.name || "").trim().toLowerCase();
      return entryLabel === label;
    });
    if (!exists) {
      taskState.memory.collectedItems.push(item);
      added += 1;
    }
  }
  taskState.memory.lastCollectionAdded = added;
}

export function addGeneratedAsset(taskState: TaskState, asset: any) {
  if (!asset) return;
  taskState.memory.generatedAssets.push(asset);
}

export function markResearchExportWritten(taskState: TaskState) {
  taskState.memory.researchExportWritten = true;
}

export function setResearchLoopAction(taskState: TaskState, action: string) {
  taskState.memory.lastResearchLoopAction = String(action || "").trim();
}
