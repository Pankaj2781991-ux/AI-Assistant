import { contextBridge, ipcRenderer } from "electron";

type Dict = Record<string, unknown>;

contextBridge.exposeInMainWorld("overlayApi", {
  onOverlayData: (callback: (payload: Dict) => void) => {
    ipcRenderer.on("overlay-data", (_event, payload) => callback(payload));
  }
});

