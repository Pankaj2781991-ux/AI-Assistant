const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("panelApi", {
  onScreenCaptured: (callback) => {
    ipcRenderer.on("screen-captured", (_event, payload) => callback(payload));
  },
  onUpdateStatus: (callback) => {
    ipcRenderer.on("update:status", (_event, payload) => callback(payload));
  },
  getSettings: () => ipcRenderer.invoke("settings:get"),
  getUpdateState: () => ipcRenderer.invoke("update:get-state"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  captureScreen: () => ipcRenderer.invoke("capture:screen"),
  captureFullPageUrl: (payload) => ipcRenderer.invoke("capture:full-page-url", payload || {}),
  detectActiveBrowserUrl: () => ipcRenderer.invoke("browser:active-url"),
  getLatestDomMap: () => ipcRenderer.invoke("dom:get-latest"),
  extractOcr: (payload) => ipcRenderer.invoke("ocr:extract", payload || {}),
  detectUiTree: (payload) => ipcRenderer.invoke("uitree:detect", payload || {}),
  saveSettings: (payload) => ipcRenderer.invoke("settings:set", payload || {}),
  analyzeScreen: (payload) => ipcRenderer.invoke("analyze:screen", payload || {}),
  showOverlay: (payload) => ipcRenderer.invoke("overlay:show", payload || {}),
  hideOverlay: () => ipcRenderer.invoke("overlay:hide"),
  automationClick: (payload) => ipcRenderer.invoke("automation:click", payload || {}),
  automationDoubleClick: (payload) => ipcRenderer.invoke("automation:double-click", payload || {}),
  automationType: (payload) => ipcRenderer.invoke("automation:type", payload || {}),
  automationKey: (payload) => ipcRenderer.invoke("automation:key", payload || {}),
  automationOpenLocalHtml: (payload) => ipcRenderer.invoke("automation:open-local-html", payload || {}),
  automationOpenUrl: (payload) => ipcRenderer.invoke("automation:open-url", payload || {}),
  close: () => ipcRenderer.send("close-help-panel")
});
