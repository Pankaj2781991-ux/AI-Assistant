const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bubbleApi", {
  captureScreen: () => ipcRenderer.invoke("capture:screen"),
  openHelpPanel: (payload) => ipcRenderer.send("open-help-panel", payload || {}),
  moveWindow: (payload) => ipcRenderer.send("move-bubble-window", payload || {})
});
