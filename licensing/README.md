# Client activation — administrator guide

## Already deployed

The activation service is live at:

https://radefy-techmart-activation.radefy-systems.workers.dev/health

- Cloudflare account: `2be903b56be70838b8da700bfd6ba7d9`
- Worker and database: `radefy-techmart-activation`
- D1 ID: `bc7354a8-2d68-4ab9-9c34-3b2af10c9110`
- License records live in `licenses`; owner recovery uses `recovery_owners`, `recovery_codes` and `recovery_enrollments`. Cloudflare may also show its own internal metadata tables.
- Production app configuration: `shared/licensing.json` (public endpoint/public key only).
- Used disposable test licenses are labelled **Disposable activation verification** and **Disposable concurrent activation verification**. They are not customer keys; leave them for audit/testing.

You do not need to repeat cloud setup or create an API token to ask Codex to issue keys through the connected Cloudflare account.

## Easiest option: ask here — no Terminal or extra token

Tell Codex: **“Generate one TechMart activation key for [client/store name].”** Codex can create the key directly through the existing Cloudflare connection and give it to you. You can also ask: **“Show my unused activation keys”** or **“Check whether the key ending in XXXX is used.”** Only the final four characters and status are stored for display; full keys cannot be retrieved after issuance, so save the original key securely.

Give the key to the client, then install the packaged app and enter the key while that PC is online. That is all the client needs; they never need Cloudflare credentials.

The numbered instructions below are an **optional self-service Terminal workflow**. Use them only if you want to manage keys yourself without this chat. Run commands from the repository root. Node 22.16+ is required (the app's existing runtime requirement).

## 1. Terminal credentials

**This Mac is already configured.** The script automatically reads your token from `.local/activation/cloudflare-api-token`, with owner-only file permissions. It is ignored by Git and excluded from the client installer. You do not need to export a variable or paste the token again.

Check the saved token and database permissions at any time:

```sh
npm run license:keys -- verify
```

The verification performs a write-permission check that changes no license records. If an old `CLOUDFLARE_API_TOKEN` environment variable is set, it takes priority over the saved file; unset it to use the saved token.

The following instructions are only for another administrator computer or a replacement token:

Open Cloudflare Dashboard → My Profile → API Tokens → Create Custom Token.
Give the token **Account → D1 → Edit**, restricted to the account above. Do not give this token to clients or add it to the app.

For macOS Terminal/zsh, enter it without putting the value in shell history:

```sh
read -s 'CLOUDFLARE_API_TOKEN?Cloudflare D1 token: '
export CLOUDFLARE_API_TOKEN
```

For PowerShell:

```powershell
$token = Read-Host 'Cloudflare D1 token' -AsSecureString
$env:CLOUDFLARE_API_TOKEN = [System.Net.NetworkCredential]::new('', $token).Password
```

The scripts read this environment variable first, then fall back to the protected local file; they never print the token. Clear the variable when finished (`unset CLOUDFLARE_API_TOKEN` on macOS, `Remove-Item Env:CLOUDFLARE_API_TOKEN` on PowerShell).

## 2. Generate a client key

```sh
npm run license:keys -- create --client "Pamir Technology" --count 1
```

The output contains the client label, license ID and a key shaped like `RADE-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`.
Save that output securely and give that key to the intended client. The full key is shown only during creation; the database stores only its SHA-256 hash and final four characters. It cannot recover a lost original key. The label is your private tracking label, not a cloud shop account.

To make several keys:

```sh
npm run license:keys -- create --client "New client batch" --count 5
```

Each generated key is independent and activates one PC. Do not use sample placeholders as real keys.

## 3. Check whether a key is used

```sh
npm run license:keys -- list
npm run license:keys -- list --limit 100 --offset 100
```

`unused` means no PC has claimed it. `activated` shows its first activation date. Match the license ID or final four characters against the output saved at issuance. No raw key or raw hardware identifier is exposed by the list command.

You can also open Cloudflare Dashboard → Workers & Pages → D1 → `radefy-techmart-activation` → Console:

```sql
SELECT id, client_label, key_suffix, created_at, activated_at,
       CASE WHEN device_hash IS NULL THEN 'unused' ELSE 'activated' END AS status
FROM licenses ORDER BY created_at DESC;
```

## 4. Build the client installer

```sh
npm run license:check
npm run package:mac:dmg
```

For Windows, run the Windows packaging workflow on Windows:

```sh
npm run package:win
```

The release scripts check the HTTPS endpoint and Ed25519 public key configuration before packaging. They do not require an internet connection to check the configuration itself. The configured activation service must remain deployed for new activations.

Only public verification information is packaged. Administrator scripts, Cloudflare tokens, the Worker private key and `.local/` files are excluded by the existing Electron file allowlist. Production enforcement uses `app.isPackaged`, not an environment variable that clients can toggle.

`npm run desktop:dev` and the browser demo intentionally remain unlicensed developer workflows. Use packaged releases when installing for clients.

## 5. Install and activate for a client

1. Install the packaged app on the client PC.
2. Connect that PC to the internet.
3. Open TechMart. A fresh installation displays **Activate TechMart**.
4. Enter the issued key and choose **Activate this computer**.
5. After successful online activation, the normal owner setup page opens. Enter the store name, owner name, username and password.
6. The client can now disconnect from the internet and use the app indefinitely.

Usernames, passwords, products, invoices and accounts stay in local SQLite. Only the activation key and a product-specific device hash are sent to the activation endpoint over HTTPS. The cloud stores the key hash, client label and activation binding.

An already initialized store upgraded from the old version receives a local, protected legacy exemption and keeps its normal login. A fresh installation stays locked even if its SQLite database is later replaced. The exemption deliberately permits old-installation/database-copy migration; this is not comprehensive licensing for legacy copies.

## 6. Recovery rules

- **Network timeout after submitting:** retry the same key on the same PC. The server returns the same signed receipt; the key is not lost.
- **Key already used on another PC:** issue a new key yourself. There is no public transfer/reset endpoint.
- **Lost receipt on the same identified PC:** reconnect and enter the same key. Keep your issued-key records so you can provide it again.
- **Reinstalled OS or changed hardware identity:** it may count as a replacement PC and need a new key. Windows MachineGuid may change on reinstall.
- **Activation cannot be saved securely:** unlock the OS keychain/credential store, check disk space and profile permissions, then retry. Do not delete the shop database.
- **Unavailable hardware ID:** activation fails closed; contact support. There is no random-ID fallback.
- **Corrupt/foreign local activation:** it does not qualify for a legacy exemption. Enter the proper key or contact support.
- **Replacing an activated PC:** a new key does not remotely disable the old permanently offline installation. Arrange retirement of the old installation with the client.

The protected receipt is `activation-v1.dat`; the separate installation marker is `installation-v1.dat` in the app's existing Vault Store userData directory. Both are outside SQLite and shop backups. Do not distribute it to clients or copy it between PCs. Normal app updates preserve it.

## Cloud setup from scratch / redeployment

These steps are reference instructions; the current service and signing key already exist. Do not regenerate the current signing key or replace `shared/licensing.json` casually: installed apps pin that public key.

1. Open Cloudflare Dashboard → Workers & Pages to initialize workers.dev if needed. The current subdomain is `radefy-systems`.
2. Authenticate Wrangler for the correct account:

   ```sh
   npx wrangler@4.152.0 login
   npx wrangler@4.152.0 whoami
   ```

3. For a genuinely new account, create D1 and update the IDs in `licensing/wrangler.jsonc` and `licensing/deployment.json`:

   ```sh
   npx wrangler@4.152.0 d1 create radefy-techmart-activation
   ```

4. Create the single application table (safe to repeat):

   ```sh
   npm run license:keys -- schema
   ```

5. Only for a new independent service, generate signing files:

   ```sh
   npm run license:keys -- init-signing
   ```

   This refuses to overwrite an existing private key. The current deployment's files already exist in `.local/activation/`. Securely back up this directory outside the repository. Never share its private key or the base64 private-key file. Cloudflare retains its copy as a Worker secret.

6. Validate the Worker bundle, deploy code and set its signing secret from a file without printing it:

   ```sh
   npx wrangler@4.152.0 deploy --config licensing/wrangler.jsonc --dry-run --outdir .local/activation/worker-build
   npx wrangler@4.152.0 deploy --config licensing/wrangler.jsonc
   npx wrangler@4.152.0 secret put SIGNING_PRIVATE_KEY --config licensing/wrangler.jsonc < .local/activation/signing-private-key.base64
   ```

   The redirect command is for macOS/POSIX shells. On PowerShell use:

   ```powershell
   Get-Content .local/activation/signing-private-key.base64 -Raw | npx wrangler@4.152.0 secret put SIGNING_PRIVATE_KEY --config licensing/wrangler.jsonc
   ```

   Redeploying the existing service normally preserves its secret; re-upload only the same backed-up signing key. A new independent service also needs its endpoint and public PEM from `.local/activation/signing-public-key.pem` copied to `shared/licensing.json` before building clients. Never put the private PEM in that file. Key rotation requires retaining old verification keys and a coordinated app/service update; automatic rotation is not implemented.

7. Verify `/health`, generate a disposable key, activate it once, retry on the same device, and verify that another device is rejected. Avoid testing with customer keys.

The rate limiter allows approximately 10 attempts per minute per IP at each Cloudflare location, so a shared shop network can temporarily throttle simultaneous installations. Wait a minute and retry. One-device exclusivity is enforced by an atomic D1 update, independently of rate-limit accuracy. See Cloudflare's [rate-limit documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

## Validation commands

Keep `npm run dev` running for the regular UI smoke tests.

```sh
npm test
npm run build
npm run test:sites
npm run test:activation:desktop
npm run test:brand:desktop
npm run test:print:desktop
```

The activation desktop test uses the actual packaged main-process IPC handlers with an isolated SQLite/profile and test-only OS/network adapters. It never activates the developer's store. Unit tests reopen encrypted receipt state with the network disabled and cover the atomic claim, invalid input, copied receipts, save failures, legacy migration and device-ID parsing.

Permanent offline licenses cannot be remotely revoked. Normal file copying is blocked by hardware binding and signed receipts; patched binaries or spoofed/cloned hardware identities are outside this mechanism's guarantee.

## Owner account recovery

Normal sign-in remains offline. Owner names, usernames and store names sync to D1; passwords and their hashes never leave the PC. Only the owner account is recoverable through this service.

New installations enroll automatically after activation and account setup. Setup still works without internet: metadata synchronizes at the next launch or every five minutes while open. Settings → Owner account recovery shows the installation reference, registration state and last successful synchronization. Its Check recovery status button retries immediately.

### Existing installations / legacy stores

1. Open Forgot login? or Settings → Owner account recovery on the client's PC.
2. Have the client share the installation reference and the device reference/public key under Support details. These are public identifiers; never request their password.
3. Verify ownership using your existing client records and established contact number. A key or reference alone is not proof of ownership.
4. From the project folder on your administrator computer:

```sh
npm run license:recovery -- approve --installation INSTALLATION_ID --device DEVICE_HASH --public-key PUBLIC_KEY
```

5. This approves that exact computer for 30 minutes without generating another client code. Ask the client to open Forgot login? or click Check recovery status while online. Registration completes automatically; then issue their one-time recovery code using the command below.

### Forgotten username or password

```sh
npm run license:recovery -- owners --search "Client name"
npm run license:recovery -- issue --installation INSTALLATION_ID
```

Verify the caller first. The second command prints a random recovery code once; only its hash is stored in D1. Send it privately to the client. It expires after 30 minutes, and issuing a replacement invalidates the previous code.

The client opens Forgot login?, connects to internet and enters only the latest recovery code. The app opens the store immediately. Their password stays unchanged. They may optionally set a new password in Settings → Owner account recovery. Existing sessions are invalidated; activation, employee passwords and shop data are retained.

If recovery is interrupted, retry the same code. The pending signed authorization is protected locally for safe retries. Older app versions retain their supported code-and-new-password reset path. Used, expired and wrong-store codes have distinct messages.

Recovery requires the original protected installation identity. Shop backups do not contain `owner-recovery-v1.dat`; restoring a shop on a replacement PC requires separate activation/registration. This is not cloud backup or cloud login.

### Recovery service deployment / checks

```sh
npm run license:keys -- schema
npx wrangler@4.152.0 deploy --config licensing/wrangler.jsonc --dry-run --outdir .local/activation/worker-build
npx wrangler@4.152.0 deploy --config licensing/wrangler.jsonc
node --test tests/recovery.test.mjs
npm run test:recovery:live
npm run package:mac
```

`schema` adds the nullable recovery public-key column to existing license tables and creates the recovery tables without modifying activation bindings. Deployment preserves the existing signing secret. Live verification creates clearly labeled disposable records and an isolated temporary store; it never changes a real customer's credentials. Administrator tokens remain in the protected local credential file and are never included in client builds.

### Readable names in Cloudflare tables

All four application tables expose `name` (owner's full name), `username` and `store_name` directly in the D1 table browser. Registration and later synchronization keep these display labels aligned; issuing codes also copies the registered owner's labels. They are labels only and are never used to authorize activation or recovery. Existing records are backfilled by `npm run license:keys -- schema`.

Before a client creates an account, their username is not yet known. You can optionally supply labels when generating a key:

```sh
npm run license:keys -- create --client "Client label" --shop "Shop name" --name "Owner name" --username "Known username" --count 1
```

Administrator approval accepts the same optional `--shop`, `--name`, and `--username` labels before registration. Registered account details replace provisional labels after synchronization. For unused keys, the client label is used as the initial shop label unless `--shop` is supplied.

### Generate a code by shop name

```sh
npm run license:recovery -- issue --shop "Hussain tech"
```

The output includes shop name, username and installation reference with the code. If several installations have the same shop name, use the exact `--installation` reference instead. The generic application retains its original default profile. On this Mac, use the explicit profile launch command below to open Hussain tech without switching to Enzo.

```sh
RADEFY_USER_DATA="/Users/hussain/Library/Application Support/Radefy TechMart Activation Test" "./release/mac-arm64/Radefy TechMart.app/Contents/MacOS/Radefy TechMart"
```

Quit any already-running copy of that same profile before relaunching.
