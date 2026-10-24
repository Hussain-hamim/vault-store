// Package-size derivatives of the original generated mark; no artwork is altered.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Resvg } from "@resvg/resvg-js";
const source = readFileSync(
  new URL("../public/brand/source-mark.png", import.meta.url),
).toString("base64");
const png = (size) =>
  new Resvg(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      size +
      '" height="' +
      size +
      '" viewBox="0 0 1280 1280"><image width="1280" height="1280" href="data:image/png;base64,' +
      source +
      '"/></svg>',
  )
    .render()
    .asPng();
mkdirSync("build/icon.iconset", { recursive: true });
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024],
  images = new Map();
for (const size of sizes) images.set(size, png(size));
for (const size of [16, 32, 128, 256, 512]) {
  writeFileSync(
    "build/icon.iconset/icon_" + size + "x" + size + ".png",
    images.get(size),
  );
  writeFileSync(
    "build/icon.iconset/icon_" + size + "x" + size + "@2x.png",
    images.get(size * 2),
  );
}
writeFileSync("build/icon.png", images.get(1024));
writeFileSync("public/brand/favicon.png", images.get(32));
writeFileSync("src/assets/radefy-techmart-mark.png", images.get(256));
const iconSizes = [16, 24, 32, 48, 64, 128, 256],
  header = Buffer.alloc(6 + iconSizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(iconSizes.length, 4);
let offset = header.length;
iconSizes.forEach((size, i) => {
  const entry = 6 + i * 16,
    data = images.get(size);
  header[entry] = size === 256 ? 0 : size;
  header[entry + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(data.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += data.length;
});
writeFileSync(
  "build/icon.ico",
  Buffer.concat([header, ...iconSizes.map((size) => images.get(size))]),
);
if (process.platform === "darwin")
  execFileSync("/usr/bin/iconutil", [
    "-c",
    "icns",
    "build/icon.iconset",
    "-o",
    "build/icon.icns",
  ]);
console.log(
  "Radefy TechMart app mark, favicon, Windows ICO and macOS ICNS prepared.",
);
