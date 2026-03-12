type AnyRecord = Record<string, unknown>;

interface BubbleApi {
  captureScreen: () => Promise<AnyRecord>;
  openHelpPanel: (payload: AnyRecord) => void;
  moveWindow: (payload: AnyRecord) => void;
}

interface PanelApi {
  onScreenCaptured: (callback: (payload: AnyRecord) => void) => void;
  onUpdateStatus: (callback: (payload: AnyRecord) => void) => void;
  getSettings: () => Promise<AnyRecord>;
  getUpdateState: () => Promise<AnyRecord>;
  checkForUpdates: () => Promise<AnyRecord>;
  downloadUpdate: () => Promise<AnyRecord>;
  installUpdate: () => Promise<AnyRecord>;
  captureScreen: () => Promise<AnyRecord>;
  captureFullPageUrl: (payload: AnyRecord) => Promise<AnyRecord>;
  detectActiveBrowserUrl: () => Promise<AnyRecord>;
  getLatestDomMap: () => Promise<AnyRecord>;
  getBrowserState: () => Promise<AnyRecord>;
  getBrowserDomMap: () => Promise<AnyRecord>;
  captureBrowserPage: () => Promise<AnyRecord>;
  browserOpenUrl: (payload: AnyRecord) => Promise<AnyRecord>;
  browserExecuteStep: (payload: AnyRecord) => Promise<AnyRecord>;
  desktopLaunchApp: (payload: AnyRecord) => Promise<AnyRecord>;
  desktopOpenPath: (payload: AnyRecord) => Promise<AnyRecord>;
  desktopListWindows: () => Promise<AnyRecord>;
  desktopFocusWindow: (payload: AnyRecord) => Promise<AnyRecord>;
  desktopGetForegroundWindow: () => Promise<AnyRecord>;
  desktopGetForegroundUiTree: () => Promise<AnyRecord>;
  excelOpenWorkbook: (payload: AnyRecord) => Promise<AnyRecord>;
  excelReadRange: (payload: AnyRecord) => Promise<AnyRecord>;
  excelSetCell: (payload: AnyRecord) => Promise<AnyRecord>;
  excelWriteRange: (payload: AnyRecord) => Promise<AnyRecord>;
  excelSaveWorkbook: (payload: AnyRecord) => Promise<AnyRecord>;
  excelCloseWorkbook: (payload: AnyRecord) => Promise<AnyRecord>;
  extractOcr: (payload: AnyRecord) => Promise<AnyRecord>;
  detectUiTree: (payload: AnyRecord) => Promise<AnyRecord>;
  saveSettings: (payload: AnyRecord) => Promise<AnyRecord>;
  analyzeScreen: (payload: AnyRecord) => Promise<AnyRecord>;
  analyzeAutomation: (payload: AnyRecord) => Promise<AnyRecord>;
  showOverlay: (payload: AnyRecord) => Promise<AnyRecord>;
  hideOverlay: () => Promise<AnyRecord>;
  automationClick: (payload: AnyRecord) => Promise<AnyRecord>;
  automationDoubleClick: (payload: AnyRecord) => Promise<AnyRecord>;
  automationType: (payload: AnyRecord) => Promise<AnyRecord>;
  automationKey: (payload: AnyRecord) => Promise<AnyRecord>;
  automationOpenLocalHtml: (payload: AnyRecord) => Promise<AnyRecord>;
  automationOpenUrl: (payload: AnyRecord) => Promise<AnyRecord>;
  close: () => void;
}

interface OverlayApi {
  onOverlayData: (callback: (payload: AnyRecord) => void) => void;
}

interface Window {
  bubbleApi: BubbleApi;
  panelApi: PanelApi;
  overlayApi: OverlayApi;
}

declare const chrome: any;
