import { contextBridge, ipcRenderer } from "electron";

type Dict = Record<string, unknown>;

contextBridge.exposeInMainWorld("panelApi", {
  onScreenCaptured: (callback: (payload: Dict) => void) => {
    ipcRenderer.on("screen-captured", (_event, payload) => callback(payload));
  },
  onUpdateStatus: (callback: (payload: Dict) => void) => {
    ipcRenderer.on("update:status", (_event, payload) => callback(payload));
  },
  getSettings: () => ipcRenderer.invoke("settings:get"),
  getUpdateState: () => ipcRenderer.invoke("update:get-state"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  captureScreen: () => ipcRenderer.invoke("capture:screen"),
  captureFullPageUrl: (payload: Dict) => ipcRenderer.invoke("capture:full-page-url", payload || {}),
  detectActiveBrowserUrl: () => ipcRenderer.invoke("browser:active-url"),
  getLatestDomMap: () => ipcRenderer.invoke("dom:get-latest"),
  getBrowserState: () => ipcRenderer.invoke("browser:get-state"),
  getBrowserDomMap: () => ipcRenderer.invoke("browser:get-dom-map"),
  captureBrowserPage: () => ipcRenderer.invoke("browser:capture-page"),
  browserOpenUrl: (payload: Dict) => ipcRenderer.invoke("browser:open-url", payload || {}),
  browserExecuteStep: (payload: Dict) => ipcRenderer.invoke("browser:execute-step", payload || {}),
  desktopLaunchApp: (payload: Dict) => ipcRenderer.invoke("desktop:launch-app", payload || {}),
  desktopOpenPath: (payload: Dict) => ipcRenderer.invoke("desktop:open-path", payload || {}),
  desktopListWindows: () => ipcRenderer.invoke("desktop:list-windows"),
  desktopFocusWindow: (payload: Dict) => ipcRenderer.invoke("desktop:focus-window", payload || {}),
  desktopGetForegroundWindow: () => ipcRenderer.invoke("desktop:get-foreground-window"),
  desktopGetForegroundUiTree: () => ipcRenderer.invoke("desktop:get-foreground-uitree"),
  excelOpenWorkbook: (payload: Dict) => ipcRenderer.invoke("excel:open-workbook", payload || {}),
  excelReadRange: (payload: Dict) => ipcRenderer.invoke("excel:read-range", payload || {}),
  excelSetCell: (payload: Dict) => ipcRenderer.invoke("excel:set-cell", payload || {}),
  excelWriteRange: (payload: Dict) => ipcRenderer.invoke("excel:write-range", payload || {}),
  excelSaveWorkbook: (payload: Dict) => ipcRenderer.invoke("excel:save-workbook", payload || {}),
  excelCloseWorkbook: (payload: Dict) => ipcRenderer.invoke("excel:close-workbook", payload || {}),
  extractOcr: (payload: Dict) => ipcRenderer.invoke("ocr:extract", payload || {}),
  detectUiTree: (payload: Dict) => ipcRenderer.invoke("uitree:detect", payload || {}),
  saveSettings: (payload: Dict) => ipcRenderer.invoke("settings:set", payload || {}),
  analyzeScreen: (payload: Dict) => ipcRenderer.invoke("analyze:screen", payload || {}),
  analyzeAutomation: (payload: Dict) => ipcRenderer.invoke("analyze:automation", payload || {}),
  showOverlay: (payload: Dict) => ipcRenderer.invoke("overlay:show", payload || {}),
  hideOverlay: () => ipcRenderer.invoke("overlay:hide"),
  automationClick: (payload: Dict) => ipcRenderer.invoke("automation:click", payload || {}),
  automationDoubleClick: (payload: Dict) => ipcRenderer.invoke("automation:double-click", payload || {}),
  automationType: (payload: Dict) => ipcRenderer.invoke("automation:type", payload || {}),
  automationKey: (payload: Dict) => ipcRenderer.invoke("automation:key", payload || {}),
  automationOpenLocalHtml: (payload: Dict) => ipcRenderer.invoke("automation:open-local-html", payload || {}),
  automationOpenUrl: (payload: Dict) => ipcRenderer.invoke("automation:open-url", payload || {}),
  close: () => ipcRenderer.send("close-help-panel")
});

