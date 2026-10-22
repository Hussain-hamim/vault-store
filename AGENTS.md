# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

Desktop testing: keep `npm run dev` running, then use `npm run desktop:dev` (not a long-lived `npm run desktop` from before server edits). Unpackaged Electron loads the Vite UI and watches `server/` so ledger/API changes reload the DB worker without signing the user out (sessions are stored in SQLite). Desktop uses its own SQLite under Electron userData (not the browser demo DB).

## Store workflow decisions
- Inventory opens a colored card-style product list (category accent borders, stock badges) with a sticky search/header while the rows scroll; each card shows brand/model/SKU plus full saved specs (CPU/RAM/Storage/etc. by category), quantity, unit cost and selling price.
- Products can store a barcode on add/edit; New Sale/Purchase has a barcode scan field that looks up the product and adds it to the bill (Enter or Add). Catalog search also matches barcode.
- Customers use a teal/sky card list (rose when they owe); suppliers use a warmer clay/olive card list. Sticky search/header while contacts scroll; status chips show Owes you / Settled / Credit.
- Page content, dashboard, and sales workspace sit in a ~1280px centered column; inventory, customers, expenses/document history, daily book, and capital use a tighter ~960px column so side SVG décor stays visible. Sale history and expenses use colored card lists (status accents) like inventory/customers.
- Empty workspace margins show soft animated computer-store SVG decor (CSS motion). Capital uses Record investment modal; Where the money sits and Monthly capital sit side by side with color-coded amounts.
- Inventory, customers, suppliers, sale/purchase/expense history load 10 rows first; Load more appends the next 10. Tightened list screens use compact page headers and shorter cards.
- UI is PC-responsive across common laptop/desktop widths and Windows display scaling (about 1024–ultrawide CSS pixels): fluid page gutters, stacking list/trade/capital layouts under ~1280px, shorter chrome under ~820px height, and side SVG décor fades/hides when margins are tight.
- New products support unit cost and opening stock in the same form; unit cost and selling price sit side by side. Minimum price and shelf location are not collected on the product form for now.
- Stock is bought from Dubai in AED and sold in Afghanistan in AFN. Product and purchase forms record unit cost in AED plus the AFN-per-AED exchange rate at that time; AFN unit cost is calculated and stored for inventory/ledgers.
- Inventory costing is FIFO: each purchase keeps its own cost batch (AED + rate + AFN). Sales consume the oldest remaining batch first; profit uses those batch costs, not the catalog’s latest unit cost. Sale returns restore cost to the original batches in the same order.
- Product company/brand is chosen from a picker (Apple, Dell, Samsung, and similar; Other for a custom name).
- When category is Accessories, the form also asks for accessory type (keyboard, plush, hard disk, headphones, and similar; Other for a custom type).
- Each accessory type maps to its own catalog photo (charger, headphones, keyboard, etc.), previewed in the add/edit product form.
- Purchase invoices contain multiple product lines; stock is quantity-only (no serial/IMEI tracking).
- New Purchase can create a product that is not yet in inventory (New product), then receive it on the same bill with AED cost and the invoice exchange rate.
- Purchases use a full-page bill editor with purchase-history view/edit/hard-delete (owner/manager). Editing reverses unsold received batches and reposts; blocked if any of that purchase stock was sold, or if returns/payments are linked.
- New Sale is a full-page bill editor, with a separate invoice-history section providing view, edit, hard-delete and download actions.
- New Sale and New Purchase use the same two-column board: left = party/date (sale also has Type name | Existing beside the name) + product catalog (cards stack cleanly, ~3+ visible then scroll); right = bill lines, compact totals/paid, Print-after-save checkbox, Cancel and post. No note field on these boards.
- Blank amount paid means unpaid (0), not full payment. Sale defaults to typing a customer name (saved to Customers); unpaid balances track on that customer. Existing walk-in remains cash-only. Payment due is not collected on sale/purchase boards.
- Print bill after save (default off) opens the invoice modal and the browser print dialog when checked. Invoice view/print/download shows brand, model, SKU and full saved specs (CPU/RAM/Storage/etc. by category). Settings → Store holds bill design: business name, logo, phone, email, address, and optional footer used on print/download.
- UI languages: English (LTR), Pashto (`ps`, RTL), Dari (`prs`, RTL). Use proper Afghan shop/accounting terms (not literal calques). Language lives in store settings + localStorage; profile menu has a quick switcher. Layout stays the same; only labels and direction flip. Vazirmatn for Arabic-script locales; money amounts stay LTR-isolated.
- Adding a customer or supplier uses opening balance (what they owe you / what you owe them) instead of credit limit; owner-only when the amount is greater than zero.
- Customer/supplier ledgers show opening balances and payments newest-first with running outstanding, red/green amounts, and pagination; list Outstanding reflects that balance.
- Invoice mutations must update stock and ledgers atomically and enforce access rights and closed periods.
- Capital screen tracks owner capital and net worth month by month; owners invest or withdraw external cash there (updates cash + equity, not profit). Reports also include a Capital & net worth tab.
