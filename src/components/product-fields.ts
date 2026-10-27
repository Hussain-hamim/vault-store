import {
  BUILTIN_PRODUCT_CATEGORIES,
  CAMERA_TYPES,
  editableSpecKeys,
  isBuiltinCategory,
  specOrder,
} from "../../shared/product-categories.mjs";

export const PRODUCT_BRANDS = [
  "Apple",
  "Dell",
  "Samsung",
  "HP",
  "Lenovo",
  "Asus",
  "Acer",
  "Microsoft",
  "Sony",
  "LG",
  "Xiaomi",
  "Huawei",
  "Canon",
  "Nikon",
  "Fujifilm",
  "GoPro",
  "DJI",
  "Panasonic",
  "Anker",
  "Logitech",
  "Western Digital",
  "Seagate",
  "Kingston",
  "SanDisk",
  "Corsair",
  "Razer",
  "Other",
];
const ACCESSORY_TYPES = [
  "Keyboard",
  "Mouse",
  "Headphones",
  "Charger",
  "Cable",
  "Case",
  "Mouse pad",
  "Plush",
  "Hard disk",
  "Webcam",
  "Hub",
  "Speaker",
  "Other",
];
export function brandChoices(current?: string) {
  if (current && !PRODUCT_BRANDS.includes(current))
    return [current, ...PRODUCT_BRANDS];
  return PRODUCT_BRANDS;
}
export function accessoryChoices(current?: string) {
  if (current && !ACCESSORY_TYPES.includes(current))
    return [current, ...ACCESSORY_TYPES];
  return ACCESSORY_TYPES;
}
export function cameraTypeChoices(current?: string) {
  if (current && !CAMERA_TYPES.includes(current))
    return [current, ...CAMERA_TYPES];
  return [...CAMERA_TYPES];
}
export const PRODUCT_CATEGORIES = [
  ...BUILTIN_PRODUCT_CATEGORIES,
  "Other",
] as const;
export function categoryChoices(current?: string, custom: string[] = []) {
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const c of [
    ...BUILTIN_PRODUCT_CATEGORIES,
    ...custom,
    ...(current &&
    current !== "Other" &&
    !BUILTIN_PRODUCT_CATEGORIES.includes(current) &&
    !custom.includes(current)
      ? [current]
      : []),
    "Other",
  ]) {
    if (!c || seen.has(c)) continue;
    seen.add(c);
    rows.push(c);
  }
  return rows;
}
export function categoryLabel(tr: (key: string) => string, category: string) {
  const keys: Record<string, string> = {
    Computers: "inventory.computers",
    Mobiles: "inventory.mobiles",
    Tablets: "inventory.tablets",
    Cameras: "inventory.cameras",
    Storage: "inventory.storage",
    Accessories: "inventory.accessories",
    Other: "common.other",
  };
  return keys[category] ? tr(keys[category]) : category;
}
export function specFieldLabel(tr: (key: string) => string, key: string) {
  const map: Record<string, string> = {
    Generation: "product.generation",
    CPU: "product.cpu",
    RAM: "product.ram",
    Storage: "product.storage",
    GPU: "product.gpu",
    Display: "product.display",
    Color: "product.color",
    Connectivity: "product.connectivity",
    Interface: "product.interface",
    Compatibility: "productForm.compatibility",
    Wattage: "productForm.wattage",
    Type: "product.type",
    Sensor: "product.sensor",
    Resolution: "product.resolution",
    Lens: "product.lens",
    Mount: "product.mount",
    ISO: "product.iso",
    Video: "product.video",
    Shutter: "product.shutter",
    Battery: "product.battery",
  };
  return tr(map[key] || key);
}
export {
  BUILTIN_PRODUCT_CATEGORIES,
  CAMERA_TYPES,
  editableSpecKeys,
  isBuiltinCategory,
  specOrder,
};
