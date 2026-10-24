import { existsSync, lstatSync, readFileSync } from "node:fs";
export const credentialFile = new URL(
  "../../.local/activation/cloudflare-api-token",
  import.meta.url,
);
export function readAdminToken({
  env = process.env,
  file = credentialFile,
} = {}) {
  let token = env.CLOUDFLARE_API_TOKEN?.trim();
  if (!token && existsSync(file)) {
    const info = lstatSync(file);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      (process.platform !== "win32" &&
        ((info.mode & 0o077) !== 0 || info.uid !== process.getuid()))
    ) {
      throw new Error(
        "The local Cloudflare credential file must belong to your user and have permissions 600.",
      );
    }
    token = readFileSync(file, "utf8").trim();
  }
  if (!token)
    throw new Error(
      "Set CLOUDFLARE_API_TOKEN or configure the protected local administrator credential file on this computer.",
    );
  if (!/^[A-Za-z0-9_-]{20,256}$/.test(token))
    throw new Error(
      "The Cloudflare administrator token has an invalid format.",
    );
  return token;
}
