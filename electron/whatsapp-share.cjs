const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");

const codes = new Set([
  "WHATSAPP_NOT_INSTALLED",
  "WHATSAPP_AUTOMATION_DENIED",
  "WHATSAPP_CHAT_NOT_READY",
  "WHATSAPP_ATTACH_FAILED",
  "WHATSAPP_SEND_UNCONFIRMED",
  "WHATSAPP_UNSUPPORTED",
  "WHATSAPP_BUSY",
]);
function shareError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

// Never replace a PDF that WhatsApp may still be reading from an earlier share.
async function saveSharePdf(directory, filename, bytes) {
  for (let number = 1; number <= 1000; number++) {
    const target = path.join(
      directory,
      number === 1
        ? filename
        : `${path.basename(filename, path.extname(filename))} (${number})${path.extname(filename)}`,
    );
    try {
      await fs.writeFile(target, bytes, { flag: "wx", mode: 0o600 });
      return target;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  throw new Error("Could not choose an unused PDF filename.");
}

/** One awaited native operation; starting osascript/PowerShell is not success. */
function createWhatsAppSender({
  app,
  shell,
  platform = process.platform,
  run = execFile,
  checkPermissions = async () => {},
}) {
  let busy = false;
  return async function send({ phone, pdfPath, format = "pdf", text = "" }) {
    if (busy) throw shareError("WHATSAPP_BUSY");
    if (!["darwin", "win32"].includes(platform))
      throw shareError("WHATSAPP_UNSUPPORTED");
    if (!/^[1-9]\d{6,14}$/.test(phone))
      throw new Error("Invalid WhatsApp phone.");
    busy = true;
    let folder;
    try {
      const pdf = path.resolve(pdfPath);
      const handle = await fs.open(pdf, "r");
      try {
        const header = Buffer.alloc(8);
        await handle.read(header, 0, 8, 0);
        if (
          format === "image"
            ? !header.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : format !== "pdf" || header.subarray(0, 5).toString() !== "%PDF-"
        )
          throw new Error("Invalid WhatsApp attachment.");
      } finally {
        await handle.close();
      }
      folder = await fs.mkdtemp(
        path.join(app.getPath("temp"), "radefy-whatsapp-"),
      );
      const captionPath = path.join(folder, "caption.txt");
      const routePath = path.join(folder, "route.txt");
      const caption = String(text).slice(0, 1000);
      // Route by phone in the native picker. Never leave an invoice greeting
      // in a chat draft when file attachment or OS permissions fail.
      const routeText = phone;
      await checkPermissions();
      await fs.writeFile(captionPath, caption, { mode: 0o600 });
      await fs.writeFile(routePath, routeText, { mode: 0o600 });
      const scriptName =
        platform === "darwin"
          ? "whatsapp-attach.applescript"
          : "whatsapp-attach.ps1";
      const scriptPath = path.join(folder, scriptName);
      if (platform === "win32") {
        // Windows PowerShell 5 requires a BOM for UTF-8 localized selectors.
        await fs.writeFile(
          scriptPath,
          "\ufeff" +
            (await fs.readFile(path.join(__dirname, scriptName), "utf8")),
          { mode: 0o600 },
        );
      } else await fs.copyFile(path.join(__dirname, scriptName), scriptPath);
      try {
        await shell.openExternal("whatsapp://");
      } catch {
        throw shareError("WHATSAPP_NOT_INSTALLED");
      }
      const executable =
        platform === "darwin"
          ? "/usr/bin/osascript"
          : path.win32.join(
              process.env.SystemRoot || "C:\\Windows",
              "System32",
              "WindowsPowerShell",
              "v1.0",
              "powershell.exe",
            );
      const args =
        platform === "darwin"
          ? [scriptPath, pdf, captionPath, routePath]
          : [
              "-STA",
              "-NoProfile",
              "-NonInteractive",
              "-ExecutionPolicy",
              "Bypass",
              "-File",
              scriptPath,
              "-PdfPath",
              pdf,
              "-CaptionPath",
              captionPath,
              "-RoutePath",
              routePath,
            ];
      await new Promise((resolve, reject) => {
        run(
          executable,
          args,
          { windowsHide: true, timeout: 120000, maxBuffer: 64 * 1024 },
          (error, stdout = "", stderr = "") => {
            if (error) {
              const message = `${stderr}\n${stdout}\n${error.message}`;
              const code = [...codes].find((value) => message.includes(value));
              reject(
                shareError(
                  code ||
                    (/not authorized|not allowed|assistive access|-1743/i.test(
                      message,
                    )
                      ? "WHATSAPP_AUTOMATION_DENIED"
                      : "WHATSAPP_SEND_UNCONFIRMED"),
                ),
              );
            } else if (stdout.trim() !== "RADEFY_WHATSAPP_SUBMITTED") {
              reject(shareError("WHATSAPP_SEND_UNCONFIRMED"));
            } else resolve();
          },
        );
      });
      // Submitted means the local preview closed after Send, not remote delivery.
      return {
        opened: true,
        submitted: true,
        sent: true,
        pasted: true,
        pdfPath: pdf,
        downloadPath: pdf,
      };
    } finally {
      if (folder)
        await fs.rm(folder, { recursive: true, force: true }).catch(() => {});
      busy = false;
    }
  };
}

module.exports = { createWhatsAppSender, saveSharePdf, shareError };
