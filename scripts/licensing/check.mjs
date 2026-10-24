import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { validateConfig } = require("../../electron/licensing.cjs");
validateConfig(require("../../shared/licensing.json"));
console.log(
  "Production activation endpoint and Ed25519 public verification key are configured. Private signing files are not packaged.",
);
