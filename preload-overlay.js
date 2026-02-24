const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("overlayApi", {
  onOverlayData: (callback) => {
    ipcRenderer.on("overlay-data", (_event, payload) => callback(payload));
  }
});
