import { contextBridge, ipcRenderer } from "electron";

type Dict = Record<string, unknown>;

contextBridge.exposeInMainWorld("bubbleApi", {
  captureScreen: () => ipcRenderer.invoke("capture:screen"),
  openHelpPanel: (payload: Dict) => ipcRenderer.send("open-help-panel", payload || {}),
  moveWindow: (payload: Dict) => ipcRenderer.send("move-bubble-window", payload || {})
});

