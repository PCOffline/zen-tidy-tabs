export const CONFIG = {
  debug: false,

  prefs: {
    apiKey: "zen-tidy-tabs.apikey",
    model: "zen-tidy-tabs.model",
    labelStyle: "zen-tidy-tabs.labelstyle",
    urlMode: "zen-tidy-tabs.urlmode",
  },

  api: {
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "openai/gpt-4o-mini",
    maxTokens: 2048,
    maxTokensCeiling: 8192,
    tokensPerTab: 24,
    tokensBuffer: 256,
    temperature: 0,
    seed: 7,
    timeoutMs: 90000,
    errorBodyMaxChars: 300,
    outputPreviewMaxChars: 200,
    referer: "https://github.com/PCOffline/zen-tidy-tabs",
    title: "Zen Tidy Tabs",
  },

  ui: {
    controlId: "zen-tidy-tabs-button",
    styleId: "zen-tidy-tabs-style",
    overlayId: "zen-tidy-tabs-overlay",
    notificationValue: "zen-tidy-tabs-msg",
    label: "🧹 Tidy",
    busyLabel: "↻ Tidying…",
    tooltip: "Tidy tabs with AI",
    clearButtonClass: "zen-workspace-close-unpinned-tabs-button",
  },

  panel: {
    hideSaveAndClose: true,
    overrideUngroup: true,
    ids: {
      saveAndClose: "tabGroupEditor_saveAndCloseGroup",
      ungroup: "tabGroupEditor_ungroupTabs",
    },
  },

  grouping: {
    colors: [
      "blue",
      "red",
      "yellow",
      "green",
      "pink",
      "purple",
      "cyan",
      "orange",
      "gray",
    ],
    minTabs: 3,
    minGroups: 2,
    maxGroups: 8,
    targetTabsPerGroup: 3,
  },

  snapshot: {
    titleMax: 160,
    urlMax: 120,
  },

  timing: {
    emptyCheckDelayMs: 80,
    emptyCheckIntervalMs: 150,
    emptyCheckMaxTries: 6,
    emptyWatcherDebounceMs: 500,
    notifyDurationMs: 6000,
    mountRetryMs: 250,
    mountMaxAttempts: 40,
  },
} as const;
