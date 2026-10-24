# Radefy TechMart

Offline electronics inventory and accounting for Windows and macOS, built with React, Electron and SQLite. AFN currency; tax disabled.

```sh
npm install
npm run dev
```

Preview: http://localhost:4173. Run `npm run desktop` for the native app while the development server is running. Production desktop builds bundle their own interface and work without that server.

- `npm test` — accounting, stock, permission and recovery tests
- `npm run build` — TypeScript validation and interface build
- `npm run package:mac` — macOS application bundle
- `npm run package:win` — Windows NSIS installer
- `npm run benchmark -- 1000000` — isolated synthetic performance fixture

Read [development and release notes](docs/README.md) for data locations, demo credentials, backup setup, accounting policies and release limitations. Product images use a bundled company/model catalog plus exact-photo uploads, entirely offline. See [product photo behavior and credits](docs/product-photos.md) for coverage, sources and licenses. Local reference screenshots, databases, and installers are excluded from version control. Do not use the demonstration database for real business transactions.
