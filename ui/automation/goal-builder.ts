import type { GoalState, TaskType } from "./task-types";

function normalize(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildGoalState(taskType: TaskType, userGoal: string): GoalState {
  const text = normalize(userGoal);

  if (taskType === "research" && text.includes("compare")) {
    return {
      objective: "Collect structured items and compare them reliably.",
      requiredOutputs: ["comparison table", "ranked summary"],
      successCriteria: [
        "At least the requested number of items is collected or the system clearly reports the available count.",
        "Each item includes structured fields such as name, price, and key distinguishing details when visible.",
        "Results stay on list/search pages until enough data is gathered."
      ]
    };
  }

  if (taskType === "marketing") {
    return {
      objective: "Create useful promotional outputs for the user's business or app.",
      requiredOutputs: ["positioning summary", "keywords or audience ideas", "promotional assets"],
      successCriteria: [
        "The system gathers or infers the business/app context.",
        "The system generates at least one usable marketing asset.",
        "If publication is requested, the system uses APIs or deterministic flows where available."
      ]
    };
  }

  if (taskType === "excel") {
    return {
      objective: "Create or update spreadsheet output reliably.",
      requiredOutputs: ["workbook change"],
      successCriteria: [
        "Excel is opened or an active workbook is targeted.",
        "Data is written to a deterministic sheet and cell range.",
        "The workbook can be saved when requested."
      ]
    };
  }

  if (taskType === "desktop") {
    return {
      objective: "Complete the Windows desktop task safely.",
      requiredOutputs: ["desktop action"],
      successCriteria: [
        "The correct app, window, or desktop surface is focused.",
        "The task uses desktop actions instead of browser actions.",
        "Risky or ambiguous steps pause for confirmation."
      ]
    };
  }

  if (taskType === "mixed") {
    return {
      objective: "Coordinate browser, desktop, Excel, and reasoning tools without drifting.",
      requiredOutputs: ["completed multi-surface workflow"],
      successCriteria: [
        "Each subtask uses the correct executor.",
        "Progress is tracked between browser and desktop contexts.",
        "The system verifies each stage before moving on."
      ]
    };
  }

  return {
    objective: "Complete the browser task with small verified steps.",
    requiredOutputs: ["browser task completion"],
    successCriteria: [
      "The correct site or page is opened.",
      "Steps are executed with deterministic browser actions.",
      "The system pauses only when blocked."
    ]
  };
}

