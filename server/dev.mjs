import http from "node:http";
import path from "node:path";
import { createWorker } from "./client.mjs";
const db = createWorker(path.resolve(".local/vault-demo.sqlite"), true);
const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method !== "POST" || req.url !== "/api/command") {
      res.writeHead(404);
      return res.end(JSON.stringify({ error: "Not found" }));
    }
    const origin = req.headers.origin;
    if (
      origin &&
      ![
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://terminal.local:4173",
      ].includes(origin)
    )
      throw new Error("Origin is not allowed.");
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 1_000_000) throw new Error("Request too large.");
    }
    const { command, args, token } = JSON.parse(raw);
    const result = await db.request(command, args, token);
    res.end(JSON.stringify({ result }));
  } catch (e) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: e.message }));
  }
});
server.listen(4174, "127.0.0.1", () =>
  console.log("Vault local database ready on 127.0.0.1:4174"),
);
const timer = setInterval(
  () =>
    db
      .request("_automaticBackup")
      .catch((e) => console.error("Backup:", e.message)),
  60_000,
);
timer.unref();
process.on("SIGTERM", () => {
  server.close();
  db.close();
});
