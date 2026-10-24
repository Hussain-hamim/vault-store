const path = require("node:path");
const brand = require("../shared/brand.json");
// Keep the established profile and installer ID so rebranding never opens an empty store.
const userDataPath = (appData, override) =>
  override || path.join(appData, "Vault Store");
module.exports = { brand, userDataPath };
