/** One permission-aware action catalog feeds both the palette and key handling. */
export const SHORTCUTS = [
  {
    id: "search",
    label: "shortcuts.search",
    key: "f",
    permission: "",
    combo: "Ctrl + F",
  },
  {
    id: "product",
    label: "shortcuts.product",
    key: "n",
    permission: "inventory",
    combo: "Ctrl + N",
  },
  {
    id: "sale",
    label: "shortcuts.sale",
    key: "s",
    permission: "sales",
    combo: "Ctrl + S",
  },
  {
    id: "purchase",
    label: "shortcuts.purchase",
    key: "b",
    permission: "purchases",
    combo: "Ctrl + B",
  },
  {
    id: "customer",
    label: "shortcuts.customer",
    key: "j",
    permission: "people",
    combo: "Ctrl + J",
  },
  {
    id: "supplier",
    label: "shortcuts.supplier",
    key: "u",
    permission: "people",
    combo: "Ctrl + U",
  },
  {
    id: "expense",
    label: "shortcuts.expense",
    key: "e",
    permission: "finance",
    combo: "Ctrl + E",
  },
  {
    id: "inventory",
    label: "shortcuts.inventory",
    key: "i",
    permission: "inventory",
    combo: "Ctrl + I",
  },
  {
    id: "reports",
    label: "shortcuts.reports",
    key: "g",
    permission: "reports",
    combo: "Ctrl + G",
  },
  {
    id: "dailyBook",
    label: "shortcuts.dailyBook",
    key: "d",
    permission: "finance",
    combo: "Ctrl + D",
  },
  {
    id: "history",
    label: "shortcuts.history",
    key: "h",
    permission: "sales",
    combo: "Ctrl + H",
  },
  {
    id: "settings",
    label: "shortcuts.settings",
    key: ",",
    permission: "",
    combo: "Ctrl + ,",
  },
  {
    id: "support",
    label: "shortcuts.support",
    key: "F1",
    permission: "",
    standalone: true,
    combo: "F1",
  },
  {
    id: "help",
    label: "shortcuts.help",
    key: "/",
    permission: "",
    combo: "Ctrl + /",
  },
  { id: "about", label: "shortcuts.about", permission: "", combo: "" },
];
export const availableActions = (permissions) =>
  SHORTCUTS.filter(
    (action) => !action.permission || permissions.includes(action.permission),
  );
/** @param {KeyboardEvent | any} event
 * @param {{permissions?: string[], overlay?: boolean, editable?: boolean}} options */
export function shortcutAction(
  event,
  { permissions = [], overlay = false, editable = false } = {},
) {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.getModifierState?.("AltGraph")
  )
    return null;
  if (overlay) return null;
  const key =
    (event.ctrlKey || event.metaKey) && /^Key[A-Z]$/.test(event.code || "")
      ? event.code.slice(3).toLowerCase()
      : (event.ctrlKey || event.metaKey) && event.code === "Comma"
        ? ","
        : (event.ctrlKey || event.metaKey) && event.code === "Slash"
          ? "/"
          : String(event.key).toLowerCase();
  if (event.altKey || event.shiftKey || (event.ctrlKey && event.metaKey))
    return null;
  if (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    key === "k"
  )
    return "palette";
  const action = availableActions(permissions).find(
    (a) =>
      a.key &&
      a.key.toLowerCase() === key &&
      (a.standalone
        ? !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
        : (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey),
  );
  if (!action || (editable && action.id !== "search" && action.id !== "help"))
    return null;
  return action.id;
}
export const shortcutLabel = (combo, mac = false) =>
  mac ? combo.replaceAll("Ctrl", "⌘").replaceAll("Alt", "⌥") : combo;
