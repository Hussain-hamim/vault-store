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
export const PRODUCT_CATEGORIES = [
  "Computers",
  "Mobiles",
  "Tablets",
  "Storage",
  "Accessories",
] as const;
export function categoryLabel(tr: (key: string) => string, category: string) {
  const keys: Record<string, string> = {
    Computers: "inventory.computers",
    Mobiles: "inventory.mobiles",
    Tablets: "inventory.tablets",
    Storage: "inventory.storage",
    Accessories: "inventory.accessories",
  };
  return tr(keys[category] || category);
}
export function specFieldLabel(tr: (key: string) => string, key: string) {
  const map: Record<string, string> = {
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
  };
  return tr(map[key] || key);
}
