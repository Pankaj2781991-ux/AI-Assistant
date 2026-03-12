export type TaskType = "browser" | "desktop" | "excel" | "research" | "marketing" | "mixed";

export type GoalState = {
  objective: string;
  requiredOutputs: string[];
  successCriteria: string[];
};

export type TaskProgressStatus = "running" | "blocked" | "done" | "failed";

export type TaskProgress = {
  completedSteps: string[];
  currentStep: string;
  retries: number;
  status: TaskProgressStatus;
};

export type TaskMemory = {
  visitedUrls: string[];
  visitedWindows: string[];
  collectedItems: any[];
  generatedAssets: any[];
  lastError: string;
  researchTargetCount: number;
  lastCollectionAdded: number;
  researchExportWritten: boolean;
  lastResearchLoopAction: string;
};

export type TaskContext = {
  currentUrl: string;
  currentPageTitle: string;
  foregroundWindow: string;
  activeWorkbook: string;
};

export type TaskState = {
  id: string;
  taskType: TaskType;
  userGoal: string;
  goalState: GoalState;
  progress: TaskProgress;
  context: TaskContext;
  memory: TaskMemory;
  blockedReason: string;
};
