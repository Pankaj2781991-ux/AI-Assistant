import { buildGoalState } from "./goal-builder";
import { routeTaskType } from "./task-router";
import {
  addCollectedItems,
  addGeneratedAsset,
  markResearchExportWritten,
  setResearchLoopAction,
  createTaskState,
  recordObservation,
  recordTaskDone,
  recordStepFailed,
  recordStepStarted,
  recordStepSucceeded
} from "./task-state";
import { getToolkitGuidance } from "./toolkits";
import { shouldPauseForRepair, summarizeTaskProgress } from "./verifier";
import type { TaskState } from "./task-types";

type Observation = {
  currentUrl?: string;
  currentPageTitle?: string;
  foregroundWindow?: string;
  activeWorkbook?: string;
};

function normalize(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function createTaskOrchestrator() {
  let activeTask: TaskState | null = null;

  function ensureTask(userGoal: string) {
    const trimmed = String(userGoal || "").trim();
    if (!activeTask || activeTask.userGoal !== trimmed) {
      const taskType = routeTaskType(trimmed);
      activeTask = createTaskState(taskType, trimmed, buildGoalState(taskType, trimmed));
    }
    return activeTask;
  }

  function startTask(userGoal: string) {
    activeTask = null;
    return ensureTask(userGoal);
  }

  function observe(userGoal: string, observation: Observation) {
    const task = ensureTask(userGoal);
    recordObservation(task, observation);
    return task;
  }

  function buildPlannerAddendum(userGoal: string, observation: Observation = {}) {
    const task = observe(userGoal, observation);
    const normalizedGoal = normalize(task.userGoal);
    const extraRules: string[] = [
      `Task type: ${task.taskType}.`,
      `Goal objective: ${task.goalState.objective}`,
      `Required outputs: ${task.goalState.requiredOutputs.join(", ") || "task completion"}`,
      `Success criteria: ${task.goalState.successCriteria.join(" | ")}`,
      summarizeTaskProgress(task),
      ...getToolkitGuidance(task)
    ];

    if (task.memory.collectedItems.length) {
      const sample = task.memory.collectedItems
        .slice(0, 3)
        .map((item) => String(item?.title || item?.name || "").trim())
        .filter(Boolean)
        .join(" | ");
      extraRules.push(`Collected items so far: ${task.memory.collectedItems.length}${sample ? `. Sample: ${sample}` : ""}`);
    }
    if (task.memory.generatedAssets.length) {
      extraRules.push(`Generated assets so far: ${task.memory.generatedAssets.length}. Reuse or refine them before starting from scratch.`);
    }

    if (task.taskType === "research" && normalizedGoal.includes("compare")) {
      extraRules.push("For comparison tasks, extract structured rows and keep progress toward the requested item count.");
      extraRules.push("Do not drift into arbitrary product detail browsing before enough candidates are collected.");
      extraRules.push("Available domain tools: research_extract_listings, excel_write_range.");
    }
    if (task.taskType === "marketing") {
      extraRules.push("Focus on promotional outputs that help the user market a business, app, or service.");
      extraRules.push("Prefer generating reusable assets over exploratory clicking.");
      extraRules.push("Available domain tools: marketing_generate_assets, excel_write_range, browser_open/publication steps when explicitly needed.");
    }
    if (task.taskType === "desktop" && normalizedGoal.includes("icons")) {
      extraRules.push("Desktop icon operations are desktop actions, not browser actions.");
    }

    return extraRules.join("\n");
  }

  function onStepStarted(userGoal: string, label: string) {
    const task = ensureTask(userGoal);
    recordStepStarted(task, label);
    return task;
  }

  function onStepSucceeded(userGoal: string, label: string) {
    const task = ensureTask(userGoal);
    recordStepSucceeded(task, label);
    return task;
  }

  function onStepFailed(userGoal: string, label: string, errorMessage: string) {
    const task = ensureTask(userGoal);
    recordStepStarted(task, label);
    recordStepFailed(task, errorMessage);
    return {
      task,
      shouldPause: shouldPauseForRepair(task, errorMessage)
    };
  }

  function getActiveTask() {
    return activeTask;
  }

  function addResearchItems(userGoal: string, items: any[]) {
    const task = ensureTask(userGoal);
    addCollectedItems(task, items);
    return task;
  }

  function addMarketingAsset(userGoal: string, asset: any) {
    const task = ensureTask(userGoal);
    addGeneratedAsset(task, asset);
    return task;
  }

  function markResearchExport(userGoal: string) {
    const task = ensureTask(userGoal);
    markResearchExportWritten(task);
    return task;
  }

  function setResearchAction(userGoal: string, action: string) {
    const task = ensureTask(userGoal);
    setResearchLoopAction(task, action);
    return task;
  }

  function markDone(userGoal: string) {
    const task = ensureTask(userGoal);
    recordTaskDone(task);
    return task;
  }

  return {
    startTask,
    observe,
    buildPlannerAddendum,
    onStepStarted,
    onStepSucceeded,
    onStepFailed,
    addResearchItems,
    addMarketingAsset,
    markResearchExport,
    setResearchAction,
    markDone,
    getActiveTask
  };
}
