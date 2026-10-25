/** Newest-first movements: current stock anchors balances even for a truncated history. */
export function movementBalances(currentStock, movements) {
  let remaining = currentStock;
  return movements.map((movement) => {
    const row = { ...movement, remaining };
    remaining -= movement.quantity;
    return row;
  });
}
