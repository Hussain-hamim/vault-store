# Offline product photos

Product forms automatically select a real product image from a local catalog using category, company and exact model aliases. Accessory matches also require the accessory type. These files ship inside the desktop app; no image request goes to the internet while using the app.

An exact match means a supported model name, not a guarantee of identical color, storage, generation suffix or condition. Other models can use a clearly labeled reference from the same company and category. An unsupported company/category shows a neutral icon instead of a different company’s product. The form identifies exact matches, references and saved custom photos.

Use Choose photo in Add/Edit product or new resale intake for the exact item. JPG, PNG and WebP are resized locally to a maximum 640-pixel edge and stored as JPEG. The source file limit is 12 MiB. After saving, another product with the same category, company and model can reuse that uploaded photo. Use automatic photo resets the current selection.

Uploaded media is content-addressed and deduplicated in the separate SQLite product_photos table. Product rows keep only a short photo reference; images load near the viewport through a bounded cache. Creation/editing and photo writes commit together. Historical invoice references keep their original photos, and standard SQLite backups/restores include the media without depending on the original upload file.

Automated checks: npm test; npm run build; npm run test:photos:desktop. The desktop check uses a temporary database, tests brand/model changes and upload/reuse/reset, and then verifies the compiled desktop catalog with every HTTP/WebSocket request blocked. It does not take screenshots or modify the live store.

## Bundled sources and licenses

Attribution is also available offline in Settings → About → Product photo credits and public/assets/products/CREDITS.json. Each image retains its individual license. Download URLs and exact aliases are recorded in that JSON file. Existing generic category illustrations are no longer used as substitutes for company photos.

### Samsung Galaxy S24

- File: `public/assets/products/samsung-galaxy-s24.png`
- Creator: Eleanor Chin
- Source: [Wikimedia Commons file page](https://commons.wikimedia.org/wiki/File:S24_Onyx_Black.png)
- License: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0)
- Changes: Wikimedia thumbnail, resized from original; no generative changes.

### Apple iPhone 15 Pro

- File: `public/assets/products/apple-iphone-15-pro.jpg`
- Creator: IPHONE 15
- Source: [Wikimedia Commons file page](https://commons.wikimedia.org/wiki/File:Apple_iPhone_15_Pro.jpg)
- License: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0)
- Changes: Wikimedia thumbnail, resized from original; no generative changes.

### Apple iPhone 15

- File: `public/assets/products/apple-iphone-15.jpg`
- Creator: ThePhotoGraphIc
- Source: [Wikimedia Commons file page](https://commons.wikimedia.org/wiki/File:Back_of_iPhone_15.jpg)
- License: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0)
- Changes: Wikimedia thumbnail, resized from original; no generative changes.

### HP EliteBook 850 G5

- File: `public/assets/products/hp-elitebook-850-g5.png`
- Creator: Infinatious
- Source: [Wikimedia Commons file page](https://commons.wikimedia.org/wiki/File:HP_EliteBook_850_G5.png)
- License: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0)
- Changes: Wikimedia thumbnail, resized from original; no generative changes.

### HP EliteBook 840 G4

- File: `public/assets/products/hp-elitebook-840-g4.png`
- Creator: Dienthoaiquangcao12
- Source: [Wikimedia Commons file page](https://commons.wikimedia.org/wiki/File:HP_EliteBook_840_G4.png)
- License: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0)
- Changes: Wikimedia thumbnail, resized from original; no generative changes.

### Dell Latitude 7490

- File: `public/assets/products/dell-latitude-7490.jpg`
- Creator: Ahunt
- Source: [Wikimedia Commons file page](https://commons.wikimedia.org/wiki/File:Dell_Latitude_7490_running_Ubuntu_Cinnamon_23.10.jpg)
- License: [CC0 (hardware); GNU GPL 2+ (software screen)](https://creativecommons.org/publicdomain/zero/1.0/deed.en)
- Changes: Wikimedia thumbnail, resized from original; no generative changes. Software screen license: https://www.gnu.org/licenses/old-licenses/gpl-2.0.html

### Lenovo ThinkPad X1 Carbon Gen 7

- File: `public/assets/products/lenovo-x1-carbon-gen7.jpg`
- Creator: IAEA Imagebank
- Source: [Wikimedia Commons file page](https://commons.wikimedia.org/wiki/File:ThinkPad_X1_Carbon_gen7_(0).jpg)
- License: [CC BY 2.0](https://creativecommons.org/licenses/by/2.0)
- Changes: Wikimedia thumbnail, resized from original; no generative changes.

### Apple MacBook Air M2

- File: `public/assets/products/apple-macbook-air-m2.jpg`
- Creator: メイド理世
- Source: [Wikimedia Commons file page](https://commons.wikimedia.org/wiki/File:MacBook_Air_(A2681)_front.jpg)
- License: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0)
- Changes: Wikimedia thumbnail, resized from original; no generative changes.

### Samsung Galaxy Tab S9

- File: `public/assets/products/samsung-galaxy-tab-s9.png`
- Creator: AnVuong1222004 (11)
- Source: [Wikimedia Commons file page](https://commons.wikimedia.org/wiki/File:Samsung_Galaxy_Tab_S9.png)
- License: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0)
- Changes: Wikimedia thumbnail, resized from original; no generative changes.

### Asus ZenBook Duo UX481FL

- File: `public/assets/products/asus-zenbook-duo-ux481fl.jpg`
- Creator: KKPCW
- Source: [Wikimedia Commons file page](https://commons.wikimedia.org/wiki/File:ASUS_ZenBook_Duo_UX481FL.jpg)
- License: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0)
- Changes: Wikimedia thumbnail, resized from original; no generative changes.

### Apple iPad 10th generation

- File: `public/assets/products/apple-ipad-10.png`
- Creator: Riski394
- Source: [Wikimedia Commons file page](https://commons.wikimedia.org/wiki/File:IPad_10.png)
- License: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0)
- Changes: Wikimedia thumbnail, resized from original; no generative changes.

### Acer Aspire A515-51

- File: `public/assets/products/acer-aspire-a515-51.jpg`
- Creator: Woofstarcat
- Source: [Wikimedia Commons file page](https://commons.wikimedia.org/wiki/File:Acer_Aspire_A515-51.jpg)
- License: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0)
- Changes: Wikimedia thumbnail, resized from original; no generative changes.

### Huawei P30

- File: `public/assets/products/huawei-p30.jpg`
- Creator: TGspot - (Huawei S10)
- Source: [Wikimedia Commons file page](https://commons.wikimedia.org/wiki/File:Huawei_P30.jpg)
- License: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0)
- Changes: Wikimedia thumbnail, resized from original; no generative changes.

### Xiaomi Redmi Note

- File: `public/assets/products/xiaomi-redmi-note.jpg`
- Creator: Ilya Plekhanov
- Source: [Wikimedia Commons file page](https://commons.wikimedia.org/wiki/File:Xiaomi_Redmi_Note.JPG)
- License: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0)
- Changes: Wikimedia thumbnail, resized from original; no generative changes.

### Samsung 990 EVO Plus

- File: `public/assets/products/samsung-990-evo-plus.jpg`
- Creator: Raimond Spekking
- Source: [Wikimedia Commons file page](https://commons.wikimedia.org/wiki/File:SSD_Samsung_990_EVO_Plus_2TB,_Model_MZ-V9S2T0-2800.jpg)
- License: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0)
- Changes: Wikimedia thumbnail, resized from original; no generative changes.

### Microsoft Surface Pro 9

- File: `public/assets/products/microsoft-surface-pro-9.jpg`
- Creator: Kyler Chin
- Source: [Wikimedia Commons file page](https://commons.wikimedia.org/wiki/File:Surface_Pro_9_in_Sapphire_colour.jpg)
- License: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0)
- Changes: Wikimedia thumbnail, resized from original; no generative changes.

### Logitech M185

- File: `public/assets/products/logitech-m185.jpg`
- Creator: Hayden Schiff
- Source: [Wikimedia Commons file page](https://commons.wikimedia.org/wiki/File:Logitech_M185_mouse_HS06.jpg)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0)
- Changes: Wikimedia thumbnail, resized from original; no generative changes.

### Western Digital WD10JPVX

- File: `public/assets/products/western-digital-wd10jpvx.jpg`
- Creator: Amirhossein Ashrafzadeh
- Source: [Wikimedia Commons file page](https://commons.wikimedia.org/wiki/File:Western_Digital_WD10JPVX_1.0TB_(WDBMYH0010BNC)_1TB_Laptop_Internal_Hard_Drive.jpg)
- License: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0)
- Changes: Wikimedia thumbnail, resized from original; no generative changes.
