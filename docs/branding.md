# Radefy TechMart

Developed by **Radefy Systems**. The application brand is separate from the shop's configurable invoice identity.

The original generated mark is in `public/brand/source-mark.png`, its compact UI asset in `src/assets/radefy-techmart-mark.png`, and native icons in `build/icon.png`, `build/icon.ico` and `build/icon.icns`. `npm run build:icons` regenerates packaging sizes from the source mark (macOS ICNS requires Apple's iconutil). The image is resized only; there are no runtime image services.

Edit `shared/brand.json` to supply the company's verified HTTPS website, support email and international WhatsApp number. Empty contacts show a pending-details message. Desktop links are allowed only when they exactly match a configured destination. Contacting support is optional and requires connectivity; store workflows remain offline.

The desktop profile remains `Vault Store` beneath the OS app-data directory so existing stores and sessions survive the rename. Keep `com.vault.store`, internal bridge/session identifiers, backup formats/folders and scheduler identifiers stable. `RADEFY_USER_DATA` (legacy `REDIFY_USER_DATA` also supported) can select an isolated profile for testing. The packaged application name is Radefy TechMart; rebuild/install the desktop package to update its installed icon and name.

Motion uses short opacity/transform transitions with reduced-motion support, without remounting form editors. The quick-action catalog in `src/shortcuts.mjs` supplies both keyboard handling and the searchable palette; actions are permission-filtered. Default zoom shortcuts are untouched.

## Original image-generation prompt

Use case: logo-brand. Create one polished original app logo mark for Radefy TechMart, an offline desktop inventory and accounting app for computer, mobile phone, tablet and accessories stores, made by Radefy Systems. Asset type: square desktop app icon and compact sidebar brand mark. One centered icon only, no text, no letters, no mockup. Design a simple geometric storefront with a coral-red awning whose clean negative space subtly combines a computer screen and a smartphone, a small teal accent, on a deep navy rounded-square tile. Colors navy #17283d, coral #f46b59, warm white #fff9f4 and teal #2bc4b6. Refined flat vector-like branding with crisp edges and consistent bold geometry, minimal details, legible at 24 pixels, balanced generous internal padding. Front view, no perspective, no 3D, no gradients, no cast shadow, no watermark, no borders or extra symbols. The rounded tile should nearly fill the square canvas; outside the tile must be genuinely transparent.
