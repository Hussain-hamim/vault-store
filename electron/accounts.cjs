const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
class Accounts {
  constructor(directory, safeStorage) {
    this.file = path.join(directory, "remembered-accounts-v1.dat");
    this.safe = safeStorage;
    this.state = { active: "", users: [] };
    try {
      this.state = JSON.parse(
        this.safe.decryptString(fs.readFileSync(this.file)),
      );
    } catch {}
  }
  save() {
    if (!this.safe.isEncryptionAvailable())
      throw Error("Protected account storage is unavailable.");
    const temp = this.file + ".tmp";
    fs.writeFileSync(
      temp,
      this.safe.encryptString(JSON.stringify(this.state)),
      { mode: 0o600 },
    );
    fs.renameSync(temp, this.file);
  }
  remember(user, token) {
    let entry = this.state.users.find((u) => u.id === user.id);
    if (!entry) this.state.users.push((entry = { id: user.id }));
    Object.assign(entry, { username: user.username, name: user.name, token });
    this.state.active = user.id;
    this.save();
  }
  token() {
    return (
      this.state.users.find((u) => u.id === this.state.active)?.token || ""
    );
  }
  logout(token) {
    for (const user of this.state.users)
      if (user.token === token) user.token = "";
    this.save();
  }
  select(id) {
    if (!this.state.users.some((u) => u.id === id))
      throw Error("Unknown account.");
    this.state.active = id;
    this.save();
  }
  list() {
    return this.state.users.map(({ token, ...user }) => ({
      ...user,
      signedIn: !!token,
    }));
  }
}
const profileId = (directory) =>
  crypto.createHash("sha256").update(directory).digest("hex");
module.exports = { Accounts, profileId };
