const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { profileId } = require("./accounts.cjs");
const { randomUUID } = require("node:crypto");

/** Import only the database; never inherit another shop's protected identity. */
async function importShopProfile({
  appData,
  registryFile,
  file,
  info,
  prepare,
  restoreDatabase,
}) {
  if (!info.owner?.id) throw Error("The backup has no active shop owner.");
  const directory = path.join(appData, "Radefy TechMart Shops", randomUUID());
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    // Write the activation-required guard BEFORE a database can look like a legacy install.
    await prepare(directory);
    await restoreDatabase(file, path.join(directory, "vault.sqlite"), {
      validated: info,
    });
    const entry = {
      id: profileId(directory),
      directory,
      ownerId: info.owner.id,
      name: info.owner.storeName,
      username: info.owner.username,
    };
    const rows = readProfileRows(registryFile);
    fs.writeFileSync(registryFile + ".tmp", JSON.stringify([...rows, entry]), {
      mode: 0o600,
    });
    fs.renameSync(registryFile + ".tmp", registryFile);
    return entry;
  } catch (error) {
    // Only this newly allocated directory is removed; existing shops are untouched.
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

/** Temp/activation-smoke folders must never become the live shop after an upgrade. */
function isEphemeralDirectory(directory) {
  if (!directory || typeof directory !== "string") return true;
  let resolved;
  try {
    resolved = path.resolve(directory);
  } catch {
    return true;
  }
  const normalized = resolved.toLowerCase();
  const roots = [os.tmpdir(), process.env.TEMP, process.env.TMP]
    .filter(Boolean)
    .map((value) => {
      try {
        return path.resolve(value).toLowerCase();
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  return roots.some(
    (root) => normalized === root || normalized.startsWith(root + path.sep),
  );
}

function hasStoreDatabase(directory) {
  try {
    return fs.existsSync(path.join(directory, "vault.sqlite"));
  } catch {
    return false;
  }
}

function defaultStoreDirectory(appData) {
  return path.join(appData, "Vault Store");
}

function readProfileRows(registryFile) {
  try {
    const rows = JSON.parse(fs.readFileSync(registryFile, "utf8"));
    return Array.isArray(rows)
      ? rows.filter(
          (p) =>
            p &&
            typeof p.directory === "string" &&
            p.id === profileId(p.directory),
        )
      : [];
  } catch {
    return [];
  }
}

function profileUsable(entry) {
  return (
    !!entry &&
    !entry.hidden &&
    typeof entry.directory === "string" &&
    !isEphemeralDirectory(entry.directory) &&
    hasStoreDatabase(entry.directory)
  );
}

/**
 * Choose the shop directory for this launch.
 * Explicit CLI/env wins; otherwise only a remembered profile that still has a
 * real database is used. Otherwise prefer the established Vault Store folder.
 */
function resolveStartupDirectory({
  appData,
  registryFile,
  lastProfileFile,
  selectedProfileId,
  envDirectory,
  backupDirectory,
}) {
  if (backupDirectory) return path.resolve(backupDirectory);
  if (selectedProfileId) {
    const selected = readProfileRows(registryFile).find(
      (p) => p.id === selectedProfileId,
    );
    if (profileUsable(selected)) return path.resolve(selected.directory);
  }
  if (envDirectory) return path.resolve(envDirectory);

  const profiles = readProfileRows(registryFile);
  let lastProfileId = "";
  try {
    lastProfileId = fs.readFileSync(lastProfileFile, "utf8").trim();
  } catch {}

  const wantedId = selectedProfileId || lastProfileId;
  if (wantedId) {
    const match = profiles.find((p) => p.id === wantedId);
    if (profileUsable(match)) return path.resolve(match.directory);
    // Explicit CLI profile that is missing still falls through to Vault Store
    // so upgrades never open an empty Temp folder.
  }

  const established = defaultStoreDirectory(appData);
  if (hasStoreDatabase(established)) return established;
  return established;
}

/** Drop Temp smoke profiles and keep Vault Store discoverable after upgrades. */
function sanitizeProfiles(profiles, { appData, currentDirectory }) {
  const established = defaultStoreDirectory(appData);
  const next = [];
  for (const entry of profiles) {
    if (!entry || typeof entry.directory !== "string") continue;
    if (
      isEphemeralDirectory(entry.directory) &&
      path.resolve(entry.directory) !== path.resolve(currentDirectory)
    )
      continue;
    if (
      path.resolve(entry.directory) === path.resolve(established) &&
      hasStoreDatabase(established)
    ) {
      next.push({ ...entry, hidden: false });
      continue;
    }
    next.push(entry);
  }
  if (
    hasStoreDatabase(established) &&
    !next.some(
      (p) => path.resolve(p.directory) === path.resolve(established),
    )
  ) {
    next.push({
      id: profileId(established),
      directory: established,
      name: "Vault Store",
      username: "",
    });
  }
  return next;
}

module.exports = {
  importShopProfile,
  isEphemeralDirectory,
  hasStoreDatabase,
  defaultStoreDirectory,
  readProfileRows,
  profileUsable,
  resolveStartupDirectory,
  sanitizeProfiles,
};
