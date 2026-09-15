export function selectInfraTargetPage<
  T extends { name: string; host: string; protocol: string; group?: string },
>(targets: T[], args: Record<string, unknown> = {}) {
  const query = typeof args.query === 'string' ? args.query.toLowerCase() : '';
  const group = typeof args.group === 'string' ? args.group.toLowerCase() : '';
  const offset = args.offset === undefined ? 0 : Number(args.offset);
  const limit = args.limit === undefined ? 50 : Number(args.limit);
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new Error('Use offset >= 0 and limit between 1 and 100.');
  const matching = targets.filter(
    (t) =>
      (!group || t.group?.toLowerCase() === group) &&
      `${t.name} ${t.host} ${t.protocol} ${t.group || ''}`.toLowerCase().includes(query)
  );
  return {
    targets: matching.slice(offset, offset + limit),
    total: matching.length,
    offset,
    nextOffset: offset + limit < matching.length ? offset + limit : null,
  };
}
