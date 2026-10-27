/** Builtin product categories shown in pickers (order matters). */
export const BUILTIN_PRODUCT_CATEGORIES = [
  "Computers",
  "Mobiles",
  "Tablets",
  "Cameras",
  "Storage",
  "Accessories",
];

export const CAMERA_TYPES = [
  "DSLR",
  "Mirrorless",
  "Compact",
  "Action camera",
  "Instant",
  "Film",
  "CCTV",
  "DVR/NVR",
  "Security kit",
  "Webcam",
  "Drone",
  "Lens",
  "Other",
];

/** Categories that use individual device / serial tracking. */
export const trackedCategory = (category) =>
  ["Computers", "Mobiles", "Tablets", "Cameras"].includes(category);

export function isSecurityCameraType(type) {
  const normalized = String(type || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return [
    "cctv",
    "dvrnvr",
    "dvr",
    "nvr",
    "securitykit",
    "security",
    "ipcamera",
    "surveillance",
  ].some((key) => normalized === key || normalized.includes(key));
}

/** Ordered attribute keys for bills, inventory cards and product forms. */
export function specOrder(category, type) {
  if (category === "Computers")
    return ["Generation", "CPU", "RAM", "Storage", "GPU", "Display", "Color"];
  if (category === "Mobiles" || category === "Tablets")
    return ["RAM", "Storage", "Color", "Connectivity"];
  if (category === "Cameras") {
    if (isSecurityCameraType(type))
      return [
        "Type",
        "Resolution",
        "Lens",
        "NightVision",
        "IRRange",
        "Power",
        "Cable",
        "Channels",
        "Audio",
        "Housing",
        "IPRating",
        "ViewingAngle",
        "Included",
      ];
    return [
      "Type",
      "Sensor",
      "Resolution",
      "Lens",
      "Mount",
      "ISO",
      "Video",
      "Shutter",
      "Display",
      "Color",
      "Connectivity",
      "Storage",
      "Battery",
    ];
  }
  if (category === "Storage") return ["Storage", "Interface"];
  if (category === "Accessories") return ["Type"];
  if (category) return ["Type", "Color", "Compatibility"];
  return [];
}

/** Spec fields edited as free text (Type for Accessories/Cameras is a separate picker). */
export function editableSpecKeys(category, type) {
  if (category === "Computers")
    return ["Generation", "CPU", "RAM", "Storage", "GPU", "Display", "Color"];
  if (category === "Mobiles" || category === "Tablets")
    return ["RAM", "Storage", "Color", "Connectivity"];
  if (category === "Cameras") {
    if (isSecurityCameraType(type))
      return [
        "Resolution",
        "Lens",
        "NightVision",
        "IRRange",
        "Power",
        "Cable",
        "Channels",
        "Audio",
        "Housing",
        "IPRating",
        "ViewingAngle",
        "Included",
      ];
    return [
      "Sensor",
      "Resolution",
      "Lens",
      "Mount",
      "ISO",
      "Video",
      "Shutter",
      "Display",
      "Color",
      "Connectivity",
      "Storage",
      "Battery",
    ];
  }
  if (category === "Storage") return ["Storage", "Interface"];
  if (category === "Accessories") return ["Compatibility", "Wattage", "Color"];
  return ["Type", "Color", "Compatibility"];
}

export function isBuiltinCategory(category) {
  return BUILTIN_PRODUCT_CATEGORIES.includes(category);
}
