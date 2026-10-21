# Vault Store development and release notes

Vault Store is an offline React, Electron and SQLite application for one electronics store computer. Currency is Afghan afghani (AFN, shown as AF); tax calculations are disabled. The browser preview uses a separate, clearly labeled demonstration database. Packaged desktop apps start with an empty store and require the owner to create their own account.

## Run locally

Requires Node 22.16 or newer for the bundled SQLite module.

```sh
npm install
npm run dev
```

Open http://localhost:4173. The demo is stored in `.local/vault-demo.sqlite`. The development demo owner is `owner`, password `vault-demo-2026`; automatic demo sign-in is enabled only when the database is marked as a demo. Production setup never creates a default account. Do not use the demo store for live business records.

For the desktop shell, keep the development server running and run `npm run desktop`. For a fully offline desktop build run `npm run package:mac` or `npm run package:win`. Release builds load bundled files; they do not need the local development server. All fonts, icons and product images are included.

## Implemented workflows

- Inventory opens the complete paginated product catalog with company, model, quantity, average cost of remaining stock and selling price. With no remaining stock it shows the catalog unit cost. Cost columns respect user permissions.
- New products include a catalog unit cost and optional opening stock quantity. Opening stock posts against equity and requires owner access; it does not create supplier debt or reduce cash. Editing the catalog cost does not revalue previously received stock.
- Product models and variants, brand/model/specifications, pricing, stock locations and reorder thresholds. Stock is quantity-tracked only.
- Multi-product purchase receiving, supplier credit, cash/credit sales, partial payments, payment allocation to oldest invoices, customer and supplier profiles and ledgers.
- Full-page New Bill workspace and separate Invoice History tab. Invoices support view, edit, hard delete, download, printing and returns.
- Original-cost reversal, partial quantity returns, purchase returns, stock adjustments and owner opening stock.
- Expenses, owner capital movements, opening customer/supplier debt, daily cashbook, gross and net profit, trial balance, balance sheet, inventory valuation, stock aging and current overdue balances.
- Offline owner/staff accounts, custom module permissions, account disabling, audit records, closed accounting periods.
- Desktop invoices download as PDF using the native save dialog. The browser development preview downloads a self-contained printable HTML invoice and also offers Print / save PDF. Page/report exports use CSV.
- Consistent SQLite backup API snapshots, integrity/foreign-key/checksum validation, multiple configured connected destinations, a rolling 30-day window with one latest snapshot per business date, native scheduler setup and validated restore with a safety copy.

## Data and accounting rules

Money is stored as integer hundredths of AFN. Input permits at most two decimal places. Sales and purchase posting atomically commits the invoice, stock movement, batch allocation, journal and audit. Duplicate request keys return the existing transaction. Stock uses FIFO costing. The ledger is double entry and every posting must balance. Owners and managers with sales permission can edit sale invoices or permanently delete them. Both operations restore the original cost allocations and update inventory, cash, debt and report summaries atomically; failed changes roll back completely. Edits preserve the invoice ID and number and enforce a revision check. Hard deletion requires typing the invoice number and retains an administrative audit reference. Closed-period invoices and invoices with linked returns or later payment receipts cannot be edited or deleted. Invoice product names, SKUs, and specifications are captured when lines are posted, so later catalog edits do not rewrite old invoices.

Opening balances post against equity. Inventory purchases are assets, not expenses. Debt collections and supplier payments do not create profit. Sales returns reduce receivables first and refund the remainder. Purchase returns reduce payables first and recover previously paid amounts. Backdated stock movements preceding the latest movement for a product are rejected to preserve costing chronology.

The daily and contact summaries are updated by SQLite triggers in the same transaction as journal entries. They can be rebuilt from the ledger. Version 0.1 is a pre-release initial schema; released migrations must use a new schema version and a pre-migration backup.

The live database is always on the local disk. Do not place it in a network folder or synchronize the live database through a cloud-drive client. A future multi-computer version should put the business services behind an API and migrate to a server database as appropriate; independent offline synchronization is a separate design problem.

## Backups

In the desktop app, add destination folders under Backups and create the first recovery copy. Use a separate physical drive. The native schedule is installed only when the user selects Install daily desktop schedule. It checks hourly and backs up once 24 hours have elapsed since the last fully successful automatic run. While the app is open it also checks every minute. Failed destinations retry after an hour. Unavailable/off/asleep computers catch up when the helper next runs; exact wall-clock execution while powered off is impossible.

Windows uses Task Scheduler under the current desktop account. macOS uses a user LaunchAgent, so the desktop user must be signed in. No network access or account credentials are needed. An unmounted drive cannot receive a copy. Cross-computer copies require connected storage or an optional future network destination.

Files are currently unencrypted SQLite snapshots with a SHA256 manifest. Protect the destination with operating-system permissions and disk encryption. Keep each `.sqlite` file with its `.sqlite.json` manifest. Backup cleanup touches only recognized Vault files inside the dedicated Vault Store Backups subfolder. Failed copies do not trigger cleanup. Safety copies made before restoration are separate and are retained for manual recovery.

Restoring is an owner-only desktop action. The app checks the chosen file, asks for final confirmation, closes its database worker, saves the existing database in `restore-safety/`, replaces the database, and restarts. A restore includes the user accounts and store settings that existed at backup time.

## Verification

```sh
npm test
npm run build
npm run test:sites
npm run benchmark -- 1000000
```

The benchmark is synthetic: one million journal rows, 50,000 products, and a limited date/account distribution. Measurements in `benchmark-results.json` are a baseline on the recorded Mac, not a claim that billions of arbitrary transactions are fast. Large datasets and the actual store PC require representative load tests, disk-capacity planning and backup-duration testing.

Browser UI verification covers product creation, purchase receiving, partial-payment sale, invoice inspection, report tabs and navigation. The automated core tests cover balanced postings, FIFO, rounding, returns, rollback, permissions, opening balances, period locks, cursor pagination, backup verification, restore and retention.

## Release requirements and current limits

This is a functional pre-release for review. The Mac review build uses a local ad hoc signature. Public distribution still needs an Apple Developer signing identity/notarization and a Windows signing identity. Windows runtime behavior and its Task Scheduler integration must be validated on a real Windows machine; building an EXE on a Mac is not Windows validation.

The current purchasing flow records received purchases directly; purchase orders with partial receiving, custom-PC assembly, repair jobs, multi-currency, arbitrary attachments, encrypted backup archives, automatic drive enrollment and multi-computer synchronization are not included. Report and export tables state their page/top-100/latest-500 limits. Whole-history export jobs and historical aged-debt reporting need a dedicated background export/report path.

Receipt numbering, tax policy, period close procedure and the owner’s actual opening balances must be checked with the store before real use. Test recovery on a second computer before relying on backups for live records.

## Workflow update verification (October 18, 2026)

The inventory and billing update was checked with automated tests and a TypeScript/production build. Visual verification was intentionally stopped at the user’s request. Existing 0.1.0 installers are from the earlier release; rebuild the desktop package to include these source changes. The running native app and its live store data were not modified.
