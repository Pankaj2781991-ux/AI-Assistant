{
function normalizeTaskText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function routeTaskType(userGoal) {
  const text = normalizeTaskText(userGoal);
  const looksLikeMarketing =
    text.includes("promote") ||
    text.includes("marketing") ||
    text.includes("ads") ||
    text.includes("campaign") ||
    text.includes("keywords") ||
    text.includes("seo") ||
    text.includes("landing page") ||
    text.includes("linkedin") ||
    text.includes("facebook ad") ||
    text.includes("google ad");
  const looksLikeResearch =
    text.includes("compare") ||
    text.includes("research") ||
    text.includes("find prices") ||
    text.includes("check prices") ||
    text.includes("top 10") ||
    text.includes("list ") ||
    text.includes("courses") ||
    text.includes("fridges") ||
    text.includes("products");
  const looksLikeExcel =
    text.includes("excel") ||
    text.includes("workbook") ||
    text.includes("spreadsheet") ||
    text.includes("sheet") ||
    text.includes("cell");
  const looksLikeDesktop =
    text.includes("desktop") ||
    text.includes("icons") ||
    text.includes("folder") ||
    text.includes("windows") ||
    text.includes("settings") ||
    text.includes("whatsapp") ||
    text.includes("notepad");
  const looksLikeBrowser =
    text.includes("open ") ||
    text.includes("website") ||
    text.includes("browser") ||
    text.includes("youtube") ||
    text.includes("amazon") ||
    text.includes("google") ||
    text.includes("myntra") ||
    text.includes("tradingview");

  const matched = [looksLikeMarketing, looksLikeResearch, looksLikeExcel, looksLikeDesktop, looksLikeBrowser].filter(Boolean).length;
  if (matched > 1) return "mixed";
  if (looksLikeMarketing) return "marketing";
  if (looksLikeResearch) return "research";
  if (looksLikeExcel) return "excel";
  if (looksLikeDesktop) return "desktop";
  return "browser";
}

function inferResearchTargetCount(userGoal) {
  const match = String(userGoal || "").match(/\b(\d{1,2})\b/);
  if (!match) return 5;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return 5;
  return Math.min(20, value);
}

function buildGoalState(taskType, userGoal) {
  const text = normalizeTaskText(userGoal);
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

function createTaskState(taskType, userGoal, goalState) {
  return {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    taskType,
    userGoal,
    goalState,
    progress: { completedSteps: [], currentStep: "", retries: 0, status: "running" },
    context: { currentUrl: "", currentPageTitle: "", foregroundWindow: "", activeWorkbook: "" },
    memory: {
      visitedUrls: [],
      visitedWindows: [],
      collectedItems: [],
      generatedAssets: [],
      marketingProfile: null,
      metaCampaignPlan: null,
      googleCampaignPlan: null,
      lastError: "",
      researchTargetCount: taskType === "research" ? inferResearchTargetCount(userGoal) : 0,
      lastCollectionAdded: 0,
      researchExportWritten: false,
      lastResearchLoopAction: "",
      marketingExportWritten: false
    },
    blockedReason: ""
  };
}

function createTaskOrchestrator() {
  let activeTask = null;
  function ensureTask(userGoal) {
    const trimmed = String(userGoal || "").trim();
    if (!activeTask || activeTask.userGoal !== trimmed) {
      const taskType = routeTaskType(trimmed);
      activeTask = createTaskState(taskType, trimmed, buildGoalState(taskType, trimmed));
    }
    return activeTask;
  }
  function observe(userGoal, observation: any = {}) {
    const task = ensureTask(userGoal);
    if (observation.currentUrl) {
      task.context.currentUrl = observation.currentUrl;
      if (!task.memory.visitedUrls.includes(observation.currentUrl)) task.memory.visitedUrls.push(observation.currentUrl);
    }
    if (observation.currentPageTitle) task.context.currentPageTitle = observation.currentPageTitle;
    if (observation.foregroundWindow) {
      task.context.foregroundWindow = observation.foregroundWindow;
      if (!task.memory.visitedWindows.includes(observation.foregroundWindow)) task.memory.visitedWindows.push(observation.foregroundWindow);
    }
    if (observation.activeWorkbook) task.context.activeWorkbook = observation.activeWorkbook;
    return task;
  }
  function summarizeTaskProgress(task) {
    const researchProgress =
      task.taskType === "research" && task.memory.researchTargetCount > 0
        ? ` Research items collected: ${task.memory.collectedItems.length}/${task.memory.researchTargetCount}.`
        : "";
    return `Task type: ${task.taskType}. Objective: ${task.goalState.objective} Completed steps: ${task.progress.completedSteps.length}. Required outputs: ${task.goalState.requiredOutputs.join(", ") || "task completion"}.${researchProgress}`;
  }
  function getToolkitGuidance(task) {
    const map = {
      browser: [
        "Use browser actions and DOM extraction as the default path.",
        "Prefer verified search, click, type, extract, and navigation actions over generic reasoning."
      ],
      desktop: [
        "This is a Windows desktop task.",
        "Prefer desktop actions and global key sequences, not browser actions."
      ],
      excel: [
        "This is an Excel task.",
        "Prefer excel_open_workbook, excel_set_cell, excel_write_range, excel_save_workbook."
      ],
      research: [
        "This is a structured research/comparison task.",
        "Use list/search/result pages to gather structured data before opening detail pages.",
        "Prefer extraction actions and repeated collection loops over loose browsing."
      ],
      marketing: [
        "This is a digital marketing task.",
        "Prefer structured outputs such as positioning, keywords, campaign ideas, ad copy, landing page copy, or social posts."
      ],
      mixed: [
        "This is a mixed workflow.",
        "Choose the correct executor for each subtask: browser, desktop, Excel, or structured generation."
      ]
    };
    return map[task.taskType] || map.browser;
  }
  return {
    startTask(userGoal) {
      activeTask = null;
      return ensureTask(userGoal);
    },
    observe,
    buildPlannerAddendum(userGoal, observation = {}) {
      const task = observe(userGoal, observation);
      const normalizedGoal = normalizeTaskText(task.userGoal);
      const extraRules = [
        `Task type: ${task.taskType}.`,
        `Goal objective: ${task.goalState.objective}`,
        `Required outputs: ${task.goalState.requiredOutputs.join(", ") || "task completion"}`,
        `Success criteria: ${task.goalState.successCriteria.join(" | ")}`,
        summarizeTaskProgress(task),
        ...getToolkitGuidance(task)
      ];
      if (task.memory.collectedItems.length) extraRules.push(`Collected items so far: ${task.memory.collectedItems.length}.`);
      if (task.memory.generatedAssets.length) extraRules.push(`Generated assets so far: ${task.memory.generatedAssets.length}.`);
      if (task.memory.marketingProfile) extraRules.push(`Marketing profile is available for ${task.memory.marketingProfile.brand || "the current business"}. Reuse it.`);
      if (task.memory.metaCampaignPlan) extraRules.push(`Meta campaign plan is ready for ${task.memory.metaCampaignPlan.brand || "the business"}. Use it when working in Ads Manager.`);
      if (task.memory.googleCampaignPlan) extraRules.push(`Google Ads campaign plan is ready for ${task.memory.googleCampaignPlan.brand || "the business"}. Use it when working in Google Ads.`);
      if (task.taskType === "research" && normalizedGoal.includes("compare")) {
        extraRules.push("Available domain tools: research_extract_listings, excel_write_range.");
      }
      if (task.taskType === "marketing") {
        extraRules.push("Available domain tools: marketing_analyze_website, marketing_generate_assets, marketing_prepare_meta_campaign, marketing_prepare_google_campaign, excel_write_range.");
      }
      if (task.taskType === "desktop" && normalizedGoal.includes("icons")) {
        extraRules.push("Desktop icon operations are desktop actions, not browser actions.");
      }
      return extraRules.join("\n");
    },
    onStepStarted(userGoal, label) {
      const task = ensureTask(userGoal);
      task.progress.currentStep = String(label || "").trim();
      return task;
    },
    onStepSucceeded(userGoal, label) {
      const task = ensureTask(userGoal);
      const next = String(label || "").trim();
      if (next && !task.progress.completedSteps.includes(next)) task.progress.completedSteps.push(next);
      task.progress.currentStep = "";
      task.progress.status = "running";
      task.blockedReason = "";
      return task;
    },
    onStepFailed(userGoal, label, errorMessage) {
      const task = ensureTask(userGoal);
      task.progress.currentStep = String(label || "").trim();
      task.progress.retries += 1;
      task.progress.status = "blocked";
      task.blockedReason = String(errorMessage || "").trim();
      task.memory.lastError = task.blockedReason;
      const errorText = task.blockedReason.toLowerCase();
      const shouldPause =
        task.progress.retries >= 2 ||
        errorText.includes("could not find") ||
        errorText.includes("no valid bbox") ||
        errorText.includes("timed out") ||
        errorText.includes("not open") ||
        errorText.includes("not active");
      return { task, shouldPause };
    },
    addResearchItems(userGoal, items) {
      const task = ensureTask(userGoal);
      let added = 0;
      for (const item of Array.isArray(items) ? items : []) {
        const label = String(item?.title || item?.name || "").trim().toLowerCase();
        if (!label) continue;
        const exists = task.memory.collectedItems.some((entry) => String(entry?.title || entry?.name || "").trim().toLowerCase() === label);
        if (!exists) {
          task.memory.collectedItems.push(item);
          added += 1;
        }
      }
      task.memory.lastCollectionAdded = added;
      return task;
    },
    addMarketingAsset(userGoal, asset) {
      const task = ensureTask(userGoal);
      if (asset) task.memory.generatedAssets.push(asset);
      return task;
    },
    setMarketingProfile(userGoal, profile) {
      const task = ensureTask(userGoal);
      task.memory.marketingProfile = profile || null;
      return task;
    },
    setMetaCampaignPlan(userGoal, plan) {
      const task = ensureTask(userGoal);
      task.memory.metaCampaignPlan = plan || null;
      return task;
    },
    setGoogleCampaignPlan(userGoal, plan) {
      const task = ensureTask(userGoal);
      task.memory.googleCampaignPlan = plan || null;
      return task;
    },
    markResearchExport(userGoal) {
      const task = ensureTask(userGoal);
      task.memory.researchExportWritten = true;
      return task;
    },
    markMarketingExport(userGoal) {
      const task = ensureTask(userGoal);
      task.memory.marketingExportWritten = true;
      return task;
    },
    setResearchAction(userGoal, action) {
      const task = ensureTask(userGoal);
      task.memory.lastResearchLoopAction = String(action || "").trim();
      return task;
    },
    markDone(userGoal) {
      const task = ensureTask(userGoal);
      task.progress.status = "done";
      task.progress.currentStep = "";
      task.blockedReason = "";
      return task;
    },
    getActiveTask() {
      return activeTask;
    }
  };
}

function isLikelyPrice(text) {
  return /(?:₹|rs\.?|inr|\$|€|£)\s?\d/i.test(String(text || "")) || /\b\d[\d,]{2,}\b/.test(String(text || ""));
}

function isLikelyRating(text) {
  return /\b\d(\.\d)?\s*out of\s*5\b/i.test(String(text || "")) || /\b\d(\.\d)?\s*stars?\b/i.test(String(text || "")) || /\b\d(\.\d)?\/5\b/i.test(String(text || ""));
}

function isCandidateResearchTitle(text) {
  const clean = String(text || "").trim();
  if (clean.length < 12 || clean.length > 180) return false;
  const normalized = normalizeTaskText(clean);
  if (!normalized) return false;
  if (normalized.includes("sponsored") || normalized.includes("delivery") || normalized.includes("add to cart")) return false;
  if (isLikelyPrice(clean) || isLikelyRating(clean)) return false;
  return /[a-z]/i.test(clean);
}

function extractVisibleResearchItems(domElements, currentUrl, userGoal) {
  const elements = Array.isArray(domElements) ? domElements : [];
  const titles = elements.filter((el) => isCandidateResearchTitle(String(el?.text || "")));
  const items = titles
    .map((titleEl) => {
      const y = Number(titleEl?.bbox?.y || 0);
      const x = Number(titleEl?.bbox?.x || 0);
      let price = "";
      let rating = "";
      for (const el of elements) {
        const text = String(el?.text || "").trim();
        if (!text) continue;
        const otherY = Number(el?.bbox?.y || 0);
        const otherX = Number(el?.bbox?.x || 0);
        if (Math.abs(y - otherY) > 0.08 || Math.abs(x - otherX) > 0.22) continue;
        if (!price && isLikelyPrice(text)) price = text;
        if (!rating && isLikelyRating(text)) rating = text;
      }
      return { title: String(titleEl?.text || "").trim(), price, rating, sourceUrl: currentUrl };
    })
    .filter((item) => item.title)
    .slice(0, 20);
  const summary = items.length
    ? `Extracted ${items.length} visible research candidates from the current page.`
    : `No structured research candidates were found yet for "${userGoal}".`;
  return { items, summary };
}

function getRequestedResearchCount(userGoal) {
  return inferResearchTargetCount(userGoal);
}

function hasVisibleResearchListings(domElements) {
  const elements = Array.isArray(domElements) ? domElements : [];
  return elements.filter((el) => isCandidateResearchTitle(String(el?.text || ""))).length >= 3;
}

function buildResearchExcelRows(items) {
  const rows = [["Title", "Price", "Rating", "Source URL"]];
  for (const item of Array.isArray(items) ? items : []) {
    rows.push([
      String(item?.title || "").trim(),
      String(item?.price || "").trim(),
      String(item?.rating || "").trim(),
      String(item?.sourceUrl || "").trim()
    ]);
  }
  return rows;
}

function uniqueText(values) {
  const seen = new Set();
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const next = String(value || "").trim();
    if (!next) continue;
    const key = next.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  return out;
}

function inferKeywordIdeas(profile, userGoal) {
  const source = uniqueText([
    ...(Array.isArray(profile?.headlines) ? profile.headlines : []),
    profile?.brand || "",
    profile?.offer || "",
    userGoal || ""
  ]);
  const tokens = [];
  for (const text of source) {
    for (const token of normalizeTaskText(text).split(" ")) {
      if (!token || token.length < 4) continue;
      if (["with", "from", "that", "your", "have", "this", "book", "free", "best"].includes(token)) continue;
      tokens.push(token);
    }
  }
  return uniqueText(tokens).slice(0, 12);
}

function inferMessagingAngles(profile) {
  const angles = [];
  if (profile?.offer) angles.push(`Promote the core offer: ${profile.offer}`);
  if (Array.isArray(profile?.ctas) && profile.ctas.length) angles.push(`Lean into the CTA intent: ${profile.ctas[0]}`);
  if (Array.isArray(profile?.audienceHints) && profile.audienceHints.length) angles.push(`Speak directly to ${profile.audienceHints[0]}`);
  if (Array.isArray(profile?.pricingHints) && profile.pricingHints.length) angles.push(`Use pricing clarity as a trust signal: ${profile.pricingHints[0]}`);
  if (!angles.length) angles.push("Focus on the clearest product benefit visible on the website.");
  return uniqueText(angles).slice(0, 6);
}

function analyzeMarketingWebsite(domElements, currentUrl, currentPageTitle, userGoal) {
  const elements = Array.isArray(domElements) ? domElements : [];
  const texts = uniqueText(elements.map((el) => String(el?.text || "").trim()).filter(Boolean));
  const headlines = texts.filter((text) => text.length >= 18 && text.length <= 120).slice(0, 6);
  const ctas = texts.filter((text) => /^(sign up|get started|book|start|contact|buy|try|download|join|request demo)/i.test(text)).slice(0, 6);
  const pricingHints = texts.filter((text) => /(?:₹|rs\.?|inr|\$|€|£)\s?\d/i.test(text) || /\bfree trial\b/i.test(text)).slice(0, 6);
  const audienceHints = texts.filter((text) => /\b(for|built for|made for|helps|helping)\b/i.test(text)).slice(0, 6);
  let brand = "";
  try {
    const host = currentUrl ? new URL(currentUrl).hostname.replace(/^www\./i, "") : "";
    brand = host ? host.split(".")[0] : "";
  } catch (_error) {
    brand = "";
  }
  if (!brand && currentPageTitle) {
    brand = String(currentPageTitle).split("|")[0].split("-")[0].trim();
  }
  const offer = headlines[0] || currentPageTitle || userGoal;
  const profile = {
    type: "website_profile",
    brand: brand || "Website",
    url: currentUrl || "",
    pageTitle: currentPageTitle || "",
    offer,
    headlines,
    ctas,
    pricingHints,
    audienceHints,
    keywordIdeas: inferKeywordIdeas({ brand, offer, headlines }, userGoal),
    messagingAngles: inferMessagingAngles({ offer, ctas, audienceHints, pricingHints })
  };
  return {
    profile,
    summary: `Analyzed website profile for ${profile.brand}.`
  };
}

function buildChannelAssetPacks(channel, profile, keywordIdeas, messagingAngles, userGoal) {
  const brand = profile?.brand || "Brand";
  const offer = profile?.offer || userGoal;
  if (channel === "Google") {
    return [
      {
        channel,
        campaignType: "Google Ad Set",
        variant: "Search Intent",
        headline1: `${brand} ${keywordIdeas[0] || "solution"}`.trim().slice(0, 30),
        headline2: `${offer}`.trim().slice(0, 30),
        headline3: `${messagingAngles[0] || "Get started today"}`.trim().slice(0, 30),
        primaryText: `Discover ${brand}. ${messagingAngles[0] || offer}`.slice(0, 90),
        cta: profile?.ctas?.[0] || "Get Started"
      },
      {
        channel,
        campaignType: "Google Ad Set",
        variant: "Problem Solution",
        headline1: `${brand} solves ${keywordIdeas[1] || keywordIdeas[0] || "growth"}`.trim().slice(0, 30),
        headline2: `${messagingAngles[1] || offer}`.trim().slice(0, 30),
        headline3: `Try ${brand} today`.trim().slice(0, 30),
        primaryText: `${offer}. ${messagingAngles[1] || "Designed to turn searchers into users."}`.slice(0, 90),
        cta: profile?.ctas?.[0] || "Start Now"
      },
      {
        channel,
        campaignType: "Google Ad Set",
        variant: "Trust Signal",
        headline1: `${brand} ${pricingHintsOrKeyword(profile, keywordIdeas)}`.trim().slice(0, 30),
        headline2: `${offer}`.trim().slice(0, 30),
        headline3: `${profile?.ctas?.[0] || "See how it works"}`.trim().slice(0, 30),
        primaryText: `${brand} helps you ${keywordIdeas[0] || "grow"}. ${messagingAngles[2] || "Clear value, fast action."}`.slice(0, 90),
        cta: profile?.ctas?.[0] || "Learn More"
      }
    ];
  }
  if (channel === "Meta") {
    return [
      {
        channel,
        campaignType: "Meta Ad Set",
        variant: "Awareness",
        headline1: `${brand} for faster growth`.slice(0, 40),
        headline2: `${keywordIdeas[0] || offer}`.slice(0, 40),
        headline3: `${messagingAngles[0] || "See how it works"}`.slice(0, 40),
        primaryText: `${offer}. ${messagingAngles[0] || "Turn interest into action."}`.slice(0, 125),
        cta: profile?.ctas?.[0] || "Learn More"
      },
      {
        channel,
        campaignType: "Meta Ad Set",
        variant: "Conversion",
        headline1: `${brand} that converts`.slice(0, 40),
        headline2: `${messagingAngles[1] || offer}`.slice(0, 40),
        headline3: `${keywordIdeas[1] || "Better campaigns"}`.slice(0, 40),
        primaryText: `${brand} helps you move from interest to action. ${messagingAngles[1] || offer}`.slice(0, 125),
        cta: profile?.ctas?.[0] || "Get Started"
      },
      {
        channel,
        campaignType: "Meta Ad Set",
        variant: "Offer",
        headline1: `${brand} ${pricingHintsOrKeyword(profile, keywordIdeas)}`.slice(0, 40),
        headline2: `${offer}`.slice(0, 40),
        headline3: `${profile?.ctas?.[0] || "Try it now"}`.slice(0, 40),
        primaryText: `${offer}. ${messagingAngles[2] || "Simple message, clear action, stronger response."}`.slice(0, 125),
        cta: profile?.ctas?.[0] || "Learn More"
      }
    ];
  }
  return [
    {
      channel,
      campaignType: "LinkedIn Post Pack",
      variant: "Thought Leadership",
      headline1: `${brand}: ${offer}`.slice(0, 60),
      headline2: `${messagingAngles[0] || "Why this matters now"}`.slice(0, 60),
      headline3: `${keywordIdeas[0] || "Growth"} ideas`.slice(0, 60),
      primaryText: `${offer}. ${messagingAngles[0] || "Useful for teams that want better results."}`,
      cta: profile?.ctas?.[0] || "Learn More"
    },
    {
      channel,
      campaignType: "LinkedIn Post Pack",
      variant: "Problem Insight",
      headline1: `${brand} on ${keywordIdeas[0] || "growth"}`.slice(0, 60),
      headline2: `${messagingAngles[1] || "Common bottleneck"}`.slice(0, 60),
      headline3: `${offer}`.slice(0, 60),
      primaryText: `A simple way to talk about ${offer}: ${messagingAngles[1] || "frame the pain clearly, then show the outcome."}`,
      cta: profile?.ctas?.[0] || "Read More"
    },
    {
      channel,
      campaignType: "LinkedIn Post Pack",
      variant: "CTA Post",
      headline1: `${profile?.ctas?.[0] || "Get started"} with ${brand}`.slice(0, 60),
      headline2: `${offer}`.slice(0, 60),
      headline3: `${keywordIdeas[1] || "Practical ideas"}`.slice(0, 60),
      primaryText: `${offer}. ${messagingAngles[2] || "Clear positioning paired with a direct CTA works better than vague promotion."}`,
      cta: profile?.ctas?.[0] || "Learn More"
    }
  ];
}

function pricingHintsOrKeyword(profile, keywordIdeas) {
  return String(profile?.pricingHints?.[0] || keywordIdeas[2] || keywordIdeas[0] || "offer").slice(0, 20);
}

function buildMarketingExcelRows(assets) {
  const rows = [["Channel", "Campaign Type", "Variant", "Headline 1", "Headline 2", "Headline 3", "Primary Text", "CTA"]];
  for (const asset of Array.isArray(assets) ? assets : []) {
    if (Array.isArray(asset?.channelPacks)) {
      for (const pack of asset.channelPacks) {
        rows.push([
          String(pack?.channel || ""),
          String(pack?.campaignType || ""),
          String(pack?.variant || ""),
          String(pack?.headline1 || ""),
          String(pack?.headline2 || ""),
          String(pack?.headline3 || ""),
          String(pack?.primaryText || ""),
          String(pack?.cta || "")
        ]);
      }
    }
  }
  return rows;
}

function isMetaAdsTask(userGoal) {
  const text = normalizeTaskText(userGoal);
  return (
    text.includes("facebook ad") ||
    text.includes("meta ad") ||
    text.includes("meta ads") ||
    text.includes("facebook ads") ||
    text.includes("ads manager") ||
    (text.includes("run ad") && (text.includes("facebook") || text.includes("meta")))
  );
}

function isGoogleAdsTask(userGoal) {
  const text = normalizeTaskText(userGoal);
  return (
    text.includes("google ad") ||
    text.includes("google ads") ||
    text.includes("ads.google.com") ||
    text.includes("search ad") ||
    (text.includes("run ad") && text.includes("google"))
  );
}

function buildMetaCampaignPlan(userGoal, taskState) {
  const profile = taskState?.memory?.marketingProfile || {};
  const latestAsset = Array.isArray(taskState?.memory?.generatedAssets) ? taskState.memory.generatedAssets[taskState.memory.generatedAssets.length - 1] : null;
  const metaPack = Array.isArray(latestAsset?.channelPacks)
    ? latestAsset.channelPacks.find((pack) => String(pack?.channel || "").toLowerCase() === "meta") || latestAsset.channelPacks[0]
    : null;
  const keywordIdeas = Array.isArray(latestAsset?.keywordIdeas) ? latestAsset.keywordIdeas : inferKeywordIdeas(profile, userGoal);
  const messagingAngles = Array.isArray(latestAsset?.messagingAngles) ? latestAsset.messagingAngles : inferMessagingAngles(profile);
  const normalizedGoal = normalizeTaskText(userGoal);
  const objective = normalizedGoal.includes("lead") ? "Leads" : normalizedGoal.includes("traffic") ? "Traffic" : "Sales";
  const budget = normalizedGoal.match(/\b(\d{2,5})\b/) ? `₹${normalizedGoal.match(/\b(\d{2,5})\b/)[1]}/day` : "₹500/day";
  const plan = {
    platform: "Meta Ads",
    brand: profile?.brand || "Business",
    objective,
    budget,
    audience: [
      profile?.audienceHints?.[0] || "People likely to benefit from the offer",
      keywordIdeas[0] || "Relevant interest cluster",
      keywordIdeas[1] || "Core demand signal"
    ].filter(Boolean),
    placements: ["Facebook Feed", "Instagram Feed", "Stories"],
    pageRequirement: "Select an existing Facebook Page or create one before publishing.",
    creative: {
      headline1: metaPack?.headline1 || `${profile?.brand || "Brand"} for faster growth`,
      headline2: metaPack?.headline2 || (profile?.offer || userGoal),
      headline3: metaPack?.headline3 || (messagingAngles[0] || "See how it works"),
      primaryText: metaPack?.primaryText || `${profile?.offer || userGoal}. ${messagingAngles[0] || "Turn interest into action."}`,
      cta: metaPack?.cta || profile?.ctas?.[0] || "Learn More"
    }
  };
  return {
    plan,
    summary: `Prepared Meta campaign plan for ${plan.brand} with objective ${plan.objective}.`
  };
}

function buildGoogleCampaignPlan(userGoal, taskState) {
  const profile = taskState?.memory?.marketingProfile || {};
  const latestAsset = Array.isArray(taskState?.memory?.generatedAssets) ? taskState.memory.generatedAssets[taskState.memory.generatedAssets.length - 1] : null;
  const googlePacks = Array.isArray(latestAsset?.channelPacks)
    ? latestAsset.channelPacks.filter((pack) => String(pack?.channel || "").toLowerCase() === "google")
    : [];
  const primaryPack = googlePacks[0] || latestAsset?.channelPacks?.[0] || null;
  const keywordIdeas = Array.isArray(latestAsset?.keywordIdeas) ? latestAsset.keywordIdeas : inferKeywordIdeas(profile, userGoal);
  const messagingAngles = Array.isArray(latestAsset?.messagingAngles) ? latestAsset.messagingAngles : inferMessagingAngles(profile);
  const normalizedGoal = normalizeTaskText(userGoal);
  const objective = normalizedGoal.includes("lead") ? "Leads" : normalizedGoal.includes("traffic") ? "Website traffic" : "Sales";
  const budgetMatch = normalizedGoal.match(/\b(\d{2,5})\b/);
  const budget = budgetMatch ? `Rs${budgetMatch[1]}/day` : "Rs1000/day";
  const descriptions = googlePacks
    .map((pack) => String(pack?.primaryText || "").trim())
    .filter(Boolean)
    .slice(0, 4);
  while (descriptions.length < 2) {
    descriptions.push(`${profile?.offer || userGoal}. ${messagingAngles[0] || "Drive qualified intent."}`);
  }
  const plan = {
    platform: "Google Ads",
    brand: profile?.brand || "Business",
    objective,
    budget,
    keywordThemes: keywordIdeas.slice(0, 8),
    audienceIntent: profile?.audienceHints?.[0] || "High-intent users searching for a solution",
    landingPageUrl: taskState?.context?.currentUrl || "",
    conversionHint: profile?.ctas?.[0] || "Lead form or primary website conversion",
    ad: {
      headline1: primaryPack?.headline1 || `${profile?.brand || "Brand"} for faster growth`,
      headline2: primaryPack?.headline2 || (profile?.offer || userGoal),
      headline3: primaryPack?.headline3 || (messagingAngles[0] || "See pricing and features"),
      description1: descriptions[0],
      description2: descriptions[1],
      cta: primaryPack?.cta || profile?.ctas?.[0] || "Learn More"
    }
  };
  return {
    plan,
    summary: `Prepared Google Ads campaign plan for ${plan.brand} with objective ${plan.objective}.`
  };
}

function generateMarketingAssetDraft(userGoal, taskState) {
  const text = normalizeTaskText(userGoal);
  const channels = [];
  if (text.includes("google") || text.includes("search") || text.includes("seo")) channels.push("Google");
  if (text.includes("facebook") || text.includes("instagram") || text.includes("meta")) channels.push("Meta");
  if (text.includes("linkedin")) channels.push("LinkedIn");
  if (!channels.length) channels.push("Google", "LinkedIn", "Meta");
  const profile = taskState?.memory?.marketingProfile || null;
  const keywordIdeas = uniqueText([...(Array.isArray(profile?.keywordIdeas) ? profile.keywordIdeas : []), ...inferKeywordIdeas(profile || {}, userGoal)]).slice(0, 12);
  const messagingAngles = uniqueText([...(Array.isArray(profile?.messagingAngles) ? profile.messagingAngles : []), ...inferMessagingAngles(profile || {})]).slice(0, 6);
  const asset = {
    type: "campaign_brief",
    title: "Draft Campaign Brief",
    goal: userGoal,
    positioning: profile?.offer || "Promote the user's business or app with clear value and simple next-step messaging.",
    channels,
    brand: profile?.brand || "",
    keywordIdeas,
    messagingAngles,
    channelPacks: channels.flatMap((channel) => buildChannelAssetPacks(channel, profile || {}, keywordIdeas, messagingAngles, userGoal)),
    deliverables: ["Audience summary", "Keyword or topic ideas", "Ad copy angles", "Social post starters", "Landing page messaging"],
    context: {
      currentUrl: taskState?.context?.currentUrl || "",
      currentPageTitle: taskState?.context?.currentPageTitle || ""
    }
  };
  return {
    asset,
    summary: `Generated a reusable marketing draft for ${channels.join(", ")}.`
  };
}

function observeAutomationState(taskState, input: any = {}) {
  const task = taskState || {};
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

function evaluateAutomationProgress(taskState, step, observation) {
  if (!taskState) return { status: "continue", message: "No active task state. Continuing." };
  const action = String(step?.action || "").toLowerCase();
  if (taskState.taskType === "research") {
    if (observation.researchExportWritten) {
      return { status: "done", message: "Research collection completed and exported to Excel." };
    }
    if (action === "research_extract_listings") {
      const added = Number(taskState.memory.lastCollectionAdded || 0);
      if (added > 0) {
        return { status: "continue", message: `Collected ${observation.collectedCount}/${observation.researchTargetCount || observation.collectedCount} research items.` };
      }
      if (observation.hasVisibleResearchListings) {
        return { status: "retry", message: "No new items were collected from the current visible listings. Try a different collection move." };
      }
    }
    if (action === "excel_write_range") {
      return { status: "done", message: "Research comparison rows were written to Excel." };
    }
  }
  if (taskState.taskType === "marketing" && action === "marketing_analyze_website") {
    if (taskState?.memory?.marketingProfile) {
      return { status: "continue", message: `Website profile captured for ${taskState.memory.marketingProfile.brand || "the current business"}.` };
    }
  }
  if (taskState.taskType === "marketing" && action === "marketing_prepare_meta_campaign") {
    if (taskState?.memory?.metaCampaignPlan) {
      return { status: "continue", message: `Meta campaign plan prepared for ${taskState.memory.metaCampaignPlan.brand || "the business"}.` };
    }
  }
  if (taskState.taskType === "marketing" && action === "marketing_prepare_google_campaign") {
    if (taskState?.memory?.googleCampaignPlan) {
      return { status: "continue", message: `Google Ads campaign plan prepared for ${taskState.memory.googleCampaignPlan.brand || "the business"}.` };
    }
  }
  if (taskState.taskType === "marketing" && action === "marketing_generate_assets") {
    if (observation.generatedAssetCount > 0) return { status: "continue", message: "Marketing assets were generated. Preparing export." };
  }
  if (taskState.taskType === "marketing" && action === "excel_write_range") {
    if (taskState?.memory?.marketingExportWritten) return { status: "done", message: "Marketing asset packs were written to Excel." };
  }
  if (action === "open_url" && !observation.currentUrl) {
    return { status: "retry", message: "Navigation did not produce a visible page URL yet." };
  }
  return { status: "continue", message: "Step made acceptable progress." };
}

const captureStatus = document.getElementById("captureStatus") as HTMLElement;
const preview = document.getElementById("preview") as HTMLImageElement;
const question = document.getElementById("question") as HTMLTextAreaElement;
const analyzeBtn = document.getElementById("analyzeBtn") as HTMLButtonElement;
const toggleOnScreenBtn = document.getElementById("toggleOnScreenBtn") as HTMLButtonElement;
const sendBtn = document.getElementById("sendBtn") as HTMLButtonElement;
const stepNav = document.getElementById("stepNav") as HTMLElement;
const prevStepBtn = document.getElementById("prevStepBtn") as HTMLButtonElement;
const nextStepBtn = document.getElementById("nextStepBtn") as HTMLButtonElement;
const stepNavLabel = document.getElementById("stepNavLabel") as HTMLElement;
const response = document.getElementById("response") as HTMLElement;
const closeBtn = document.getElementById("closeBtn") as HTMLButtonElement;
const providerEl = document.getElementById("provider") as HTMLSelectElement;
const apiKeyEl = document.getElementById("apiKey") as HTMLInputElement;
const saveKeyBtn = document.getElementById("saveKeyBtn") as HTMLButtonElement;
const checkUpdateBtn = document.getElementById("checkUpdateBtn") as HTMLButtonElement | null;
const installUpdateBtn = document.getElementById("installUpdateBtn") as HTMLButtonElement | null;
const updateStatusEl = document.getElementById("updateStatus") as HTMLElement | null;
const captureAgainBtn = document.getElementById("captureAgainBtn") as HTMLButtonElement;
const settingsPanel = document.getElementById("settingsPanel") as HTMLElement;
const capturePanel = document.getElementById("capturePanel") as HTMLElement;
const toggleSettingsBtn = document.getElementById("toggleSettingsBtn") as HTMLButtonElement;
const toggleCaptureBtn = document.getElementById("toggleCaptureBtn") as HTMLButtonElement;
const startDiyBtn = document.getElementById("startDiyBtn") as HTMLButtonElement;
const stopDiyBtn = document.getElementById("stopDiyBtn") as HTMLButtonElement;
const startAutoBtn = document.getElementById("startAutoBtn") as HTMLButtonElement | null;
const stopAutoToolbarBtn = document.getElementById("stopAutoToolbarBtn") as HTMLButtonElement | null;
const stopAutoBtn = document.getElementById("stopAutoBtn") as HTMLButtonElement;
type Dict = Record<string, any>;

let latestScreenshot = null;
let latestCaptureMeta = null;
let latestGuidance = null;
let latestOcrElements = [];
let latestUiTreeElements = [];
let latestDomElements = [];
let lastPrimaryQuestion = "";
let currentStepIndex = 0;
let latestOverlaySteps = [];
let lastResolvedRegion = null;

let operationInFlight = false;
let onScreenPromptsEnabled = false;
let manualCommandLoopRunning = false;
let queuedManualCommand = null;

let diyModeEnabled = false;
let diyTimer = null;
let diyInFlight = false;
let autoModeEnabled = false;
let autoTimer = null;
let autoInFlight = false;
let pendingManualStep = null;
let automationActivityLog: string[] = [];
let taskConstraints = [];
let lastDiySignature = "";
let diyUnchangedStreak = 0;
let diyChangeBurstTicks = 0;
const MAX_AI_IMAGE_EDGE = 1600;
const AI_IMAGE_QUALITY = 0.82;
const STEP_CONFIDENCE_MIN = 0.78;
const MAX_OVERLAY_STEPS = 12;
const OCR_CACHE_MAX = 20;
const ANALYZE_CACHE_MAX = 30;
const DOM_RECENT_MS = 10000;
const DOM_FAST_PATH_MIN = 18;
const OCR_MAX_ELEMENTS = 320;
const UI_TREE_MAX_ELEMENTS = 260;
const DOM_MAX_ELEMENTS = 550;
const DIY_FAST_AI_IMAGE_EDGE = 1152;
const DIY_FAST_AI_IMAGE_QUALITY = 0.72;
const DIY_OCR_MAX_ELEMENTS = 220;
const DIY_IDLE_DELAY_MS = 700;
const DIY_ACTIVE_DELAY_MS = 250;
const DIY_ERROR_DELAY_MS = 1200;
const DIY_BURST_DELAY_MS = 140;
const DIY_BURST_MAX_TICKS = 3;
const DIY_MAX_IDLE_DELAY_MS = 1600;
const AUTO_DELAY_MS = 250;
const OVERLAY_HIDDEN_KEY = "__hidden__";
const ocrExtractionCache = new Map();
const analyzeResultCache = new Map();
let lastOverlayRenderKey = OVERLAY_HIDDEN_KEY;
const taskOrchestrator = createTaskOrchestrator();

async function withOperationLock(work) {
  if (operationInFlight) {
    throw new Error("Another operation is already in progress.");
  }
  operationInFlight = true;
  setActionButtonsEnabled(false, { allowSubmitWhileBusy: true });
  try {
    return await work();
  } finally {
    operationInFlight = false;
    setActionButtonsEnabled(true);
  }
}

function getQuickHelpText() {
  return [
    "Browser automation is the default mode.",
    "Type one browser task and press Run.",
    "Example: play Beatles on YouTube.",
    "You will see live automation status here instead of the internal plan.",
    "The app plans from browser DOM and page state, then executes safe browser steps automatically.",
    "Stop halts the current browser automation loop immediately.",
    "If automation gets stuck, it will pause and ask you to complete the blocked step manually."
  ].join("\n");
}

function resetAutomationActivity(initialMessage = "") {
  automationActivityLog = initialMessage ? [initialMessage] : [];
}

function appendAutomationStatus(message) {
  const text = String(message || "").trim();
  if (!text) {
    return;
  }
  const last = automationActivityLog[automationActivityLog.length - 1] || "";
  if (last === text) {
    return;
  }
  automationActivityLog.push(text);
  automationActivityLog = automationActivityLog.slice(-10);
}

function renderAutomationActivity(extraMessage = "") {
  response.innerHTML = "";
  const summary = document.createElement("div");
  summary.className = "response-summary";
  summary.textContent = extraMessage || automationActivityLog[automationActivityLog.length - 1] || "Automation idle.";
  response.appendChild(summary);

  if (!automationActivityLog.length) {
    return;
  }

  const feed = document.createElement("div");
  feed.className = "activity-feed";
  feed.textContent = automationActivityLog.map((line) => `- ${line}`).join("\n");
  response.appendChild(feed);
}

function parseTaskConstraints(taskText) {
  const raw = String(taskText || "");
  const normalized = normalizeForMatch(raw);
  const constraints = [];
  const looksLikeShoppingTask =
    normalized.includes("buy") ||
    normalized.includes("shop") ||
    normalized.includes("myntra") ||
    normalized.includes("amazon") ||
    normalized.includes("flipkart") ||
    normalized.includes("delivery") ||
    normalized.includes("pincode") ||
    normalized.includes("size") ||
    normalized.includes("cart");
  const looksLikeChartTask =
    normalized.includes("tradingview") ||
    normalized.includes("chart") ||
    normalized.includes("futures") ||
    normalized.includes("bank nifty") ||
    normalized.includes("candles") ||
    normalized.includes("timeframe");

  const sizeMatch = looksLikeShoppingTask ? raw.match(/\bsize\s*(\d{1,3})\b|\b(\d{2,3})\s*size\b/i) : null;
  if (sizeMatch && !looksLikeChartTask) {
    constraints.push({ key: "size", label: `Size ${sizeMatch[1] || sizeMatch[2]}` });
  }
  const pincodeMatch = looksLikeShoppingTask ? raw.match(/\bpin(?:\s*code)?\s*(?:is|:)?\s*(\d{6})\b/i) : null;
  if (pincodeMatch) {
    constraints.push({ key: "pincode", label: `Pincode ${pincodeMatch[1]}` });
  }
  const minuteMatch = raw.match(/(\d{1,3})\s*minutes?/i);
  if (minuteMatch && looksLikeShoppingTask && !looksLikeChartTask && normalized.includes("delivery")) {
    constraints.push({ key: "delivery_time", label: `Delivery within ${minuteMatch[1]} minutes` });
  }
  if (looksLikeShoppingTask && normalized.includes("men")) constraints.push({ key: "gender", label: "Men" });
  if (looksLikeShoppingTask && normalized.includes("women")) constraints.push({ key: "gender", label: "Women" });
  if (looksLikeShoppingTask && normalized.includes("jeans")) constraints.push({ key: "product", label: "Jeans" });
  if (looksLikeChartTask && normalized.includes("1 minute")) constraints.push({ key: "timeframe", label: "1 minute timeframe" });
  if (looksLikeChartTask && normalized.includes("bank nifty")) constraints.push({ key: "instrument", label: "Bank Nifty futures" });

  const seen = new Set();
  return constraints.filter((item) => {
    if (seen.has(item.label)) return false;
    seen.add(item.label);
    return true;
  });
}

function getUnresolvedConstraints(domElements, currentUrl) {
  const corpus = normalizeForMatch(
    [
      currentUrl || "",
      ...(Array.isArray(domElements) ? domElements.map((el) => String(el?.text || "")) : [])
    ].join(" ")
  );
  return taskConstraints.filter((constraint) => {
    const label = normalizeForMatch(constraint.label);
    if (constraint.key === "delivery_time") {
      return !(corpus.includes("30 minutes") || corpus.includes("30 min") || corpus.includes("quick delivery"));
    }
    return !corpus.includes(label);
  });
}

function isShoppingTaskConstraint(constraint) {
  return ["product", "gender", "size", "pincode", "delivery_time"].includes(String(constraint?.key || ""));
}

function canCheckDeliveryConstraints(domElements, currentUrl) {
  const corpus = normalizeForMatch(
    [
      currentUrl || "",
      ...(Array.isArray(domElements) ? domElements.map((el) => String(el?.text || "")) : [])
    ].join(" ")
  );
  return (
    corpus.includes("deliver to") ||
    corpus.includes("delivery") ||
    corpus.includes("check delivery") ||
    corpus.includes("enter pincode") ||
    corpus.includes("pin code") ||
    corpus.includes("pincode") ||
    corpus.includes("estimated delivery") ||
    corpus.includes("select size")
  );
}

function splitActiveAndDeferredConstraints(domElements, currentUrl) {
  const active = [];
  const deferred = [];
  const deliveryUiVisible = canCheckDeliveryConstraints(domElements, currentUrl);
  for (const constraint of taskConstraints) {
    if (
      isShoppingTaskConstraint(constraint) &&
      (constraint.key === "pincode" || constraint.key === "delivery_time") &&
      !deliveryUiVisible
    ) {
      deferred.push(constraint);
      continue;
    }
    active.push(constraint);
  }
  return { active, deferred };
}

function getPlannerConstraintState(domElements, currentUrl) {
  const split = splitActiveAndDeferredConstraints(domElements, currentUrl);
  const corpus = normalizeForMatch(
    [
      currentUrl || "",
      ...(Array.isArray(domElements) ? domElements.map((el) => String(el?.text || "")) : [])
    ].join(" ")
  );
  const unresolvedActive = split.active.filter((constraint) => {
    const label = normalizeForMatch(constraint.label);
    if (constraint.key === "delivery_time") {
      return !(corpus.includes("30 minutes") || corpus.includes("30 min") || corpus.includes("quick delivery"));
    }
    return !corpus.includes(label);
  });
  return {
    unresolvedActive,
    deferred: split.deferred,
    deliveryUiVisible: canCheckDeliveryConstraints(domElements, currentUrl)
  };
}

function isBrowserRunnableStep(step) {
  const action = String(step?.action || "").toLowerCase();
  return action === "open_url" || action === "click" || action === "double_click" || action === "type" || action === "scroll";
}

function isDesktopRunnableStep(step) {
  const action = String(step?.action || "").toLowerCase();
  return action === "desktop_launch_app" || action === "desktop_open_path" || action === "desktop_focus_window";
}

function isExcelRunnableStep(step) {
  const action = String(step?.action || "").toLowerCase();
  return (
    action === "excel_open_workbook" ||
    action === "excel_read_range" ||
    action === "excel_set_cell" ||
    action === "excel_write_range" ||
    action === "excel_save_workbook" ||
    action === "excel_close_workbook"
  );
}

function isDomainRunnableStep(step) {
  const action = String(step?.action || "").toLowerCase();
  return (
    action === "research_extract_listings" ||
    action === "marketing_analyze_website" ||
    action === "marketing_generate_assets" ||
    action === "marketing_prepare_meta_campaign" ||
    action === "marketing_prepare_google_campaign"
  );
}

function isAutoExecutableStep(step) {
  return isBrowserRunnableStep(step) || isDesktopRunnableStep(step) || isExcelRunnableStep(step) || isDomainRunnableStep(step);
}

function getBrowserStepLabel(step) {
  const action = String(step?.action || "").toLowerCase();
  if (action === "open_url") return "Open in Browser";
  if (action === "type") return "Type in Browser";
  if (action === "double_click") return "Double-click";
  if (action === "scroll") return "Scroll Browser";
  if (action === "desktop_launch_app") return "Launch App";
  if (action === "desktop_open_path") return "Open File";
  if (action === "desktop_focus_window") return "Focus Window";
  if (action === "excel_open_workbook") return "Open Workbook";
  if (action === "excel_set_cell") return "Write Cell";
  if (action === "excel_write_range") return "Write Range";
  if (action === "excel_save_workbook") return "Save Workbook";
  if (action === "research_extract_listings") return "Extract Listings";
  if (action === "marketing_analyze_website") return "Analyze Website";
  if (action === "marketing_generate_assets") return "Generate Marketing Assets";
  if (action === "marketing_prepare_meta_campaign") return "Prepare Meta Campaign";
  if (action === "marketing_prepare_google_campaign") return "Prepare Google Campaign";
  return "Run in Browser";
}

async function refreshBrowserPreview() {
  if (isPanelHidden(capturePanel)) {
    return null;
  }
  try {
    const capture = await window.panelApi.captureBrowserPage();
    latestScreenshot = capture?.dataUrl || null;
    latestCaptureMeta = capture?.captureMeta || null;
    if (latestScreenshot) {
      preview.src = latestScreenshot;
      captureStatus.textContent = "Browser page captured.";
    }
    return capture;
  } catch (error) {
    latestScreenshot = null;
    latestCaptureMeta = null;
    preview.removeAttribute("src");
    throw error;
  }
}

async function captureCurrentScreen() {
  return window.panelApi.captureScreen();
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode screenshot."));
    img.src = dataUrl;
  });
}

async function prepareScreenshotForAi(dataUrl: string, options: { maxEdge?: number; jpegQuality?: number } = {}) {
  if (!dataUrl) {
    throw new Error("No screenshot available.");
  }
  const maxEdge = Number(options.maxEdge) > 0 ? Number(options.maxEdge) : MAX_AI_IMAGE_EDGE;
  const jpegQuality =
    Number(options.jpegQuality) >= 0 && Number(options.jpegQuality) <= 1
      ? Number(options.jpegQuality)
      : AI_IMAGE_QUALITY;
  const img = await loadImageFromDataUrl(dataUrl);
  const longEdge = Math.max(img.width, img.height);
  if (longEdge <= maxEdge) {
    return dataUrl;
  }

  const scale = maxEdge / longEdge;
  const targetW = Math.max(1, Math.round(img.width * scale));
  const targetH = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, targetW, targetH);
  return canvas.toDataURL("image/jpeg", jpegQuality);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(a, b) {
  const s = normalizeForMatch(a);
  const t = normalizeForMatch(b);
  const m = s.length;
  const n = t.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function fuzzySimilarity(a, b) {
  const s = normalizeForMatch(a);
  const t = normalizeForMatch(b);
  if (!s || !t) return 0;
  if (s === t) return 1;

  const sTokens = new Set(s.split(" ").filter(Boolean));
  const tTokens = new Set(t.split(" ").filter(Boolean));
  let inter = 0;
  sTokens.forEach((token) => {
    if (tTokens.has(token)) inter += 1;
  });
  const union = new Set([...sTokens, ...tTokens]).size || 1;
  const tokenScore = inter / union;
  const containmentScore = s.includes(t) || t.includes(s) ? 1 : 0;
  const shouldRunEdit =
    containmentScore === 1 || tokenScore >= 0.2 || Math.min(s.length, t.length) <= 6;
  if (!shouldRunEdit) {
    return Math.max(0, Math.min(1, tokenScore * 0.9 + containmentScore * 0.1));
  }

  const edit = levenshteinDistance(s, t);
  const editScore = 1 - edit / Math.max(s.length, t.length, 1);
  return Math.max(0, Math.min(1, tokenScore * 0.45 + containmentScore * 0.15 + editScore * 0.4));
}

function getResolverRank(resolvedBy) {
  const key = String(resolvedBy || "").toLowerCase();
  if (key === "dom-anchor") return 4;
  if (key === "ui-tree-anchor") return 3;
  if (key === "ocr-anchor") return 2;
  if (key === "template-hint") return 1;
  return 0;
}

function shouldReplaceStepTarget(step, nextResolvedBy, nextConfidence) {
  const hasExistingBox = Boolean(step?.bbox);
  if (!hasExistingBox) return true;
  const currentRank = getResolverRank(step?.resolvedBy);
  const nextRank = getResolverRank(nextResolvedBy);
  const currentConfidence = getStepConfidence(step);
  if (currentRank >= nextRank && currentConfidence >= STEP_CONFIDENCE_MIN) {
    return false;
  }
  if (nextRank < currentRank) {
    return nextConfidence >= currentConfidence + 0.08;
  }
  if (nextRank === currentRank) {
    return nextConfidence >= currentConfidence + 0.03;
  }
  return true;
}

function resolveAnchorsWithOcr(guidance, ocrElements) {
  if (!guidance?.steps?.length || !Array.isArray(ocrElements) || !ocrElements.length) {
    return guidance;
  }

  const steps = guidance.steps.map((step) => {
    const action = String(step?.action || "").toLowerCase();
    if (!(action === "click" || action === "double_click" || action === "type")) {
      return step;
    }
    const anchor = step.anchorText || step.target || step.instruction || "";
    if (!anchor) {
      return step;
    }

    let best = null;
    let bestScore = 0;
    for (const el of ocrElements) {
      const score = fuzzySimilarity(anchor, el?.text || "");
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    if (!best || bestScore < 0.72 || !best.bbox) {
      return step;
    }

    const mergedConfidence = Math.max(getStepConfidence(step), Math.min(0.99, bestScore));
    if (!shouldReplaceStepTarget(step, "ocr-anchor", mergedConfidence)) {
      return step;
    }
    return {
      ...step,
      bbox: best.bbox,
      confidence: mergedConfidence,
      anchorText: step.anchorText || best.text,
      resolvedBy: "ocr-anchor"
    };
  });
  return { ...guidance, steps };
}

function inferTemplateHintFromText(value) {
  const text = normalizeForMatch(value);
  if (!text) return "";
  if (text.includes("setting") || text.includes("gear")) return "settings";
  if (text.includes("menu") || text.includes("hamburger")) return "menu";
  if (text.includes("search") || text.includes("find")) return "search";
  if (text.includes("close") || text.includes("cancel") || text.includes("x")) return "close";
  if (text.includes("back") || text.includes("previous")) return "back";
  if (text.includes("next") || text.includes("continue")) return "next";
  return "";
}

function predictAction(step) {
  const action = String(step?.action || "read").toLowerCase();
  const text = normalizeForMatch(
    [step?.instruction, step?.target, step?.anchorText, step?.textToType, step?.controlType].join(" ")
  );
  if (step?.textToType && (action === "read" || action === "click" || action === "verify")) {
    return "type";
  }
  if (text.includes("scroll") && action !== "open_url" && action !== "open_local_html") {
    return "scroll";
  }
  if ((text.includes("input") || text.includes("field") || text.includes("textbox")) && step?.textToType) {
    return "type";
  }
  return action;
}

function applyActionPrediction(guidance) {
  if (!guidance?.steps?.length) return guidance;
  const steps = guidance.steps.map((step) => {
    const predictedAction = predictAction(step);
    const templateHint =
      step.templateHint ||
      inferTemplateHintFromText([step?.target, step?.instruction, step?.anchorText].join(" "));
    return {
      ...step,
      action: predictedAction,
      templateHint
    };
  });
  return { ...guidance, steps };
}

function resolveAnchorsWithUiTree(guidance, uiElements) {
  if (!guidance?.steps?.length || !Array.isArray(uiElements) || !uiElements.length) {
    return guidance;
  }
  const steps = guidance.steps.map((step) => {
    const action = String(step?.action || "").toLowerCase();
    if (!(action === "click" || action === "double_click" || action === "type")) {
      return step;
    }
    const anchor = step.anchorText || step.target || step.instruction || "";
    if (!anchor) return step;

    let best = null;
    let bestScore = 0;
    for (const el of uiElements) {
      const base = fuzzySimilarity(anchor, el?.name || "");
      let typeBoost = 0;
      const ctype = normalizeForMatch(el?.controlType || "");
      if (action === "click" || action === "double_click") {
        if (ctype.includes("button") || ctype.includes("menu") || ctype.includes("tab")) typeBoost = 0.08;
      }
      if (action === "type") {
        if (ctype.includes("edit") || ctype.includes("text")) typeBoost = 0.1;
      }
      const score = Math.min(1, base + typeBoost);
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (!best || bestScore < 0.7 || !best.bbox) return step;
    const mergedConfidence = Math.max(getStepConfidence(step), Math.min(0.99, bestScore));
    if (!shouldReplaceStepTarget(step, "ui-tree-anchor", mergedConfidence)) return step;
    return {
      ...step,
      bbox: best.bbox,
      confidence: mergedConfidence,
      anchorText: step.anchorText || best.name,
      controlType: best.controlType || step.controlType || "",
      resolvedBy: "ui-tree-anchor"
    };
  });
  return { ...guidance, steps };
}

function resolveAnchorsWithDom(guidance, domElements) {
  if (!guidance?.steps?.length || !Array.isArray(domElements) || !domElements.length) {
    return guidance;
  }
  const steps = guidance.steps.map((step) => {
    const action = String(step?.action || "").toLowerCase();
    if (!(action === "click" || action === "double_click" || action === "type")) {
      return step;
    }
    const anchor = step.anchorText || step.target || step.instruction || "";
    if (!anchor) return step;

    let best = null;
    let bestScore = 0;
    for (const el of domElements) {
      const base = fuzzySimilarity(anchor, el?.text || "");
      let tagBoost = 0;
      const tag = normalizeForMatch(el?.tag || el?.controlType || "");
      if (action === "type" && (tag.includes("input") || tag.includes("textarea"))) {
        tagBoost = 0.12;
      }
      if ((action === "click" || action === "double_click") && (tag.includes("button") || tag.includes("a"))) {
        tagBoost = 0.1;
      }
      const score = Math.min(1, base + tagBoost);
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (!best || bestScore < 0.72 || !best.bbox) return step;
    const mergedConfidence = Math.max(getStepConfidence(step), Math.min(0.99, bestScore));
    if (!shouldReplaceStepTarget(step, "dom-anchor", mergedConfidence)) return step;
    return {
      ...step,
      bbox: best.bbox,
      confidence: mergedConfidence,
      anchorText: step.anchorText || best.text,
      controlType: best.tag || best.controlType || step.controlType || "",
      resolvedBy: "dom-anchor"
    };
  });
  return { ...guidance, steps };
}

function resolveTemplateHints(guidance, ocrElements, uiElements, domElements) {
  if (!guidance?.steps?.length) return guidance;
  const combined = [
    ...(Array.isArray(domElements) ? domElements.map((el) => ({ text: el.text, bbox: el.bbox })) : []),
    ...(Array.isArray(uiElements) ? uiElements.map((el) => ({ text: el.name, bbox: el.bbox })) : []),
    ...(Array.isArray(ocrElements) ? ocrElements : [])
  ];
  if (!combined.length) return guidance;

  const hintWords = {
    settings: ["settings", "preferences", "gear"],
    menu: ["menu", "more", "options"],
    search: ["search", "find"],
    close: ["close", "cancel"],
    back: ["back", "previous"],
    next: ["next", "continue"]
  };

  const steps = guidance.steps.map((step) => {
    if (step?.bbox || !step?.templateHint) return step;
    const words = hintWords[String(step.templateHint).toLowerCase()] || [];
    if (!words.length) return step;
    let best = null;
    let bestScore = 0;
    for (const el of combined) {
      const text = normalizeForMatch(el?.text || "");
      const hit = words.some((w) => text.includes(w));
      if (!hit) continue;
      const score = 0.68 + Math.min(0.25, text.length / 80);
      if (score > bestScore && el?.bbox) {
        bestScore = score;
        best = el;
      }
    }
    if (!best) return step;
    return {
      ...step,
      bbox: best.bbox,
      confidence: Math.max(getStepConfidence(step), bestScore),
      resolvedBy: "template-hint"
    };
  });
  return { ...guidance, steps };
}

function boxCenterDistance(a, b) {
  const acx = a.x + a.w / 2;
  const acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2;
  const bcy = b.y + b.h / 2;
  const dx = acx - bcx;
  const dy = acy - bcy;
  return Math.sqrt(dx * dx + dy * dy);
}

function repairOrDropMismatchedBboxes(guidance, ocrElements, uiElements, domElements) {
  if (!guidance?.steps?.length) return guidance;
  const candidates = [
    ...(Array.isArray(domElements)
      ? domElements.map((el) => ({ text: String(el?.text || ""), bbox: normalizeBox(el?.bbox), source: "dom" }))
      : []),
    ...(Array.isArray(uiElements)
      ? uiElements.map((el) => ({ text: String(el?.name || ""), bbox: normalizeBox(el?.bbox), source: "ui" }))
      : []),
    ...(Array.isArray(ocrElements)
      ? ocrElements.map((el) => ({ text: String(el?.text || ""), bbox: normalizeBox(el?.bbox), source: "ocr" }))
      : [])
  ].filter((c) => c.text && c.bbox);

  if (!candidates.length) return guidance;

  const steps = guidance.steps.map((step) => {
    if (!isTargetStep(step) || !step?.bbox) return step;
    const anchor = String(step?.anchorText || step?.target || "").trim();
    if (!anchor) return step;
    const currentBox = normalizeBox(step.bbox);
    if (!currentBox) return step;

    let localBestScore = 0;
    for (const c of candidates) {
      if (boxOverlapRatio(c.bbox, currentBox) < 0.22) continue;
      const score = fuzzySimilarity(anchor, c.text);
      if (score > localBestScore) localBestScore = score;
    }

    // If current bbox context text doesn't resemble anchor, try a global repair.
    if (localBestScore >= 0.62) return step;

    let best = null;
    let bestScore = 0;
    for (const c of candidates) {
      const textScore = fuzzySimilarity(anchor, c.text);
      if (textScore < 0.74) continue;
      const distancePenalty = Math.min(0.14, boxCenterDistance(currentBox, c.bbox) * 0.18);
      const score = textScore - distancePenalty;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    if (!best || bestScore < 0.74) {
      // Suppress bad box so overlay won't point to a wrong place.
      return {
        ...step,
        bbox: null,
        confidence: Math.min(getStepConfidence(step), 0.69),
        resolvedBy: `${step?.resolvedBy || "model"}-bbox-dropped`
      };
    }

    return {
      ...step,
      bbox: best.bbox,
      confidence: Math.max(getStepConfidence(step), Math.min(0.96, bestScore)),
      anchorText: step.anchorText || best.text,
      resolvedBy: `${step?.resolvedBy || "model"}-bbox-repaired-${best.source}`
    };
  });

  return { ...guidance, steps };
}

function deriveRegionFromGuidance(guidance) {
  const steps = Array.isArray(guidance?.steps) ? guidance.steps : [];
  const targetBoxes = steps
    .filter((step) => isTargetStep(step) && step?.bbox && getStepConfidence(step) >= 0.65)
    .map((step) => step.bbox);
  const union = unionBoxes(targetBoxes);
  return expandRegion(union, 0.09);
}

function getStepConfidence(step) {
  const raw = Number(step?.confidence);
  if (!Number.isFinite(raw)) {
    return 0;
  }
  return Math.max(0, Math.min(1, raw));
}

function isTargetStep(step) {
  const action = String(step?.action || "").toLowerCase();
  return action === "click" || action === "type" || action === "double_click";
}

function isStepTrusted(step) {
  if (!isTargetStep(step)) {
    return true;
  }
  const confidence = getStepConfidence(step);
  const hasAnchor = String(step?.anchorText || "").trim().length >= 2;
  const resolvedBy = String(step?.resolvedBy || "").toLowerCase();
  let minConfidence = STEP_CONFIDENCE_MIN;
  if (resolvedBy === "dom-anchor") minConfidence = 0.74;
  if (resolvedBy === "ui-tree-anchor") minConfidence = 0.8;
  if (resolvedBy === "ocr-anchor") minConfidence = 0.84;
  return confidence >= minConfidence && hasAnchor;
}

function getOverlayEligibleSteps(guidance) {
  const steps = Array.isArray(guidance?.steps) ? guidance.steps : [];
  return steps
    .filter((step) => {
      const action = String(step?.action || "").toLowerCase();
      const hasBox = Boolean(step?.bbox);
      const supportsOverlay = action === "click" || action === "double_click" || action === "type";
      return supportsOverlay && hasBox && isStepTrusted(step);
    })
    .slice(0, MAX_OVERLAY_STEPS)
    .map((step) => ({
      step: step.step,
      action: step.action,
      target: step.target,
      instruction: step.instruction,
      anchorText: step.anchorText,
      templateHint: step.templateHint || "",
      controlType: step.controlType || "",
      textToType: step.textToType || "",
      howToGet: step.howToGet || "",
      confidence: getStepConfidence(step),
      bbox: step.bbox
    }));
}

function updateStepNavUi() {
  if (!onScreenPromptsEnabled) {
    stepNav?.classList.add("hidden");
    if (stepNavLabel) {
      stepNavLabel.textContent = "On-screen prompts OFF";
    }
    if (prevStepBtn) prevStepBtn.disabled = true;
    if (nextStepBtn) nextStepBtn.disabled = true;
    return;
  }
  const total = latestOverlaySteps.length;
  const show = total > 1;
  stepNav?.classList.toggle("hidden", !show);
  if (!show) {
    if (stepNavLabel) {
      stepNavLabel.textContent = total === 1 ? "Step 1 / 1" : "No on-screen steps";
    }
    if (prevStepBtn) prevStepBtn.disabled = true;
    if (nextStepBtn) nextStepBtn.disabled = true;
    return;
  }
  if (stepNavLabel) {
    stepNavLabel.textContent = `Step ${currentStepIndex + 1} / ${total}`;
  }
  if (prevStepBtn) prevStepBtn.disabled = currentStepIndex <= 0;
  if (nextStepBtn) nextStepBtn.disabled = currentStepIndex >= total - 1;
}

async function renderCurrentOverlayStep() {
  if (!latestOverlaySteps.length || !latestCaptureMeta) {
    if (lastOverlayRenderKey !== OVERLAY_HIDDEN_KEY) {
      await window.panelApi.hideOverlay();
      lastOverlayRenderKey = OVERLAY_HIDDEN_KEY;
    }
    updateStepNavUi();
    return;
  }
  currentStepIndex = Math.max(0, Math.min(currentStepIndex, latestOverlaySteps.length - 1));
  const step = latestOverlaySteps[currentStepIndex];
  const b = normalizeBox(step?.bbox);
  const overlayKey = [
    String(step?.step || ""),
    String(step?.action || ""),
    String(step?.anchorText || ""),
    String(step?.resolvedBy || ""),
    Number(getStepConfidence(step)).toFixed(3),
    b
      ? `${b.x.toFixed(4)}:${b.y.toFixed(4)}:${b.w.toFixed(4)}:${b.h.toFixed(4)}`
      : "none",
    JSON.stringify(latestCaptureMeta?.displayBoundsPx || latestCaptureMeta?.displayBoundsDip || {})
  ].join("|");
  if (overlayKey === lastOverlayRenderKey) {
    updateStepNavUi();
    return;
  }
  await window.panelApi.showOverlay({
    steps: [step],
    captureMeta: latestCaptureMeta
  });
  lastOverlayRenderKey = overlayKey;
  updateStepNavUi();
}

async function syncOnScreenPrompts(guidance) {
  if (!onScreenPromptsEnabled) {
    latestOverlaySteps = [];
    if (lastOverlayRenderKey !== OVERLAY_HIDDEN_KEY) {
      await window.panelApi.hideOverlay();
      lastOverlayRenderKey = OVERLAY_HIDDEN_KEY;
    }
    updateStepNavUi();
    return;
  }
  if (latestCaptureMeta?.fullPageCapture) {
    latestOverlaySteps = [];
    if (lastOverlayRenderKey !== OVERLAY_HIDDEN_KEY) {
      await window.panelApi.hideOverlay();
      lastOverlayRenderKey = OVERLAY_HIDDEN_KEY;
    }
    updateStepNavUi();
    return;
  }
  latestOverlaySteps = getOverlayEligibleSteps(guidance);
  if (!latestOverlaySteps.length || !latestCaptureMeta) {
    if (lastOverlayRenderKey !== OVERLAY_HIDDEN_KEY) {
      await window.panelApi.hideOverlay();
      lastOverlayRenderKey = OVERLAY_HIDDEN_KEY;
    }
    updateStepNavUi();
    return;
  }
  currentStepIndex = Math.max(0, Math.min(currentStepIndex, latestOverlaySteps.length - 1));
  await renderCurrentOverlayStep();
}

function applyOnScreenToggleUi() {
  if (!toggleOnScreenBtn) return;
  toggleOnScreenBtn.classList.toggle("primary", onScreenPromptsEnabled);
  toggleOnScreenBtn.setAttribute(
    "title",
    onScreenPromptsEnabled
      ? "Disable on-screen prompts (currently on)"
      : "Enable on-screen prompts (currently off)"
  );
  toggleOnScreenBtn.setAttribute(
    "aria-label",
    onScreenPromptsEnabled ? "Disable on-screen prompts" : "Enable on-screen prompts"
  );
}

async function setOnScreenPromptsEnabled(enabled: boolean, options: { silent?: boolean } = {}) {
  const silent = Boolean(options.silent);
  onScreenPromptsEnabled = Boolean(enabled);
  applyOnScreenToggleUi();
  if (!onScreenPromptsEnabled) {
    latestOverlaySteps = [];
    if (lastOverlayRenderKey !== OVERLAY_HIDDEN_KEY) {
      await window.panelApi.hideOverlay();
      lastOverlayRenderKey = OVERLAY_HIDDEN_KEY;
    }
    updateStepNavUi();
    if (!silent) {
      response.textContent =
        "On-screen prompts are OFF. Guidance will appear in the response box only.";
    }
    return;
  }
  if (!silent) {
    response.textContent =
      "On-screen prompts are ON. High-confidence steps will also be shown on screen.";
  }
  await syncOnScreenPrompts(latestGuidance);
}

function getScreenshotSignature(dataUrl) {
  if (!dataUrl) {
    return "";
  }
  return `${dataUrl.length}-${dataUrl.slice(-120)}`;
}

function cacheSet(map, key, value, maxSize) {
  if (!key) return;
  if (map.has(key)) {
    map.delete(key);
  }
  map.set(key, value);
  while (map.size > maxSize) {
    const first = map.keys().next().value;
    map.delete(first);
  }
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normalizeBox(box) {
  if (!box) return null;
  const x = clamp01(box.x);
  const y = clamp01(box.y);
  const w = clamp01(box.w);
  const h = clamp01(box.h);
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

function expandRegion(box, pad = 0.08) {
  const b = normalizeBox(box);
  if (!b) return null;
  const x = clamp01(b.x - pad);
  const y = clamp01(b.y - pad);
  const right = clamp01(b.x + b.w + pad);
  const bottom = clamp01(b.y + b.h + pad);
  return normalizeBox({ x, y, w: Math.max(0.01, right - x), h: Math.max(0.01, bottom - y) });
}

function unionBoxes(boxes) {
  const valid = boxes.map(normalizeBox).filter(Boolean);
  if (!valid.length) return null;
  const minX = Math.min(...valid.map((b) => b.x));
  const minY = Math.min(...valid.map((b) => b.y));
  const maxX = Math.max(...valid.map((b) => b.x + b.w));
  const maxY = Math.max(...valid.map((b) => b.y + b.h));
  return normalizeBox({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
}

function boxOverlapRatio(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const interW = Math.max(0, x2 - x1);
  const interH = Math.max(0, y2 - y1);
  const inter = interW * interH;
  const area = Math.max(0.00001, a.w * a.h);
  return inter / area;
}

function filterElementsByRegion(elements, region) {
  if (!region || !Array.isArray(elements) || !elements.length) {
    return Array.isArray(elements) ? elements : [];
  }
  return elements.filter((el) => {
    const b = normalizeBox(el?.bbox);
    if (!b) return false;
    return boxOverlapRatio(b, region) >= 0.25;
  });
}

function regionKey(region) {
  if (!region) return "full";
  return `${region.x.toFixed(3)}-${region.y.toFixed(3)}-${region.w.toFixed(3)}-${region.h.toFixed(3)}`;
}

function renderCaptureState() {
  if (latestScreenshot) {
    captureStatus.textContent = "Screen captured. Manual capture only.";
    preview.src = latestScreenshot;
  } else {
    captureStatus.textContent = "No capture yet. Click Capture Again or bubble icon.";
    preview.removeAttribute("src");
  }
}

function setPanelHidden(panelEl, hidden) {
  if (!panelEl) {
    return;
  }
  panelEl.classList.toggle("hidden", hidden);
}

function isPanelHidden(panelEl) {
  return !panelEl || panelEl.classList.contains("hidden");
}

function setDiyState(enabled) {
  diyModeEnabled = enabled;
  startDiyBtn.disabled = enabled;
  stopDiyBtn.disabled = !enabled;
}

function setAutoState(enabled) {
  autoModeEnabled = enabled;
  if (startAutoBtn) {
    startAutoBtn.disabled = enabled;
  }
  if (stopAutoToolbarBtn) {
    stopAutoToolbarBtn.disabled = !enabled;
  }
  stopAutoBtn.disabled = !enabled;
}

function setActionButtonsEnabled(enabled: boolean, options: { allowSubmitWhileBusy?: boolean } = {}) {
  const allowSubmitWhileBusy = Boolean(options.allowSubmitWhileBusy);
  const disableSubmit = !enabled && !allowSubmitWhileBusy;
  if (analyzeBtn) {
    analyzeBtn.disabled = disableSubmit;
  }
  if (toggleOnScreenBtn) {
    toggleOnScreenBtn.disabled = disableSubmit;
  }
  if (sendBtn) {
    sendBtn.disabled = disableSubmit;
  }
  captureAgainBtn.disabled = !enabled;
  startDiyBtn.disabled = !enabled || diyModeEnabled;
  if (startAutoBtn) {
    startAutoBtn.disabled = !enabled || autoModeEnabled;
  }
  if (checkUpdateBtn) {
    checkUpdateBtn.disabled = !enabled;
  }
}

function applyUpdateState(state) {
  if (!state) return;
  const msg = [state.message, state.error ? `Error: ${state.error}` : ""].filter(Boolean).join(" ");
  if (updateStatusEl) {
    updateStatusEl.textContent = msg || "Updates: not checked.";
  }
  if (installUpdateBtn) {
    installUpdateBtn.disabled = state.stage !== "downloaded";
  }
}

function stopDiyMode() {
  if (diyTimer) {
    clearTimeout(diyTimer);
    diyTimer = null;
  }
  diyInFlight = false;
  diyUnchangedStreak = 0;
  diyChangeBurstTicks = 0;
  setDiyState(false);
}

function stopAutoMode() {
  if (autoTimer) {
    clearTimeout(autoTimer);
    autoTimer = null;
  }
  autoInFlight = false;
  setAutoState(false);
}

function scheduleAutoTick(delayMs) {
  if (!autoModeEnabled) {
    return;
  }
  if (autoTimer) {
    clearTimeout(autoTimer);
  }
  autoTimer = setTimeout(() => {
    autoTimer = null;
    void runAutoTick();
  }, Math.max(0, Number(delayMs) || 0));
}

function requestImmediateAutoTick() {
  if (!autoModeEnabled) {
    return;
  }
  if (autoTimer) {
    clearTimeout(autoTimer);
    autoTimer = null;
  }
  if (autoInFlight) {
    scheduleAutoTick(0);
    return;
  }
  setTimeout(() => {
    void runAutoTick();
  }, 0);
}

function stepRiskText(step) {
  return normalizeForMatch(
    [step?.instruction, step?.target, step?.anchorText, step?.textToType, step?.url].filter(Boolean).join(" ")
  );
}

function isRiskyBrowserStep(step) {
  const text = stepRiskText(step);
  const riskyWords = [
    "submit",
    "confirm",
    "delete",
    "remove",
    "purchase",
    "buy",
    "checkout",
    "pay",
    "publish",
    "post",
    "send",
    "transfer",
    "sign out",
    "logout"
  ];
  return riskyWords.some((word) => text.includes(word));
}

function getRiskBadgeText(step) {
  return isRiskyBrowserStep(step) ? "Risky step: requires explicit confirmation." : "";
}

async function executeAutoStep(step) {
  const action = String(step?.action || "").toLowerCase();
  const defaultSheet = step?.sheet || "Sheet1";
  const defaultStartCell = step?.startCell || step?.cell || "A1";
  const normalizedValues = Array.isArray(step?.values) && step.values.length
    ? step.values
    : step?.textToType || step?.value
      ? [[String(step?.textToType || step?.value || "")]]
      : [];
  if (isBrowserRunnableStep(step)) {
    return window.panelApi.browserExecuteStep({ step });
  }
  if (action === "desktop_launch_app") {
    return window.panelApi.desktopLaunchApp({
      command: step?.command,
      args: step?.args,
      workingDirectory: step?.workingDirectory
    });
  }
  if (action === "desktop_open_path") {
    return window.panelApi.desktopOpenPath({ path: step?.path });
  }
  if (action === "desktop_focus_window") {
    return window.panelApi.desktopFocusWindow({ title: step?.windowTitle || step?.target });
  }
  if (action === "excel_open_workbook") {
    return window.panelApi.excelOpenWorkbook({ path: step?.path, visible: true });
  }
  if (action === "excel_read_range") {
    return window.panelApi.excelReadRange({ path: step?.path, sheet: defaultSheet, range: step?.range || "A1:A20" });
  }
  if (action === "excel_set_cell") {
    return window.panelApi.excelSetCell({
      path: step?.path,
      sheet: defaultSheet,
      cell: step?.cell || defaultStartCell,
      value: step?.textToType || step?.value || ""
    });
  }
  if (action === "excel_write_range") {
    return window.panelApi.excelWriteRange({
      path: step?.path,
      sheet: defaultSheet,
      startCell: defaultStartCell,
      values: normalizedValues
    });
  }
  if (action === "excel_save_workbook") {
    return window.panelApi.excelSaveWorkbook({ path: step?.path, saveAsPath: step?.saveAsPath || "" });
  }
  if (action === "excel_close_workbook") {
    return window.panelApi.excelCloseWorkbook({ path: step?.path, saveChanges: true });
  }
  if (action === "research_extract_listings") {
    const task = taskOrchestrator.getActiveTask();
    taskOrchestrator.setResearchAction(question.value.trim(), "extract");
    const extracted = extractVisibleResearchItems(
      latestDomElements || [],
      task?.context?.currentUrl || "",
      question.value.trim()
    );
    taskOrchestrator.addResearchItems(question.value.trim(), extracted.items);
    appendAutomationStatus(extracted.summary);
    return extracted;
  }
  if (action === "marketing_analyze_website") {
    const task = taskOrchestrator.getActiveTask() || taskOrchestrator.startTask(question.value.trim());
    const analysis = analyzeMarketingWebsite(
      latestDomElements || [],
      task?.context?.currentUrl || "",
      task?.context?.currentPageTitle || "",
      question.value.trim()
    );
    taskOrchestrator.setMarketingProfile(question.value.trim(), analysis.profile);
    appendAutomationStatus(analysis.summary);
    appendAutomationStatus(
      `Profile: ${analysis.profile.brand}${analysis.profile.offer ? ` | Offer: ${analysis.profile.offer}` : ""}`
    );
    return analysis;
  }
  if (action === "marketing_generate_assets") {
    const task = taskOrchestrator.getActiveTask() || taskOrchestrator.startTask(question.value.trim());
    const draft = generateMarketingAssetDraft(question.value.trim(), task);
    taskOrchestrator.addMarketingAsset(question.value.trim(), draft.asset);
    appendAutomationStatus(draft.summary);
    appendAutomationStatus(`Keywords: ${draft.asset.keywordIdeas.slice(0, 5).join(", ")}`);
    appendAutomationStatus(`Angles: ${draft.asset.messagingAngles.slice(0, 3).join(" | ")}`);
    appendAutomationStatus(`Channels: ${draft.asset.channelPacks.map((pack) => pack.channel).join(", ")}`);
    return draft;
  }
  if (action === "marketing_prepare_meta_campaign") {
    const task = taskOrchestrator.getActiveTask() || taskOrchestrator.startTask(question.value.trim());
    const prepared = buildMetaCampaignPlan(question.value.trim(), task);
    taskOrchestrator.setMetaCampaignPlan(question.value.trim(), prepared.plan);
    appendAutomationStatus(prepared.summary);
    appendAutomationStatus(`Meta CTA: ${prepared.plan.creative.cta} | Budget: ${prepared.plan.budget}`);
    return prepared;
  }
  if (action === "marketing_prepare_google_campaign") {
    const task = taskOrchestrator.getActiveTask() || taskOrchestrator.startTask(question.value.trim());
    const prepared = buildGoogleCampaignPlan(question.value.trim(), task);
    taskOrchestrator.setGoogleCampaignPlan(question.value.trim(), prepared.plan);
    appendAutomationStatus(prepared.summary);
    appendAutomationStatus(`Google CTA: ${prepared.plan.ad.cta} | Budget: ${prepared.plan.budget}`);
    return prepared;
  }
  throw new Error(`Unsupported automation action: ${action}`);
}

function buildSyntheticResearchStep(task) {
  if (!task || task.taskType !== "research") {
    return null;
  }
  const targetCount = Number(task?.memory?.researchTargetCount || getRequestedResearchCount(question.value.trim()) || 5);
  const collectedCount = Array.isArray(task?.memory?.collectedItems) ? task.memory.collectedItems.length : 0;
  const listingsVisible = hasVisibleResearchListings(latestDomElements || []);
  const activeWorkbook = String(task?.context?.activeWorkbook || "").trim();
  const exportWritten = Boolean(task?.memory?.researchExportWritten);
  const lastAdded = Number(task?.memory?.lastCollectionAdded || 0);
  const lastResearchLoopAction = String(task?.memory?.lastResearchLoopAction || "").trim().toLowerCase();

  if (collectedCount >= targetCount && !activeWorkbook) {
    return {
      step: {
        action: "excel_open_workbook",
        instruction: "Open a blank workbook to store the research comparison table.",
        path: ""
      },
      reason: ""
    };
  }

  if (collectedCount >= targetCount && activeWorkbook && !exportWritten) {
    return {
      step: {
        action: "excel_write_range",
        instruction: "Write collected research rows to Excel.",
        sheet: "Sheet1",
        startCell: "A1",
        values: buildResearchExcelRows(task.memory.collectedItems)
      },
      reason: ""
    };
  }

  if (
    collectedCount < targetCount &&
    listingsVisible &&
    lastAdded === 0 &&
    lastResearchLoopAction !== "scroll" &&
    task.context.currentUrl
  ) {
    return {
      step: {
        action: "scroll",
        instruction: "Scroll for more research results."
      },
      reason: ""
    };
  }

  if (collectedCount < targetCount && listingsVisible) {
    return {
      step: {
        action: "research_extract_listings",
        instruction: "Collect visible research listings from the current results page."
      },
      reason: ""
    };
  }

  return null;
}

function buildSyntheticMarketingStep(task) {
  if (!task || task.taskType !== "marketing") {
    return null;
  }
  const metaTask = isMetaAdsTask(task.userGoal);
  const googleTask = isGoogleAdsTask(task.userGoal);
  const hasProfile = Boolean(task?.memory?.marketingProfile);
  const hasAssets = Array.isArray(task?.memory?.generatedAssets) && task.memory.generatedAssets.length > 0;
  const hasMetaPlan = Boolean(task?.memory?.metaCampaignPlan);
  const hasGooglePlan = Boolean(task?.memory?.googleCampaignPlan);
  const hasWebsiteContext = Boolean(task?.context?.currentUrl);
  const activeWorkbook = String(task?.context?.activeWorkbook || "").trim();
  const exportWritten = Boolean(task?.memory?.marketingExportWritten);
  const isInAdsManager = /adsmanager\.facebook\.com|business\.facebook\.com/i.test(String(task?.context?.currentUrl || ""));
  const isInGoogleAds = /ads\.google\.com/i.test(String(task?.context?.currentUrl || ""));

  if (!hasProfile && hasWebsiteContext) {
    return {
      step: {
        action: "marketing_analyze_website",
        instruction: "Analyze the current website and extract a marketing profile."
      },
      reason: ""
    };
  }

  if (metaTask && hasAssets && !hasMetaPlan) {
    return {
      step: {
        action: "marketing_prepare_meta_campaign",
        instruction: "Prepare the Meta campaign setup using the generated ad pack."
      },
      reason: ""
    };
  }

  if (metaTask && hasMetaPlan && !isInAdsManager) {
    return {
      step: {
        action: "open_url",
        instruction: "Open Meta Ads Manager to create the campaign.",
        url: "https://adsmanager.facebook.com/"
      },
      reason: ""
    };
  }

  if (metaTask && hasMetaPlan && isInAdsManager) {
    return null;
  }

  if (googleTask && hasAssets && !hasGooglePlan) {
    return {
      step: {
        action: "marketing_prepare_google_campaign",
        instruction: "Prepare the Google Ads campaign setup using the generated ad pack."
      },
      reason: ""
    };
  }

  if (googleTask && hasGooglePlan && !isInGoogleAds) {
    return {
      step: {
        action: "open_url",
        instruction: "Open Google Ads to create the campaign.",
        url: "https://ads.google.com/"
      },
      reason: ""
    };
  }

  if (googleTask && hasGooglePlan && isInGoogleAds) {
    return null;
  }

  if (hasAssets && !activeWorkbook) {
    return {
      step: {
        action: "excel_open_workbook",
        instruction: "Open a blank workbook to export the marketing asset packs.",
        path: ""
      },
      reason: ""
    };
  }

  if (hasAssets && activeWorkbook && !exportWritten) {
    return {
      step: {
        action: "excel_write_range",
        instruction: "Write the generated marketing asset packs to Excel.",
        sheet: "Sheet1",
        startCell: "A1",
        values: buildMarketingExcelRows(task.memory.generatedAssets)
      },
      reason: ""
    };
  }

  if (!hasAssets) {
    return {
      step: {
        action: "marketing_generate_assets",
        instruction: "Generate a campaign brief with keyword ideas, messaging angles, and channel asset packs."
      },
      reason: ""
    };
  }

  return null;
}

function pickNextAutoBrowserStep(guidance) {
  const activeTask = taskOrchestrator.getActiveTask();
  if (activeTask?.taskType === "research" && activeTask?.memory?.researchExportWritten) {
    return { step: null, reason: "Research collection completed and exported to Excel." };
  }
  if (activeTask?.taskType === "marketing" && activeTask?.memory?.generatedAssets?.length) {
    if (isMetaAdsTask(activeTask.userGoal) || isGoogleAdsTask(activeTask.userGoal)) {
      // Let the browser planner continue inside the ad platform until a risky publish step is reached.
    } else if (activeTask?.memory?.marketingExportWritten) {
      return { step: null, reason: "Marketing analysis, asset generation, and Excel export completed." };
    }
  }
  const syntheticResearch = buildSyntheticResearchStep(activeTask);
  if (syntheticResearch?.step) {
    return syntheticResearch;
  }
  const syntheticMarketing = buildSyntheticMarketingStep(activeTask);
  if (syntheticMarketing?.step) {
    return syntheticMarketing;
  }
  const steps = Array.isArray(guidance?.steps) ? guidance.steps : [];
  for (const step of steps) {
    if (!isAutoExecutableStep(step)) {
      continue;
    }
    if (isRiskyBrowserStep(step)) {
      return { step: null, reason: `Stopped before risky action: ${step.instruction || step.target || step.action}.` };
    }
    return { step, reason: "" };
  }
  return { step: null, reason: guidance?.needsMoreContext ? "Need more browser context before continuing." : "No browser-executable step returned." };
}

function renderManualHandoff(step, errorMessage) {
  pendingManualStep = step || null;
  appendAutomationStatus(`Paused for manual help: ${step?.instruction || step?.target || "blocked step"}`);
  renderAutomationActivity("Automation paused. Please complete one step manually.");

  const summary = document.createElement("div");
  summary.className = "response-summary";
  summary.textContent = "Automation paused. Please complete this step manually, then continue.";
  response.appendChild(summary);

  const detail = document.createElement("div");
  detail.className = "step-how-list";
  detail.textContent = [
    step?.instruction ? `Step: ${step.instruction}` : "",
    step?.target ? `Target: ${step.target}` : "",
    errorMessage ? `Why it paused: ${errorMessage}` : ""
  ]
    .filter(Boolean)
    .join("\n");
  response.appendChild(detail);

  if (step?.textToType) {
    const typeBlock = document.createElement("div");
    typeBlock.className = "type-block";
    typeBlock.textContent = step.textToType;
    response.appendChild(typeBlock);

    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.textContent = "Copy Text";
    copyBtn.dataset.copyText = step.textToType;
    response.appendChild(copyBtn);
  }

  const doneBtn = document.createElement("button");
  doneBtn.className = "copy-btn";
  doneBtn.textContent = "I Did This";
  doneBtn.dataset.manualResume = "true";
  response.appendChild(doneBtn);

  const retryBtn = document.createElement("button");
  retryBtn.className = "copy-btn";
  retryBtn.textContent = "Retry Step";
  retryBtn.dataset.manualRetry = "true";
  response.appendChild(retryBtn);
}

function buildBrowserAutomationGoal(
  userQuestion: string,
  domElements = latestDomElements,
  currentUrl = "",
  currentPageTitle = "",
  foregroundTitle = ""
) {
  const normalized = normalizeForMatch(userQuestion);
  const looksLikeShoppingTask =
    normalized.includes("buy") ||
    normalized.includes("shop") ||
    normalized.includes("myntra") ||
    normalized.includes("amazon") ||
    normalized.includes("flipkart") ||
    normalized.includes("size") ||
    normalized.includes("delivery") ||
    normalized.includes("pincode") ||
    normalized.includes("price");
  const looksLikeChartTask =
    normalized.includes("tradingview") ||
    normalized.includes("chart") ||
    normalized.includes("futures") ||
    normalized.includes("bank nifty");
  const looksLikeExcelTask =
    normalized.includes("excel") ||
    normalized.includes("workbook") ||
    normalized.includes("spreadsheet") ||
    normalized.includes("sheet") ||
    normalized.includes("cell");
  const looksLikeDesktopTask =
    normalized.includes("desktop") ||
    normalized.includes("icons") ||
    normalized.includes("folder") ||
    normalized.includes("taskbar") ||
    normalized.includes("windows settings");

  const constraintState = getPlannerConstraintState(domElements, currentUrl);
  const orchestratorPrompt = taskOrchestrator.buildPlannerAddendum(userQuestion, {
    currentUrl,
    currentPageTitle,
    foregroundWindow: foregroundTitle
  });
  const activeTask = taskOrchestrator.getActiveTask();
  const metaPlan = activeTask?.memory?.metaCampaignPlan;
  const googlePlan = activeTask?.memory?.googleCampaignPlan;

  return [
    "Automation mode is required.",
    "Return strict JSON only using the action schema.",
    "Do not answer in plain text.",
    "Treat the user's request as an automation task that may use browser, desktop, or Excel actions.",
    "Use progressive execution: do the nearest unambiguous step now instead of asking early questions.",
    "Only ask the user for information when the current page or next action is genuinely blocked without it.",
    "If some constraints can be applied later, continue with the earlier steps first.",
    "Prefer partial progress over clarification when a reasonable next action is obvious.",
    "If a website or search engine is needed and no suitable page is already open, include step 1 as action=open_url.",
    "If the task is research, comparison, lookup, or finding prices/courses/products, still return executable browser steps.",
    "All explicit user requirements are mandatory constraints, not optional preferences.",
    "Never drop, weaken, or ignore any constraint from the user's request.",
    "Before moving to a deeper page or opening an item/product detail page, verify the current page satisfies the known constraints that should already be visible.",
    "If required constraints are not yet satisfied, keep filtering/searching instead of drifting to unrelated pages.",
    "If a constraint cannot be checked yet, keep navigating toward the page/section where it can be checked.",
    "If a required filter or value is unavailable, respond with needsMoreContext=true and explicitly say which requirement is blocked or missing.",
    "Do not ask about a later constraint if earlier setup steps can still be done.",
    "Example: for shopping, open site, search product, and apply obvious filters before asking for delivery/pincode details.",
    "For shopping or product search tasks, do not open random products before search terms, size, price, delivery, pincode, and other required filters are handled or verified when visible.",
    "For shopping tasks, treat product, gender, and size as early-stage constraints.",
    "For shopping tasks, treat pincode and delivery-speed constraints as deferred until the site exposes a delivery location or delivery-check control.",
    "If pincode or delivery speed is known from the user request, remember it silently and only ask the user to act when the page actually requires manual entry or a delivery check is visibly blocked.",
    "When deferred constraints exist, continue searching and filtering first instead of asking follow-up questions immediately.",
    "For comparison or list-building tasks, prefer staying on list/search/results pages until the needed results are gathered.",
    "Prefer the fewest steps needed to complete the browser task.",
    "If the task starts broad, open the most appropriate site first, often Google or the directly relevant site.",
    looksLikeShoppingTask
      ? "This appears to be a shopping or product-finding task. Progress stepwise: open site, search product, apply obvious filters like gender/size first, then ask for pincode or delivery checks only when the site actually requires them."
      : "",
    looksLikeChartTask
      ? "This appears to be a charting/trading task. Terms like 1 minute refer to chart timeframe, not delivery or shipping. Use common defaults where reasonable, such as TradingView symbol search, and avoid unnecessary follow-up questions unless the task is genuinely blocked."
      : "",
    looksLikeExcelTask
      ? "This appears to be an Excel task. If no workbook path is given, open or use Excel first and work in the active or a new blank workbook. Default to Sheet1 and A1 when the user did not specify a sheet or starting cell."
      : "",
    looksLikeDesktopTask
      ? "This appears to be a Windows desktop task, not a browser task. Prefer desktop actions over browser click steps. Do not ask Playwright to click the desktop background or desktop icons."
      : "",
    metaPlan
      ? `Meta campaign plan: objective=${metaPlan.objective}; budget=${metaPlan.budget}; audience=${metaPlan.audience.join(" / ")}; CTA=${metaPlan.creative.cta}; headline1=${metaPlan.creative.headline1}; primaryText=${metaPlan.creative.primaryText}`
      : "",
    metaPlan
      ? "If currently in Meta Ads Manager, use the prepared Meta campaign plan to create the campaign, ad set, and ad creative. Stop before the final publish/confirm step if it is risky."
      : "",
    googlePlan
      ? `Google Ads campaign plan: objective=${googlePlan.objective}; budget=${googlePlan.budget}; keywordThemes=${googlePlan.keywordThemes.join(" / ")}; CTA=${googlePlan.ad.cta}; headline1=${googlePlan.ad.headline1}; description1=${googlePlan.ad.description1}`
      : "",
    googlePlan
      ? "If currently in Google Ads, use the prepared Google Ads campaign plan to create the campaign, ad group, keywords, and ads. Stop before the final publish/confirm step if it is risky."
      : "",
    constraintState.unresolvedActive.length
      ? `Active unresolved constraints to work on now: ${constraintState.unresolvedActive.map((item) => item.label).join(", ")}`
      : "",
    constraintState.deferred.length
      ? `Deferred constraints to remember but not ask about yet: ${constraintState.deferred.map((item) => item.label).join(", ")}`
      : "",
    looksLikeShoppingTask && !constraintState.deliveryUiVisible
      ? "Delivery-related checks are not yet visible. Do not ask for pincode or delivery confirmation until you reach that UI."
      : "",
    orchestratorPrompt,
    `User browser task: ${userQuestion}`
  ].join("\n");
}

async function analyzeAutomationGoal(userQuestion: string) {
  const domState = await getFreshDomElements();
  const domElements = domState.elements || [];
  const currentUrl = String(domState.sourceUrl || "").trim();
  const currentPageTitle = String(domState.pageTitle || "").trim();
  let foregroundTitle = "";
  let foregroundProcess = "";
  let uiTreeElements = [];
  try {
    const foreground = (await window.panelApi.desktopGetForegroundWindow()) as Dict;
    foregroundTitle = String(foreground?.title || "").trim();
    foregroundProcess = String(foreground?.processName || "").trim();
  } catch (_error) {
    foregroundTitle = "";
    foregroundProcess = "";
  }
  try {
    const uiTree = (await window.panelApi.desktopGetForegroundUiTree()) as Dict;
    uiTreeElements = Array.isArray(uiTree?.elements) ? uiTree.elements.slice(0, UI_TREE_MAX_ELEMENTS) : [];
  } catch (_error) {
    uiTreeElements = [];
  }
  latestOcrElements = [];
  latestUiTreeElements = uiTreeElements;
  latestDomElements = domElements;
  taskOrchestrator.observe(userQuestion, {
    currentUrl,
    currentPageTitle,
    foregroundWindow: foregroundTitle
  });
  const constraintState = getPlannerConstraintState(domElements, currentUrl);
  if (constraintState.unresolvedActive.length) {
    appendAutomationStatus(`Still checking constraints: ${constraintState.unresolvedActive.map((item) => item.label).join(", ")}`);
  } else if (constraintState.deferred.length) {
    appendAutomationStatus(`Progressing before deferred checks: ${constraintState.deferred.map((item) => item.label).join(", ")}`);
  }

  const result = await window.panelApi.analyzeAutomation({
    provider: providerEl.value,
    apiKey: apiKeyEl.value,
    goal: buildBrowserAutomationGoal(userQuestion, domElements, currentUrl, currentPageTitle, foregroundTitle),
    domElements,
    currentUrl,
    currentPageTitle,
    foregroundTitle,
    foregroundProcess,
    uiTreeElements
  });
  const summaryText = result.answer || "No response returned.";
  const withTypeFallback = fillTypeFallbacks(result.guidance || null);
  const withAppNormalization = normalizeAutomationAppSteps(withTypeFallback);
  const withoutRedundantOpen = removeRedundantOpenUrl(withAppNormalization, currentUrl);
  const withPredictions = applyActionPrediction(withoutRedundantOpen);
  const withDom = resolveAnchorsWithDom(withPredictions, latestDomElements);
  latestGuidance = resolveAnchorsWithUiTree(withDom, latestUiTreeElements);
  renderGuidanceInResponse(latestGuidance, summaryText);
  await syncOnScreenPrompts(latestGuidance);
}

function scheduleDiyTick(delayMs) {
  if (!diyModeEnabled) {
    return;
  }
  if (diyTimer) {
    clearTimeout(diyTimer);
  }
  diyTimer = setTimeout(async () => {
    const nextDelay = await runDiyTick();
    scheduleDiyTick(nextDelay);
  }, Math.max(100, Number(delayMs) || DIY_IDLE_DELAY_MS));
}

function requestImmediateDiyTick() {
  if (!diyModeEnabled || diyInFlight) {
    return;
  }
  scheduleDiyTick(0);
}

window.panelApi.onScreenCaptured((payload) => {
  stopDiyMode();
  currentStepIndex = 0;
  latestScreenshot = payload?.dataUrl || null;
  latestCaptureMeta = payload?.captureMeta || null;
  latestOcrElements = [];
  latestUiTreeElements = [];
  latestDomElements = [];
  latestGuidance = null;
  latestOverlaySteps = [];
  lastResolvedRegion = null;
  lastOverlayRenderKey = OVERLAY_HIDDEN_KEY;
  window.panelApi.hideOverlay().catch(() => {});
  updateStepNavUi();
  response.textContent = getQuickHelpText();
  renderCaptureState();
});

window.panelApi.onUpdateStatus((payload) => {
  applyUpdateState(payload);
});

captureAgainBtn.addEventListener("click", async () => {
  stopDiyMode();
  currentStepIndex = 0;
  captureAgainBtn.disabled = true;
  captureStatus.textContent = "Waiting for manual screen selection...";
  try {
    const capture = await captureCurrentScreen();
    latestScreenshot = capture?.dataUrl || null;
    latestCaptureMeta = capture?.captureMeta || null;
    latestOcrElements = [];
    latestUiTreeElements = [];
    latestDomElements = [];
    latestGuidance = null;
    latestOverlaySteps = [];
    lastResolvedRegion = null;
    lastOverlayRenderKey = OVERLAY_HIDDEN_KEY;
    window.panelApi.hideOverlay().catch(() => {});
    updateStepNavUi();
    response.textContent = getQuickHelpText();
    if (!latestScreenshot) {
      captureStatus.textContent = "Capture failed.";
    } else {
      renderCaptureState();
    }
  } catch (_error) {
    captureStatus.textContent = "Capture failed.";
  } finally {
    captureAgainBtn.disabled = false;
  }
});

saveKeyBtn.addEventListener("click", async () => {
  saveKeyBtn.disabled = true;
  try {
    await window.panelApi.saveSettings({
      provider: providerEl.value,
      apiKey: apiKeyEl.value
    });
    response.textContent = "API key saved securely for selected provider.";
    setPanelHidden(settingsPanel, true);
  } catch (error) {
    response.textContent = `Failed to save API key: ${error.message}`;
  } finally {
    saveKeyBtn.disabled = false;
  }
});

checkUpdateBtn?.addEventListener("click", async () => {
  checkUpdateBtn.disabled = true;
  if (updateStatusEl) {
    updateStatusEl.textContent = "Checking for updates...";
  }
  try {
    const state = await window.panelApi.checkForUpdates();
    applyUpdateState(state);
  } catch (error) {
    if (updateStatusEl) {
      updateStatusEl.textContent = `Update check failed: ${error.message}`;
    }
  } finally {
    checkUpdateBtn.disabled = false;
  }
});

installUpdateBtn?.addEventListener("click", async () => {
  installUpdateBtn.disabled = true;
  if (updateStatusEl) {
    updateStatusEl.textContent = "Installing update and restarting...";
  }
  try {
    await window.panelApi.installUpdate();
  } catch (error) {
    if (updateStatusEl) {
      updateStatusEl.textContent = `Install failed: ${error.message}`;
    }
    installUpdateBtn.disabled = false;
  }
});

providerEl.addEventListener("change", async () => {
  try {
    await window.panelApi.saveSettings({ provider: providerEl.value, apiKey: "" });
    const settings = (await window.panelApi.getSettings()) as Dict;
    apiKeyEl.value = settings.apiKey || "";
  } catch (_error) {
    // Keep UI responsive even if save fails.
  }
});

function renderGuidanceInResponse(guidance, summaryText) {
  renderAutomationActivity(summaryText || guidance?.summary || "Automation updated.");

  function appendNavigationLink(container, url, sourceLabel) {
    if (!isHttpUrl(url)) {
      return;
    }
    const block = document.createElement("div");
    block.className = "step-how-list";

    const label = document.createElement("div");
    label.className = "step-source";
    label.textContent = sourceLabel || "Navigation link:";
    block.appendChild(label);

    const linkText = document.createElement("div");
    linkText.className = "type-block";
    linkText.textContent = url;
    block.appendChild(linkText);

    const openBtn = document.createElement("button");
    openBtn.className = "copy-btn";
    openBtn.textContent = "Open Link";
    openBtn.dataset.openUrl = url;
    block.appendChild(openBtn);

    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.textContent = "Copy Link";
    copyBtn.dataset.copyText = url;
    block.appendChild(copyBtn);

    container.appendChild(block);
  }

  const responseRoot = response;

  if (guidance?.needsMoreContext) {
    const contextNote = document.createElement("div");
    contextNote.className = "step-how-list";
    const reason = guidance.contextReason || "Current screenshot is not sufficient for reliable guidance.";
    const next = guidance.nextUserAction || "Please navigate to the relevant page/section, then analyze again.";
    contextNote.textContent = `Need more context: ${reason}\nNext: ${next}`;
    responseRoot.appendChild(contextNote);
    const recoveryUrl = getContextRecoveryUrl(guidance, summaryText || guidance?.summary || "");
    appendNavigationLink(responseRoot, recoveryUrl, "Suggested page to continue:");

    const followUpBox = document.createElement("div");
    followUpBox.className = "followup-box";

    const followUpLabel = document.createElement("div");
    followUpLabel.className = "step-source";
    followUpLabel.textContent = "Reply here if the agent needs information from you:";
    followUpBox.appendChild(followUpLabel);

    const followUpInput = document.createElement("textarea");
    followUpInput.className = "followup-input";
    followUpInput.rows = 2;
    followUpInput.placeholder = next;
    followUpInput.dataset.followupInput = "true";
    followUpBox.appendChild(followUpInput);

    const followUpBtn = document.createElement("button");
    followUpBtn.className = "copy-btn";
    followUpBtn.textContent = "Continue";
    followUpBtn.dataset.followupContinue = "true";
    followUpBox.appendChild(followUpBtn);

    responseRoot.appendChild(followUpBox);
  }

  const steps = guidance?.steps || [];
  if (!steps.length && guidance?.needsMoreContext) {
    const none = document.createElement("div");
    none.textContent = "Waiting for your input or page change before automation can continue.";
    responseRoot.appendChild(none);
  }
}

function fillTypeFallbacks(guidance) {
  if (!guidance?.steps?.length) {
    return guidance;
  }
  const nextSteps = guidance.steps.map((step) => {
    const action = String(step.action || "").toLowerCase();
    if (action !== "type" || step.textToType) {
      return step;
    }
    const target = normalizeText(step.target || step.instruction || "");
    if (target.includes("redirect") || target.includes("url")) {
      return {
        ...step,
        textToType: "https://localhost/callback",
        whatIs: step.whatIs || "This is the URL where users return after auth/consent.",
        whyRequired:
          step.whyRequired ||
          "Platform needs it to redirect securely back to your app after login/authorization.",
        howToGet:
          step.howToGet ||
          "Use your app callback URL. For local testing, localhost callback works if provider allows it.",
        howToGetSteps:
          step.howToGetSteps?.length
            ? step.howToGetSteps
            : [
                "Open your app/backend settings where callback/redirect URL is configured.",
                "Copy the callback URL from settings.",
                "Return to this form and paste it in Redirect URL field.",
                "If not configured yet, use https://localhost/callback for local testing."
              ]
      };
    }
    if (target.includes("app") && target.includes("name")) {
      return {
        ...step,
        textToType: "My Trading Assistant App",
        whatIs: step.whatIs || "A display name to identify this integration/app.",
        whyRequired:
          step.whyRequired || "Helps you and the platform distinguish this app from other apps.",
        howToGet: step.howToGet || "Use any unique app name you can recognize later.",
        howToGetSteps:
          step.howToGetSteps?.length
            ? step.howToGetSteps
            : [
                "Think of a clear name for this integration/app.",
                "Keep it unique so you can identify it later.",
                "Type that name in the app name field."
              ]
      };
    }
    if (target.includes("description")) {
      return {
        ...step,
        textToType: "Internal app for API integration and automated workflow testing.",
        whatIs: step.whatIs || "A short summary of what your app does.",
        whyRequired:
          step.whyRequired ||
          "Helps reviewers/admins understand your use case and expected API behavior.",
        howToGet: step.howToGet || "Write a short purpose of your app.",
        howToGetSteps:
          step.howToGetSteps?.length
            ? step.howToGetSteps
            : [
                "Summarize what this app does in one sentence.",
                "Mention API/integration purpose clearly.",
                "Paste the sentence into description field."
              ]
      };
    }
    return {
      ...step,
      whatIs: step.whatIs || "This field stores a required value for setup.",
      whyRequired: step.whyRequired || "The platform uses this value to configure or verify your app.",
      howToGet: step.howToGet || "Provide a valid value for this field.",
      howToGetSteps:
        step.howToGetSteps?.length
          ? step.howToGetSteps
          : [
              "Identify where this value is defined (settings, dashboard, or docs).",
              "Copy the value from source.",
              "Return here and paste it into the field."
            ]
    };
  });
  return { ...guidance, steps: nextSteps };
}

function normalizeAutomationAppSteps(guidance) {
  if (!guidance?.steps?.length) {
    return guidance;
  }
  const steps = guidance.steps.map((step) => {
    const text = normalizeForMatch(
      [step?.instruction, step?.target, step?.anchorText, step?.url, step?.windowTitle].filter(Boolean).join(" ")
    );

    if (text.includes("excel") && (text.includes("blank workbook") || text.includes("new workbook") || text.includes("open excel"))) {
      return {
        ...step,
        action: "excel_open_workbook",
        path: step?.path || "",
        instruction: step?.instruction || "Open a blank workbook in Excel."
      };
    }

    if (text.includes("excel") && (text.includes("write") || text.includes("fill") || text.includes("record")) && !step?.path) {
      if (Array.isArray(step?.values) && step.values.length) {
        return {
          ...step,
          action: "excel_write_range",
          sheet: step?.sheet || "Sheet1",
          startCell: step?.startCell || step?.cell || "A1"
        };
      }
      if (step?.textToType || step?.value) {
        return {
          ...step,
          action: "excel_set_cell",
          sheet: step?.sheet || "Sheet1",
          cell: step?.cell || step?.startCell || "A1"
        };
      }
    }

    if (text.includes("whatsapp") && !text.includes("web")) {
      return {
        ...step,
        action: "desktop_launch_app",
        command: step?.command || "whatsapp"
      };
    }

    if (
      text.includes("desktop background") ||
      text.includes("focus the desktop") ||
      text.includes("empty area on the desktop") ||
      text.includes("desktop icons")
    ) {
      return {
        ...step,
        action: "desktop_focus_window",
        windowTitle: step?.windowTitle || "Program Manager"
      };
    }

    if (
      (text.includes("compare") ||
        text.includes("research") ||
        text.includes("collect products") ||
        text.includes("extract products") ||
        text.includes("product list")) &&
      !text.includes("excel") &&
      !text.includes("desktop")
    ) {
      return {
        ...step,
        action: "research_extract_listings",
        instruction: step?.instruction || "Extract structured comparison data before going deeper."
      };
    }

    if (
      text.includes("promote") ||
      text.includes("website profile") ||
      text.includes("business profile") ||
      text.includes("app profile") ||
      text.includes("analyze website") ||
      text.includes("homepage") ||
      text.includes("pricing page") ||
      text.includes("landing page")
    ) {
      return {
        ...step,
        action: "marketing_analyze_website",
        instruction: step?.instruction || "Analyze the website and extract the marketing profile."
      };
    }

    if (
      text.includes("campaign brief") ||
      text.includes("marketing plan") ||
      text.includes("ad copy") ||
      text.includes("keyword ideas") ||
      text.includes("social posts")
    ) {
      return {
        ...step,
        action: "marketing_generate_assets",
        instruction: step?.instruction || "Generate structured marketing assets for this task."
      };
    }

    return step;
  });
  return { ...guidance, steps };
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function firstUrlFromText(value) {
  const match = String(value || "").match(/https?:\/\/[^\s"')\]]+/i);
  return match ? match[0] : "";
}

function parseQuestionMode(value) {
  const raw = String(value || "").trim();
  const forceNew = /^new\s*:/i.test(raw);
  const text = forceNew ? raw.replace(/^new\s*:/i, "").trim() : raw;
  return { forceNew, text };
}

function getContextRecoveryUrl(guidance, summaryText) {
  const suggested = String(guidance?.suggestedUrl || "").trim();
  if (isHttpUrl(suggested)) {
    return suggested;
  }
  const combined = [
    summaryText,
    guidance?.summary,
    guidance?.contextReason,
    guidance?.nextUserAction,
    ...(Array.isArray(guidance?.steps) ? guidance.steps.map((s) => s.url || "") : [])
  ].join("\n");
  const detected = firstUrlFromText(combined);
  return isHttpUrl(detected) ? detected : "";
}

async function getFreshDomElements() {
  try {
    const browserState = (await window.panelApi.getBrowserState()) as Dict;
    if (browserState?.active) {
      const browserDom = (await window.panelApi.getBrowserDomMap()) as Dict;
      return {
        elements: Array.isArray(browserDom?.elements) ? browserDom.elements.slice(0, DOM_MAX_ELEMENTS) : [],
        sourceUrl: String(browserDom?.sourceUrl || browserState?.url || "").trim(),
        pageTitle: String(browserDom?.pageTitle || browserState?.title || "").trim()
      };
    }
  } catch (_error) {
    // Fall through to browser extension DOM state.
  }
  try {
    const domState = (await window.panelApi.getLatestDomMap()) as Dict;
    const latest = (domState?.latest || {}) as Dict;
    const receivedAt = Number(latest?.receivedAt || 0);
    if (!receivedAt || Date.now() - receivedAt > DOM_RECENT_MS) {
      return { elements: [], sourceUrl: "", pageTitle: "" };
    }
    return {
      elements: Array.isArray(latest?.elements) ? latest.elements.slice(0, DOM_MAX_ELEMENTS) : [],
      sourceUrl: String(latest?.sourceUrl || "").trim(),
      pageTitle: String(latest?.pageTitle || "").trim()
    };
  } catch (_error) {
    return { elements: [], sourceUrl: "", pageTitle: "" };
  }
}

function comparableUrlKey(rawUrl) {
  if (!isHttpUrl(rawUrl)) return "";
  try {
    const u = new URL(String(rawUrl).trim());
    const host = u.hostname.toLowerCase();
    const path = (u.pathname || "/").replace(/\/+$/, "") || "/";
    return `${host}${path.toLowerCase()}`;
  } catch (_error) {
    return "";
  }
}

function isSamePageUrl(a, b) {
  const left = comparableUrlKey(a);
  const right = comparableUrlKey(b);
  return Boolean(left && right && left === right);
}

function removeRedundantOpenUrl(guidance, currentUrl) {
  if (!guidance || !isHttpUrl(currentUrl)) {
    return guidance;
  }

  const rawSteps = Array.isArray(guidance.steps) ? guidance.steps : [];
  let removed = false;
  const steps = rawSteps.filter((step) => {
    const action = String(step?.action || "").toLowerCase();
    if (action !== "open_url" || !isHttpUrl(step?.url || "")) {
      return true;
    }
    if (!isSamePageUrl(step.url, currentUrl)) {
      return true;
    }
    removed = true;
    return false;
  });

  let suggestedUrl = String(guidance.suggestedUrl || "").trim();
  if (isSamePageUrl(suggestedUrl, currentUrl)) {
    suggestedUrl = "";
    removed = true;
  }

  if (!removed) {
    return guidance;
  }

  const next = {
    ...guidance,
    suggestedUrl,
    steps
  };

  if (!steps.length) {
    return {
      ...next,
      needsMoreContext: true,
      contextReason: guidance.contextReason || "You are already on the correct page, but the required section is not clearly visible yet.",
      nextUserAction:
        "You are already on the right page. Scroll to the needed section, then ask again or run Analyze once more."
    };
  }

  return {
    ...next,
    needsMoreContext: false
  };
}

async function captureBestAvailableScreen(options: { allowFullPage?: boolean } = {}) {
  const allowFullPage = Boolean(options.allowFullPage);
  try {
    const browserState = (await window.panelApi.getBrowserState()) as Dict;
    if (browserState?.active) {
      captureStatus.textContent = "Capturing Playwright browser page...";
      return await refreshBrowserPreview();
    }
  } catch (_error) {
    // Fall through to existing capture modes.
  }
  if (!allowFullPage) {
    captureStatus.textContent = "Capturing current screen...";
    return captureCurrentScreen();
  }
  let activeUrl = "";
  try {
    const detected = await window.panelApi.detectActiveBrowserUrl();
    activeUrl = String(detected?.url || "").trim();
  } catch (_error) {
    activeUrl = "";
  }

  if (isHttpUrl(activeUrl)) {
    try {
      captureStatus.textContent = "Capturing full browser page...";
      const fullPage = await window.panelApi.captureFullPageUrl({ url: activeUrl });
      if (fullPage?.dataUrl) {
        return fullPage;
      }
    } catch (_error) {
      // Fall back to normal screen capture to keep flow resilient.
    }
  }
  captureStatus.textContent = "Capturing current screen...";
  return captureCurrentScreen();
}

async function analyzeQuestionWithoutScreenshot(userQuestion: string) {
  const domState = await getFreshDomElements();
  const domElements = domState.elements || [];
  const currentUrl = String(domState.sourceUrl || "").trim();
  const currentPageTitle = String(domState.pageTitle || "").trim();
  const result = await window.panelApi.analyzeScreen({
    provider: providerEl.value,
    apiKey: apiKeyEl.value,
    question: userQuestion,
    imageDataUrl: "",
    ocrElements: [],
    uiTreeElements: [],
    domElements,
    currentUrl,
    currentPageTitle
  });
  const summaryText = result.answer || "No response returned.";
  latestGuidance = result.guidance || { summary: summaryText, steps: [] };
  renderGuidanceInResponse(latestGuidance, summaryText);
  await syncOnScreenPrompts(latestGuidance);
}

async function analyzeCurrentScreenshot(userQuestion: string, options: { useRegion?: boolean; fastMode?: boolean } = {}) {
  if (!latestScreenshot) {
    await analyzeQuestionWithoutScreenshot(userQuestion);
    return;
  }
  const useRegion = Boolean(options.useRegion);
  const fastMode = Boolean(options.fastMode);
  const screenshotSig = getScreenshotSignature(latestScreenshot);
  const activeRegion = useRegion ? expandRegion(lastResolvedRegion, 0.06) : null;
  const regionId = regionKey(activeRegion);
  const questionKey = normalizeForMatch(userQuestion).slice(0, 600);
  const analyzeKey = `${providerEl.value}|${screenshotSig}|${regionId}|${questionKey}|${fastMode ? "fast" : "full"}`;
  const cachedAnalyze = analyzeResultCache.get(analyzeKey);
  if (cachedAnalyze) {
    latestGuidance = cachedAnalyze.guidance;
    renderGuidanceInResponse(latestGuidance, cachedAnalyze.summaryText);
    await syncOnScreenPrompts(latestGuidance);
    return;
  }

  const aiImage = fastMode
    ? await prepareScreenshotForAi(latestScreenshot, {
        maxEdge: DIY_FAST_AI_IMAGE_EDGE,
        jpegQuality: DIY_FAST_AI_IMAGE_QUALITY
      })
    : await prepareScreenshotForAi(latestScreenshot);
  let cachedExtract = ocrExtractionCache.get(screenshotSig);
  if (!cachedExtract) {
    let ocrElements = [];
    let uiTreeElements = [];
    const domState = await getFreshDomElements();
    const domElements = domState.elements || [];
    const useFastDomOnly = domElements.length >= DOM_FAST_PATH_MIN;

    if (!useFastDomOnly) {
      const extractionTasks = [window.panelApi.extractOcr({ imageDataUrl: latestScreenshot })];
      if (!fastMode && !latestCaptureMeta?.fullPageCapture) {
        extractionTasks.push(window.panelApi.detectUiTree({ captureMeta: latestCaptureMeta }));
      }
      const [ocrRes, uiTreeRes] = await Promise.allSettled(extractionTasks);
      if (ocrRes?.status === "fulfilled") {
        ocrElements = Array.isArray(ocrRes.value?.elements)
          ? ocrRes.value.elements.slice(0, fastMode ? DIY_OCR_MAX_ELEMENTS : OCR_MAX_ELEMENTS)
          : [];
      }
      if (uiTreeRes?.status === "fulfilled") {
        uiTreeElements = Array.isArray(uiTreeRes.value?.elements)
          ? uiTreeRes.value.elements.slice(0, UI_TREE_MAX_ELEMENTS)
          : [];
      }
    }

    cachedExtract = {
      ocrElements,
      uiTreeElements,
      domElements,
      domSourceUrl: String(domState.sourceUrl || "").trim(),
      domPageTitle: String(domState.pageTitle || "").trim()
    };
    cacheSet(ocrExtractionCache, screenshotSig, cachedExtract, OCR_CACHE_MAX);
  }
  let ocrElements = cachedExtract.ocrElements || [];
  let uiTreeElements = cachedExtract.uiTreeElements || [];
  let domElements = cachedExtract.domElements || [];
  const currentUrl = String(cachedExtract.domSourceUrl || latestCaptureMeta?.sourceUrl || "").trim();
  const currentPageTitle = String(cachedExtract.domPageTitle || "").trim();
  if (activeRegion) {
    ocrElements = filterElementsByRegion(ocrElements, activeRegion);
    uiTreeElements = filterElementsByRegion(uiTreeElements, activeRegion);
    domElements = filterElementsByRegion(domElements, activeRegion);
  }
  latestOcrElements = ocrElements;
  latestUiTreeElements = uiTreeElements;
  latestDomElements = domElements;

  const result = await window.panelApi.analyzeScreen({
    provider: providerEl.value,
    apiKey: apiKeyEl.value,
    question: userQuestion,
    imageDataUrl: aiImage,
    ocrElements,
    uiTreeElements,
    domElements,
    currentUrl,
    currentPageTitle
  });
  const summaryText = result.answer || "No response returned.";
  const withTypeFallback = fillTypeFallbacks(result.guidance || null);
  const withoutRedundantOpen = removeRedundantOpenUrl(withTypeFallback, currentUrl);
  const withPredictions = applyActionPrediction(withoutRedundantOpen);
  const withDom = resolveAnchorsWithDom(withPredictions, latestDomElements);
  const withUiTree = resolveAnchorsWithUiTree(withDom, latestUiTreeElements);
  const withOcr = resolveAnchorsWithOcr(withUiTree, latestOcrElements);
  const withHints = resolveTemplateHints(withOcr, latestOcrElements, latestUiTreeElements, latestDomElements);
  latestGuidance = repairOrDropMismatchedBboxes(
    withHints,
    latestOcrElements,
    latestUiTreeElements,
    latestDomElements
  );
  lastResolvedRegion = deriveRegionFromGuidance(latestGuidance) || lastResolvedRegion;
  renderGuidanceInResponse(latestGuidance, summaryText);
  await syncOnScreenPrompts(latestGuidance);
  cacheSet(analyzeResultCache, analyzeKey, { guidance: latestGuidance, summaryText }, ANALYZE_CACHE_MAX);
}

function buildContextualQuestion(userText) {
  const guidance = latestGuidance || {};
  const summary = String(guidance.summary || "").trim();
  const baseQuestion = String(lastPrimaryQuestion || "").trim();
  const steps = Array.isArray(guidance.steps)
    ? guidance.steps
        .slice(0, 6)
        .map(
          (step) =>
            `${step.step}. ${step.instruction} | action=${step.action || "read"} | target=${
              step.target || "area"
            }${step.textToType ? ` | text=${step.textToType}` : ""}`
        )
        .join("\n")
    : "";

  return [
    baseQuestion ? `Original goal:\n${baseQuestion}` : "",
    summary ? `Previous summary:\n${summary}` : "",
    steps ? `Previous steps:\n${steps}` : "",
    `Follow-up question:\n${userText}`,
    "Use current screenshot plus this context. Keep guidance practical."
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function submitUserMessage(options: {
  forceFreshContext?: boolean;
  overridePrompt?: string;
  rememberPrimary?: boolean;
} = {}) {
  const forceFreshContext = Boolean(options.forceFreshContext);
  const rememberPrimary = options.rememberPrimary !== false;
  const rawInput = typeof options.overridePrompt === "string" ? options.overridePrompt : question.value;
  const questionMode = parseQuestionMode(rawInput);
  const q = questionMode.text;
  if (!q) {
    response.textContent = "Type your message first.";
    return;
  }
  if (diyModeEnabled) {
    response.textContent = "Stop DIY mode before sending a manual message.";
    return;
  }
  if (autoModeEnabled) {
    response.textContent = "Stop browser auto mode before sending a manual message.";
    return;
  }

  const originalSendLabel = sendBtn?.textContent || "Run";
  if (sendBtn) {
    sendBtn.textContent = "...";
  }
  captureStatus.textContent = "Starting browser automation...";
  taskConstraints = parseTaskConstraints(q);
  taskOrchestrator.startTask(q);
  resetAutomationActivity(`Starting: ${q}`);
  renderAutomationActivity("Running browser task...");

  try {
    await withOperationLock(async () => {
      if (forceFreshContext || questionMode.forceNew) {
        latestGuidance = null;
        lastPrimaryQuestion = "";
      }
      if (rememberPrimary && (forceFreshContext || questionMode.forceNew || !lastPrimaryQuestion)) {
        lastPrimaryQuestion = q;
      }
      setAutoState(true);
      requestImmediateAutoTick();
    });
  } catch (error) {
    latestOverlaySteps = [];
    updateStepNavUi();
    lastOverlayRenderKey = OVERLAY_HIDDEN_KEY;
    window.panelApi.hideOverlay().catch(() => {});
    response.textContent = `Analyze failed: ${error.message}`;
  } finally {
    if (!autoModeEnabled) {
      captureStatus.textContent = "Browser automation stopped.";
    }
    if (sendBtn) {
      sendBtn.textContent = originalSendLabel;
    }
  }
}

sendBtn?.addEventListener("click", () => {
  void submitUserMessage();
});
analyzeBtn?.addEventListener("click", async () => {
  await submitUserMessage({ forceFreshContext: true });
});
toggleOnScreenBtn?.addEventListener("click", async () => {
  await setOnScreenPromptsEnabled(!onScreenPromptsEnabled);
});
question.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void submitUserMessage();
  }
});

async function runDiyTick() {
  if (!diyModeEnabled || diyInFlight) {
    return DIY_IDLE_DELAY_MS;
  }
  const q = question.value.trim();
  if (!q) {
    captureStatus.textContent = "DIY paused: enter your goal/question.";
    return DIY_IDLE_DELAY_MS;
  }

  diyInFlight = true;
  try {
    captureStatus.textContent = "DIY: capturing current page...";
    const capture = await captureCurrentScreen();
    latestScreenshot = capture?.dataUrl || null;
    latestCaptureMeta = capture?.captureMeta || null;
    if (!latestScreenshot) {
      captureStatus.textContent = "DIY: capture failed.";
      return DIY_ERROR_DELAY_MS;
    }
    preview.src = latestScreenshot;

    const sig = getScreenshotSignature(latestScreenshot);
    if (sig === lastDiySignature) {
      captureStatus.textContent = "DIY: waiting for page change...";
      diyUnchangedStreak += 1;
      diyChangeBurstTicks = 0;
      return Math.min(DIY_MAX_IDLE_DELAY_MS, DIY_IDLE_DELAY_MS + diyUnchangedStreak * 160);
    }
    lastDiySignature = sig;
    diyUnchangedStreak = 0;

    captureStatus.textContent = "DIY: analyzing latest screen...";
    lastResolvedRegion = null;
    await analyzeCurrentScreenshot(q, { useRegion: false, fastMode: true });
    captureStatus.textContent = "DIY active.";
    const nextDelay =
      diyChangeBurstTicks < DIY_BURST_MAX_TICKS ? DIY_BURST_DELAY_MS : DIY_ACTIVE_DELAY_MS;
    diyChangeBurstTicks += 1;
    return nextDelay;
  } catch (error) {
    latestOverlaySteps = [];
    updateStepNavUi();
    lastOverlayRenderKey = OVERLAY_HIDDEN_KEY;
    window.panelApi.hideOverlay().catch(() => {});
    response.textContent = `DIY failed: ${error.message}`;
    captureStatus.textContent = "DIY error.";
    return DIY_ERROR_DELAY_MS;
  } finally {
    diyInFlight = false;
  }
}

async function runAutoTick() {
  if (!autoModeEnabled || autoInFlight) {
    return;
  }
  const q = question.value.trim();
  if (!q) {
    captureStatus.textContent = "Auto mode paused: enter your browser task.";
    stopAutoMode();
    return;
  }

  autoInFlight = true;
  try {
    captureStatus.textContent = "Auto mode: analyzing browser state...";
    const browserState = (await window.panelApi.getBrowserState()) as Dict;
    if (!browserState?.active) {
      captureStatus.textContent = "Auto mode: opening browser session...";
    }

    await analyzeAutomationGoal(q);
    const next = pickNextAutoBrowserStep(latestGuidance);
    if (!next.step) {
      captureStatus.textContent = next.reason || "Auto mode stopped.";
      if (latestGuidance) {
        const summaryText =
          latestGuidance?.summary ||
          latestGuidance?.contextReason ||
          latestGuidance?.nextUserAction ||
          next.reason ||
          "Browser auto mode stopped.";
        renderGuidanceInResponse(latestGuidance, summaryText);
      } else {
        response.textContent = next.reason || "Browser auto mode stopped.";
      }
      stopAutoMode();
      return;
    }

    const stepLabel = next.step.instruction || next.step.action || "next step";
    taskOrchestrator.onStepStarted(q, stepLabel);
    appendAutomationStatus(`Doing: ${stepLabel}`);
    captureStatus.textContent = `Auto mode: ${stepLabel}...`;
    try {
      const stepResult: any = await executeAutoStep(next.step);
      const action = String(next.step?.action || "").toLowerCase();
      if (action === "scroll") {
        const activeTask = taskOrchestrator.getActiveTask();
        if (activeTask?.taskType === "research") {
          taskOrchestrator.setResearchAction(q, "scroll");
        }
      }
      if (action === "excel_open_workbook") {
        taskOrchestrator.observe(q, {
          activeWorkbook: String(stepResult?.path || stepResult?.workbook || "Excel").trim(),
          foregroundWindow: "Excel"
        });
      }
      if (action === "excel_write_range") {
        const activeTask = taskOrchestrator.getActiveTask();
        if (activeTask?.taskType === "research") {
          taskOrchestrator.markResearchExport(q);
        }
        if (activeTask?.taskType === "marketing") {
          taskOrchestrator.markMarketingExport(q);
        }
      }
      await refreshBrowserPreview().catch(() => null);
      const freshDomState = await getFreshDomElements().catch(() => ({ elements: [], sourceUrl: "", pageTitle: "" }));
      latestDomElements = Array.isArray(freshDomState?.elements) ? freshDomState.elements : latestDomElements;
      const activeTask = taskOrchestrator.observe(q, {
        currentUrl: String(freshDomState?.sourceUrl || "").trim(),
        currentPageTitle: String(freshDomState?.pageTitle || "").trim(),
        activeWorkbook: action === "excel_open_workbook" ? String(stepResult?.path || stepResult?.workbook || "") : undefined
      });
      const evaluation = evaluateAutomationProgress(
        activeTask,
        next.step,
        observeAutomationState(activeTask, {
          domElements: latestDomElements,
          currentUrl: String(freshDomState?.sourceUrl || "").trim(),
          currentPageTitle: String(freshDomState?.pageTitle || "").trim(),
          activeWorkbook: String(activeTask?.context?.activeWorkbook || "").trim()
        })
      );
      taskOrchestrator.onStepSucceeded(q, stepLabel);
      appendAutomationStatus(`Done: ${stepLabel}`);
      if (evaluation.message) {
        appendAutomationStatus(evaluation.message);
      }
      if (evaluation.status === "done") {
        taskOrchestrator.markDone(q);
        captureStatus.textContent = evaluation.message || "Automation completed.";
        renderAutomationActivity(evaluation.message || "Automation completed.");
        stopAutoMode();
        return;
      }
      if (evaluation.status === "retry") {
        captureStatus.textContent = evaluation.message || "Retrying with self-correction...";
        scheduleAutoTick(0);
        return;
      }
      requestImmediateDiyTick();
      captureStatus.textContent = "Auto mode active.";
      scheduleAutoTick(AUTO_DELAY_MS);
    } catch (error) {
      const failure = taskOrchestrator.onStepFailed(q, stepLabel, error.message || "Automation step failed.");
      stopAutoMode();
      captureStatus.textContent = "Auto mode paused for manual help.";
      renderManualHandoff(
        next.step,
        failure.task.blockedReason || error.message || "Browser action failed."
      );
      return;
    }
  } catch (error) {
    captureStatus.textContent = "Auto mode error.";
    response.textContent = `Auto mode failed: ${error.message}`;
    stopAutoMode();
  } finally {
    autoInFlight = false;
  }
}

startDiyBtn.addEventListener("click", async () => {
  if (diyModeEnabled) {
    return;
  }
  if (operationInFlight) {
    response.textContent = "Wait for current operation to finish before starting DIY.";
    return;
  }
  if (autoModeEnabled) {
    response.textContent = "Stop browser auto mode before starting DIY.";
    return;
  }
  lastDiySignature = "";
  diyUnchangedStreak = 0;
  diyChangeBurstTicks = 0;
  setDiyState(true);
  captureStatus.textContent = "DIY active.";
  scheduleDiyTick(0);
});

stopDiyBtn.addEventListener("click", () => {
  stopDiyMode();
  captureStatus.textContent = "DIY stopped.";
});

startAutoBtn?.addEventListener("click", async () => {
  if (autoModeEnabled) {
    return;
  }
  if (operationInFlight) {
    response.textContent = "Wait for current operation to finish before starting browser auto mode.";
    return;
  }
  if (diyModeEnabled) {
    response.textContent = "Stop DIY mode before starting browser auto mode.";
    return;
  }
  if (!question.value.trim()) {
    response.textContent = "Enter the browser task first, then start auto mode.";
    return;
  }
  setAutoState(true);
  captureStatus.textContent = "Auto mode active.";
  requestImmediateAutoTick();
});

stopAutoToolbarBtn?.addEventListener("click", () => {
  stopAutoMode();
  captureStatus.textContent = "Auto mode stopped.";
});

stopAutoBtn.addEventListener("click", () => {
  stopAutoMode();
  captureStatus.textContent = "Auto mode stopped.";
});

response.addEventListener("click", async (event) => {
  const eventTarget = event.target as HTMLElement | null;
  if (!eventTarget) {
    return;
  }
  const infoButton = eventTarget.closest(".info-btn") as HTMLElement | null;
  if (infoButton) {
    const card = infoButton.closest(".step-card");
    const panel = card?.querySelector(".info-panel") as HTMLElement | null;
    if (panel) {
      const whatIs = infoButton.dataset.whatIs || "This is a required setup value.";
      const whyRequired = infoButton.dataset.whyRequired || "It is needed for platform configuration.";
      panel.textContent = `What it is: ${whatIs}\nWhy required: ${whyRequired}`;
      panel.hidden = !panel.hidden;
    }
    return;
  }

  const openUrlBtn = eventTarget.closest("[data-open-url]") as HTMLElement | null;
  if (openUrlBtn) {
    const url = openUrlBtn.dataset.openUrl || "";
    if (!isHttpUrl(url)) {
      response.textContent = "Invalid link.";
      return;
    }
    try {
      await window.panelApi.browserOpenUrl({ url });
      await refreshBrowserPreview();
      openUrlBtn.textContent = "Opened in Browser";
      requestImmediateDiyTick();
      setTimeout(() => {
        openUrlBtn.textContent = "Open Link";
      }, 1200);
    } catch (error) {
      try {
        await window.panelApi.automationOpenUrl({ url });
        openUrlBtn.textContent = "Opened";
        setTimeout(() => {
          openUrlBtn.textContent = "Open Link";
        }, 1200);
      } catch (_fallbackError) {
        response.textContent = `Open link failed: ${error.message}`;
      }
    }
    return;
  }

  const browserStepBtn = eventTarget.closest("[data-browser-step-index]") as HTMLElement | null;
  if (browserStepBtn) {
    const rawIndex = Number(browserStepBtn.dataset.browserStepIndex || "-1");
    const steps = Array.isArray(latestGuidance?.steps) ? latestGuidance.steps : [];
    const step = rawIndex >= 0 ? steps[rawIndex] : null;
    if (!step) {
      response.textContent = "Browser step is no longer available.";
      return;
    }
    try {
      browserStepBtn.textContent = "...";
      await executeAutoStep(step);
      await refreshBrowserPreview();
      browserStepBtn.textContent = "Done";
      requestImmediateDiyTick();
      setTimeout(() => {
        browserStepBtn.textContent = getBrowserStepLabel(step);
      }, 1200);
    } catch (error) {
      browserStepBtn.textContent = getBrowserStepLabel(step);
      response.textContent = `Browser step failed: ${error.message}`;
    }
    return;
  }

  const followUpBtn = eventTarget.closest("[data-followup-continue]") as HTMLElement | null;
  if (followUpBtn) {
    const replyBox = response.querySelector("[data-followup-input='true']") as HTMLTextAreaElement | null;
    const reply = String(replyBox?.value || "").trim();
    if (!reply) {
      response.textContent = "Enter the missing information first.";
      return;
    }
    const prompt = [
      lastPrimaryQuestion ? `Original browser task:\n${lastPrimaryQuestion}` : "",
      latestGuidance?.summary ? `Previous agent summary:\n${latestGuidance.summary}` : "",
      latestGuidance?.nextUserAction ? `Agent needed:\n${latestGuidance.nextUserAction}` : "",
      `User reply:\n${reply}`,
      "Continue the browser task from the current page."
    ]
      .filter(Boolean)
      .join("\n\n");
    question.value = reply;
    await submitUserMessage({ forceFreshContext: true, overridePrompt: prompt, rememberPrimary: false });
    return;
  }

  const manualResumeBtn = eventTarget.closest("[data-manual-resume]") as HTMLElement | null;
  if (manualResumeBtn) {
    pendingManualStep = null;
    try {
      await refreshBrowserPreview().catch(() => null);
    } catch (_error) {
      // Ignore preview refresh failure here and still continue.
    }
    appendAutomationStatus("User completed the paused step manually.");
    setAutoState(true);
    captureStatus.textContent = "Resuming browser automation...";
    requestImmediateAutoTick();
    return;
  }

  const manualRetryBtn = eventTarget.closest("[data-manual-retry]") as HTMLElement | null;
  if (manualRetryBtn) {
    if (!pendingManualStep) {
      response.textContent = "No paused browser step to retry.";
      return;
    }
    try {
      await executeAutoStep(pendingManualStep);
      await refreshBrowserPreview().catch(() => null);
      appendAutomationStatus(`Retry worked: ${pendingManualStep?.instruction || pendingManualStep?.action || "step"}`);
      pendingManualStep = null;
      setAutoState(true);
      captureStatus.textContent = "Retry worked. Resuming browser automation...";
      requestImmediateAutoTick();
    } catch (error) {
      renderManualHandoff(pendingManualStep, error.message || "Retry failed.");
    }
    return;
  }

  const button = eventTarget.closest(".copy-btn") as HTMLElement | null;
  if (!button) {
    return;
  }
  const value = button.dataset.copyText || "";
  if (!value) {
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = "Copy Text";
    }, 1200);
  } catch (_error) {
    response.textContent = "Copy failed. You can still select text manually.";
  }
});

window.addEventListener("keydown", () => {
  requestImmediateDiyTick();
});

window.addEventListener("pointerdown", () => {
  requestImmediateDiyTick();
});

closeBtn.addEventListener("click", () => {
  stopDiyMode();
  stopAutoMode();
  latestOverlaySteps = [];
  lastOverlayRenderKey = OVERLAY_HIDDEN_KEY;
  window.panelApi.hideOverlay().catch(() => {});
  setActionButtonsEnabled(true);
  window.panelApi.close();
});

prevStepBtn?.addEventListener("click", async () => {
  if (!latestOverlaySteps.length) return;
  currentStepIndex = Math.max(0, currentStepIndex - 1);
  await renderCurrentOverlayStep();
});

nextStepBtn?.addEventListener("click", async () => {
  if (!latestOverlaySteps.length) return;
  currentStepIndex = Math.min(latestOverlaySteps.length - 1, currentStepIndex + 1);
  await renderCurrentOverlayStep();
});

toggleSettingsBtn.addEventListener("click", () => {
  const hidden = isPanelHidden(settingsPanel);
  setPanelHidden(settingsPanel, !hidden);
});

toggleCaptureBtn.addEventListener("click", () => {
  const hidden = isPanelHidden(capturePanel);
  setPanelHidden(capturePanel, !hidden);
});

async function initializeSettings() {
  try {
    const settings = (await window.panelApi.getSettings()) as Dict;
    providerEl.value = settings.provider || "openai";
    apiKeyEl.value = settings.apiKey || "";
    setPanelHidden(settingsPanel, Boolean(settings.apiKey));
    const updateState = await window.panelApi.getUpdateState();
    applyUpdateState(updateState);
  } catch (_error) {
    providerEl.value = "openai";
  }
}

renderCaptureState();
response.textContent = getQuickHelpText();
setDiyState(false);
setAutoState(false);
setOnScreenPromptsEnabled(false, { silent: true }).catch(() => {});
setActionButtonsEnabled(true);
updateStepNavUi();
initializeSettings();

}


