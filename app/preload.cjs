// Preload runs in an isolated context. The web app currently uses browser
// dialogs (window.prompt) for import/export, so nothing needs to be exposed.
// To add native file save/open, expose a minimal, audited API here:
//
//   const { contextBridge, ipcRenderer } = require("electron");
//   contextBridge.exposeInMainWorld("api", {
//     saveFile: (text) => ipcRenderer.invoke("save-file", text),
//     openFile: () => ipcRenderer.invoke("open-file"),
//   });
