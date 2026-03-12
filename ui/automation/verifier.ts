import type { TaskState } from "./task-types";

export function summarizeTaskProgress(taskState: TaskState) {
  const doneCount = taskState.progress.completedSteps.length;
  const required = taskState.goalState.requiredOutputs.join(", ") || "task output";
  const researchProgress =
    taskState.taskType === "research" && taskState.memory.researchTargetCount > 0
      ? ` Research items collected: ${taskState.memory.collectedItems.length}/${taskState.memory.researchTargetCount}.`
      : "";
  return `Task type: ${taskState.taskType}. Objective: ${taskState.goalState.objective} Completed steps: ${doneCount}. Required outputs: ${required}.${researchProgress}`;
}

export function shouldPauseForRepair(taskState: TaskState, errorMessage: string) {
  const errorText = String(errorMessage || "").toLowerCase();
  if (!errorText) return false;
  if (taskState.progress.retries >= 2) return true;
  return (
    errorText.includes("could not find") ||
    errorText.includes("no valid bbox") ||
    errorText.includes("timed out") ||
    errorText.includes("not open") ||
    errorText.includes("not active")
  );
}
