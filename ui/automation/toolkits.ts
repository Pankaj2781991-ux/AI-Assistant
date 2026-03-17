import type { TaskState, TaskType } from "./task-types";

const TOOLKIT_GUIDANCE: Record<TaskType, string[]> = {
  browser: [
    "Use browser actions and DOM extraction as the default path.",
    "Prefer verified search, click, type, extract, and navigation actions over generic reasoning."
  ],
  desktop: [
    "This is a Windows desktop task.",
    "Prefer desktop actions and global key sequences, not browser actions.",
    "If the task refers to desktop icons, taskbar, folders, or app windows, keep the plan in desktop space."
  ],
  excel: [
    "This is an Excel task.",
    "Prefer excel_open_workbook, excel_set_cell, excel_write_range, excel_save_workbook.",
    "If no workbook path is given, use or open a blank workbook first."
  ],
  research: [
    "This is a structured research/comparison task.",
    "Use list/search/result pages to gather structured data before opening detail pages.",
    "Prefer extraction actions and repeated collection loops over loose browsing."
  ],
  marketing: [
    "This is a digital marketing task.",
    "Follow the curated digital-marketing skill pack in skills/digital-marketing/SKILL.md.",
    "Prefer structured outputs such as positioning, audience segments, keyword clusters, messaging angles, ad copy, landing page copy, or social posts.",
    "Prepare reusable briefs and campaign plans before browser clicking.",
    "Use APIs or deterministic product flows when publication is requested; avoid raw browser clicking where an API would be better.",
    "Stop before risky final publish or confirm actions unless the user clearly asked to launch."
  ],
  mixed: [
    "This is a mixed workflow.",
    "Choose the correct executor for each subtask: browser, desktop, Excel, or structured generation.",
    "Do not express desktop or Excel actions as browser clicks."
  ]
};

export function getToolkitGuidance(taskState: TaskState): string[] {
  return TOOLKIT_GUIDANCE[taskState.taskType] || TOOLKIT_GUIDANCE.browser;
}

