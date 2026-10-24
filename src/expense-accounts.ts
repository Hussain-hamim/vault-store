export function expenseAccountName(name: string, t: (key: string) => string) {
  return [
    "Rent",
    "Utilities",
    "Food",
    "Other",
    "Salaries",
    "Transport",
    "Repairs",
  ].includes(name)
    ? t(`expense.${name.toLowerCase()}`)
    : name;
}
