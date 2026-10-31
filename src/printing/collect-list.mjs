/** Fetch one stable, filtered export; never silently mix revisions. */
export async function collectList(api, command, filters) {
  const rows = [];
  let after = "",
    revision;
  const seen = new Set();
  do {
    const page = await api(command, {
      ...filters,
      after,
      limit: 100,
      ...(revision === undefined ? {} : { revision }),
    });
    if (revision !== undefined && page.revision !== revision)
      throw Error("LIST_CHANGED");
    revision = page.revision;
    rows.push(...page.rows);
    after = page.next;
    if (after && seen.has(after)) throw Error("Invalid export cursor.");
    seen.add(after);
  } while (after);
  return rows;
}
