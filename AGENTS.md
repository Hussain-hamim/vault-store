# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Store workflow decisions
- Inventory opens the product table with company, model, quantity, unit cost and selling price.
- New products support unit cost and opening stock in the same form.
- Purchase invoices contain multiple product lines; stock is quantity-only (no serial/IMEI tracking).
- New Sale is a full-page bill editor, with a separate invoice-history section providing view, edit, hard-delete and download actions.
- New Sale product picking opens a dropdown of available products on search focus; typing filters it. Results show image, name, brand/model/SKU, specs and stock, then add to the bill.
- Cashiers can add a customer from the New Sale customer picker when leaving a balance unpaid; walk-in remains cash-only.
- Invoice mutations must update stock and ledgers atomically and enforce access rights and closed periods.
