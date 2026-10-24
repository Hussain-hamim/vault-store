/** Collect an export in bounded database pages, rejecting mixed or cancelled snapshots. */
export async function collectReorderReport(
  request,
  revision,
  isActive = () => true,
) {
  const check = (page) => {
    if (!isActive() || page.revision !== revision)
      throw new Error("REPORT_CHANGED");
  };
  let page = await request({ limit: 1000, revision });
  check(page);
  const report = { ...page, rows: [...page.rows], next: null };
  while (page.next) {
    page = await request({ limit: 1000, revision, cursor: page.next });
    check(page);
    report.rows.push(...page.rows);
  }
  return report;
}
