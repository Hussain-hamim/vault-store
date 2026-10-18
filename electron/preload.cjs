const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "vault",
  Object.freeze({
    request: async (command, args, token) => {
      const reply = await ipcRenderer.invoke(
        "vault:command",
        command,
        args,
        token,
      );
      if (!reply.ok) throw new Error(reply.error);
      return reply.result;
    },
    pickFolder: () => ipcRenderer.invoke("vault:folder"),
    pickBackup: () => ipcRenderer.invoke("vault:backup-file"),
    restore: (file, token) => ipcRenderer.invoke("vault:restore", file, token),
    installSchedule: (token) => ipcRenderer.invoke("vault:schedule", token),
    saveInvoicePDF: (id, token) =>
      ipcRenderer.invoke("vault:invoice-pdf", id, token),
    print: () => ipcRenderer.invoke("vault:print"),
  }),
);
