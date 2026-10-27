# Radefy TechMart development and release notes

Radefy TechMart is an offline React, Electron and SQLite application for one electronics store computer. Currency is Afghan afghani (AFN, shown as AF); tax calculations are disabled. The browser preview uses a separate, clearly labeled demonstration database. Packaged desktop apps start with an empty store and require the owner to create their own account.

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
- Company/model-specific product photos from a bundled offline catalog; exact JPG/PNG/WebP uploads in product forms and new resale intake. Photos are reused for the same company/model and loaded separately from list rows. Live SQLite keeps uploaded media; backup copies restore studio illustrations instead of camera/file photos. Unlisted models use explicitly labeled same-company references or neutral icons. See [behavior, coverage and source credits](product-photos.md).
- Multi-product purchase receiving, supplier credit, cash/credit sales, partial payments, payment allocation to oldest invoices, customer and supplier profiles and ledgers.
- Full-page New Bill workspace and separate Invoice History tab. Invoices support view, edit, hard delete, download, printing and returns.
- Original-cost reversal, partial quantity returns, purchase returns, stock adjustments and owner opening stock.
- Expenses, owner capital movements, opening customer/supplier debt, daily cashbook, gross and net profit, trial balance, balance sheet, inventory valuation, stock aging and current overdue balances.
- Offline owner/staff accounts, custom module permissions, account disabling, audit records, closed accounting periods.
- Desktop invoices download as PDF using the native save dialog. The browser development preview uses the system print dialog for printing and Save as PDF. Reports also export numeric CSV files.
- Consistent SQLite backup API snapshots, integrity/foreign-key/checksum validation, multiple configured connected destinations, a rolling 30-day window with one latest snapshot per business date, native scheduler setup and validated restore with a safety copy.

## Data and accounting rules

Money is stored as integer hundredths of AFN. Input permits at most two decimal places. Sales and purchase posting atomically commits the invoice, stock movement, batch allocation, journal and audit. Duplicate request keys return the existing transaction. Accessories/storage use FIFO costing; individually tracked computers, phones and tablets use the exact selected device’s receipt cost. The ledger is double entry and every posting must balance. Owners and managers with sales permission can edit sale invoices or permanently delete them. Both operations restore the original cost allocations and update inventory, cash, debt and report summaries atomically; failed changes roll back completely. Edits preserve the invoice ID and number and enforce a revision check. Hard deletion requires typing the invoice number and retains an administrative audit reference. Closed-period invoices and invoices with linked returns or later payment receipts cannot be edited or deleted. Invoice product names, SKUs, and specifications are captured when lines are posted, so later catalog edits do not rewrite old invoices.

Opening balances post against equity. Inventory purchases are assets, not expenses. Debt collections and supplier payments do not create profit. Sales returns reduce receivables first and refund the remainder. Purchase returns reduce payables first and recover previously paid amounts. Backdated stock movements preceding the latest movement for a product are rejected to preserve costing chronology.

The daily and contact summaries are updated by SQLite triggers in the same transaction as journal entries. They can be rebuilt from the ledger. Version 0.1 is a pre-release initial schema; released migrations must use a new schema version and a pre-migration backup.

The live database is always on the local disk. Do not place it in a network folder or synchronize the live database through a cloud-drive client. A future multi-computer version should put the business services behind an API and migrate to a server database as appropriate; independent offline synchronization is a separate design problem.

## Backups

In the desktop app, add destination folders under Backups and create the first recovery copy. Use a separate physical drive. The native schedule is installed only when the user selects Install daily desktop schedule. It checks hourly and backs up once 24 hours have elapsed since the last fully successful automatic run. While the app is open it also checks every minute. Failed destinations retry after an hour. Unavailable/off/asleep computers catch up when the helper next runs; exact wall-clock execution while powered off is impossible.

Windows uses Task Scheduler under the current desktop account. macOS uses a user LaunchAgent, so the desktop user must be signed in. No network access or account credentials are needed. An unmounted drive cannot receive a copy. Cross-computer copies require connected storage or an optional future network destination.

Files are currently unencrypted SQLite snapshots with a SHA256 manifest. Protect the destination with operating-system permissions and disk encryption. Keep each `.sqlite` file with its `.sqlite.json` manifest. Backup cleanup touches only recognized legacy-compatible files inside the dedicated `Vault Store Backups` subfolder. Failed copies do not trigger cleanup. Safety copies made before restoration are separate and are retained for manual recovery.

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

## Print setup

Invoice Print, Download, and Print-after-save open a shared print setup dialog. Choose Modern, Classic, Minimal or Compact; Charcoal, Lime, Navy, Teal, Rose or Black & white; A4, A5, US Letter or A3; portrait/landscape; standard/narrow margins; and logo, saved product specifications and bill footer visibility. Invoice receipts also support 80 x 200 mm and 58 x 200 mm stock in portrait. The same standalone document supplies the preview, paper print and downloaded output.

Print is available for every report tab, inventory, sales/purchase/expense history, daily book, capital and a selected customer/supplier ledger. Financial report dates and existing top-100 limits are retained. List printouts include the records already loaded; ledger printouts include the current ledger page and state that scope. Existing permissions continue to determine which costs/data can appear. Print preferences are stored on this computer, separately for invoices and reports, only when Remember is checked.

Desktop printing uses an isolated window with no Node access and no external resource requests. Save PDF respects the selected paper size, orientation, layout and colors. The browser preview uses the browser print dialog for printing and Save as PDF. Local fonts are embedded for English, Pashto and Dari; amounts remain LTR inside RTL documents. Printer dialogs/drivers can override paper and color choices, so match the chosen paper and enable background graphics when printing a color theme. The preview is continuous; long tables repeat their headers across printed pages.

Automated checks: `npm test`, `npm run build`, and `npm run test:print:desktop` (isolated Electron PDF generation; no physical printer or live store is used).

## Report workspace

Reports has thirteen top tabs, each opening its own list: profit & loss, daily performance, product profitability, expense breakdown, trial balance, balance sheet, capital & net worth, inventory valuation, stock aging, reorder & stock alerts, zero stock, receivables and payables. Each report has its own summary, colored amounts, date/scope and Print, Save PDF and Export CSV. Load more reveals ten rows at a time; report exports include all rows in the report, with any top-100/latest-36-month limits stated explicitly. The shared definition supplies screen, print/PDF and CSV; CSV money is numeric AFN, including negative amounts. Expense breakdown includes stock losses so it reconciles to P&L operating expenses.

Reorder includes all active products whose stock is at or below their reorder level, with zero-stock products first. It suggests enough to reach twice the reorder level (minimum target one unit). The estimate uses the latest recorded stock-batch cost, falling back to the saved AFN unit cost. Zero-cost products are flagged. This is a simple stock target, not demand forecasting or an automatic purchase. Indexed cursor pagination avoids the inventory valuation top-100 cap; multi-page exports reject a changed audit revision instead of mixing stock snapshots.

Verification: `npm test` checks report calculations and print/CSV parity, translations, reorder pagination and permissions; `npm run test:print:desktop` generates real PDFs from long reports and invoices using an isolated temporary Electron profile.

## Expense accounts and customer resale

Reports starts with a compact horizontal tab row and includes a separate Zero stock report (active catalog products with exactly zero units). Zero stock uses the same complete, revision-checked Print/PDF/CSV export as Reorder.

Expenses → Expense accounts creates accounts such as Rent, Utilities, Food and custom names, and shows spending in a selected period and over the account's lifetime. Record expense selects the account, or creates one inline. Historic expense categories migrate to accounts without changing the journal.

Sales → Customer resale receives a customer's product with a fixed agreed owner amount per unit. Intake can create a new customer and unlisted product together, with brand/model/specifications, an automatic SKU and optional expected selling price. No prior catalog or customer record is required. Save the intake and sell it days later using Sell this item. These one-off custody products are excluded from reorder alerts. Physical stock is available on the normal New Bill screen. Customer-owned batches carry zero shop inventory value; selling them recognises the owner's agreed amount as cost and creates an owner-proceeds payable. FIFO bills can contain owned and customer-owned batches. Owner payments settle the payable without changing profit again. Customer details has a separate owner-proceeds ledger, without offsetting buyer receivables.

A sale return restores the original batch and reverses the original cost and owner share. If the owner was already paid, the balance becomes an owner advance to recover. Balance sheet and Capital show owner advances as assets and owner dues as liabilities, separately across owners. Unsold customer stock can be returned to the owner without cash or profit effects. Invoices with allocated owner payouts cannot be edited or hard-deleted; use sale returns to keep the settlement history intact.

The SQLite schema is now version 2, so older app builds cannot treat customer-owned stock as shop stock. Version 1 stores upgrade additively, and restore accepts backups of versions 1 and 2; the backup manifest format remains version 1.


### Daily workspace controls

Use the sidebar notification bell for live low/zero-stock alerts and unpaid saved-customer balances. Counts include opening receivables and reflect payments and returns; they describe current conditions, not unread messages or assumed overdue debt. The center pages every 10 results and refreshes on demand. The badge refreshes after app changes, on focus, and every 30 seconds while visible. Permissions filter both counts and details.

Settings → Help & shortcuts lists all two-key actions. Ctrl/Cmd + K opens the searchable palette; N creates a product, S opens a sale, B opens a purchase, J creates a customer and U creates a supplier. Shortcuts pause in editable fields and open dialogs; Ctrl/Cmd + P remains normal print, and normal zoom/copy/paste are retained.

Dashboard → Customize dashboard supports individual selection, show/hide all, ordering, save/cancel and defaults. Choices are saved per account on this computer and respect the staff permissions. Empty layouts are supported.

Document previews show a white page with actual paper gutters. Standard margins are 16 mm, narrow margins are 10 mm and receipts retain 3 mm. Print and PDF share those values. Automated desktop checks cover margins and ensure tables stay inside them.

## Compact product entry and drafts

Add Product uses a wider, compact form with editable RAM/storage suggestions. Save closes the form; Save & New (Ctrl/Cmd+S) keeps it open and retains category, company, currency and rate. Previous edits products created during the current entry session without repeating opening stock. Back to New restores the unfinished new-product form.

Save Draft stores incomplete forms privately for the current user and shop. Open Drafts to resume or delete them; catalog and purchase drafts are separate. Drafts and compressed photos survive restarts and SQLite backups. Publishing creates the product and any opening stock atomically and removes the draft; retries do not create duplicates. Drafts do not affect stock, accounts or reports.

New photo uploads are resized to at most 640 pixels and adaptively compressed to no more than 150,000 bytes. Existing photos retain their original data. Product and draft lists keep short references rather than photo blobs.

Validation: `npm test`, `npm run build`, and `npm run test:products:desktop`. The last command uses an isolated SQLite store and the compiled desktop UI, checks actual form workflows and DOM geometry across desktop sizes, three languages and five themes, and takes no screenshots.

## Individual devices
Computers/laptops, mobiles and tablets are tracked per physical device. Serial/IMEI is optional; internal codes identify devices without a serial. Add opening-stock device details from Add Product, or expand Device details on each purchase line. Repeating a model on the bill allows different costs/prices. Available device condition, battery, cosmetic notes, accessories and suggested selling price can be edited from product details.

On sales, choose exact devices or scan their serial/internal code. Quantity follows device selection; profit uses the selected batch cost. Sale and supplier returns select the original devices, preserve original costs and prevent duplicate refunds. Invoice views and print/PDF include device identity. Accessories and storage continue using quantity/FIFO.

Existing remaining stock upgrades once without changing accounting. Historical quantity invoices retain their recorded costs; their returns generate tracked unit records without invented serials. Device data, costs and invoice associations survive normal SQLite backup/restore. The core and desktop checks are `node --test tests/serialized-inventory.test.mjs` and `npm run test:devices:desktop`.
