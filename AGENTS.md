# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

Desktop testing: keep `npm run dev` running, then use `npm run desktop:dev` (not a long-lived `npm run desktop` from before server edits). Unpackaged Electron loads the Vite UI and watches `server/` so ledger/API changes reload the DB worker and window. Desktop uses its own SQLite under Electron userData (not the browser demo DB).

## Store workflow decisions
- Inventory opens the product table with company, model, quantity, unit cost and selling price.
- New products support unit cost and opening stock in the same form; unit cost and selling price sit side by side. Minimum price and shelf location are not collected on the product form for now.
- Stock is bought from Dubai in AED and sold in Afghanistan in AFN. Product and purchase forms record unit cost in AED plus the AFN-per-AED exchange rate at that time; AFN unit cost is calculated and stored for inventory/ledgers.
- Product company/brand is chosen from a picker (Apple, Dell, Samsung, and similar; Other for a custom name).
- When category is Accessories, the form also asks for accessory type (keyboard, plush, hard disk, headphones, and similar; Other for a custom type).
- Each accessory type maps to its own catalog photo (charger, headphones, keyboard, etc.), previewed in the add/edit product form.
- Purchase invoices contain multiple product lines; stock is quantity-only (no serial/IMEI tracking).
- New Sale is a full-page bill editor, with a separate invoice-history section providing view, edit, hard-delete and download actions.
- New Sale uses a two-column bill workspace: a fixed-height product catalog (search + scroll + Load more) beside the bill lines. Results show image, name, brand/model/SKU, specs and stock.
- Cashiers can add a customer from the New Sale customer picker when leaving a balance unpaid; walk-in remains cash-only.
- Adding a customer or supplier uses opening balance (what they owe you / what you owe them) instead of credit limit; owner-only when the amount is greater than zero.
- Customer/supplier ledgers show opening balances and payments newest-first with running outstanding, red/green amounts, and pagination; list Outstanding reflects that balance.
- Invoice mutations must update stock and ledgers atomically and enforce access rights and closed periods.
