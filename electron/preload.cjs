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
    accounts: (action, id) => ipcRenderer.invoke("vault:accounts", action, id),
    recovery: async (action, args) => {
      const reply = await ipcRenderer.invoke("vault:recovery", action, args);
      if (!reply.ok) throw new Error(reply.error);
      return reply.result;
    },
    activationStatus: () => ipcRenderer.invoke("vault:activation-status"),
    activate: async (key) => {
      const reply = await ipcRenderer.invoke("vault:activate", key);
      if (!reply.ok) throw new Error(reply.error);
      return reply.result;
    },
    openExternal: (url) => ipcRenderer.invoke("vault:open-support", url),
    shareWhatsApp: async (payload, token) => {
      const reply = await ipcRenderer.invoke(
        "vault:whatsapp-share",
        payload,
        token,
      );
      if (!reply.ok) {
        const error = new Error(reply.error);
        error.code = reply.code;
        throw error;
      }
      return reply.result;
    },
    pickFolder: () => ipcRenderer.invoke("vault:folder"),
    pickBackup: () => ipcRenderer.invoke("vault:backup-file"),
    restore: (file, token) => ipcRenderer.invoke("vault:restore", file, token),
    installSchedule: (token) => ipcRenderer.invoke("vault:schedule", token),
    renderPrint: async (job, token) => {
      const reply = await ipcRenderer.invoke("vault:render-print", job, token);
      if (!reply.ok) throw new Error(reply.error);
      return reply.result;
    },
  }),
);
