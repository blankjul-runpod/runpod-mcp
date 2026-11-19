// One contract for every list tool, so a list response never outgrows an
// agent's context and every list pages the same way:
//
//   in:  limit (1-100, default 20), cursor (the previous page's nextCursor)
//   out: { <rows>, pagination: { returned, hasNextPage, nextCursor } }
//
// When the API pages (limit/cursor query parameters), the request carries the
// capped limit and the server's cursor (serverPageQuery) and the response
// carries the server's pagination block (serverPagination). When it does not,
// the whole response is paged here (pageInMemory) with an offset cursor and
// the same block. Generated list tools get this from dispatch (tool.list);
// curated ones call these helpers. tests/specgen-lists.test.ts checks every
// served list against this contract.

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 100;

// The shared list arguments (spread into a tool's inputSchema properties).
export const listPaginationProperties = {
  limit: {
    type: 'integer',
    minimum: 1,
    maximum: MAX_LIST_LIMIT,
    default: DEFAULT_LIST_LIMIT,
    description: `Rows per page, 1-${MAX_LIST_LIMIT} (default ${DEFAULT_LIST_LIMIT}).`,
  },
  cursor: {
    type: 'string',
    description:
      'pagination.nextCursor from the previous page; omit for the first page.',
  },
} as const;

// Coerce, floor at 1, and cap: the low-level server never validates the
// JSON Schema, so limit: 0 (or junk) would otherwise return an empty page
// whose nextCursor never advances.
export function clampListLimit(limit: unknown): number {
  const requested = Number(limit);
  return Math.min(
    Number.isFinite(requested) && requested >= 1
      ? Math.floor(requested)
      : DEFAULT_LIST_LIMIT,
    MAX_LIST_LIMIT
  );
}

// Query for a server-paginated list: the capped limit, and the server's
// opaque cursor verbatim. A malformed cursor is the server's to reject (422).
export function serverPageQuery(args: Record<string, unknown>): {
  limit: number;
  cursor?: string;
} {
  const cursor =
    typeof args.cursor === 'string' && args.cursor !== ''
      ? args.cursor
      : undefined;
  return { limit: clampListLimit(args.limit), ...(cursor ? { cursor } : {}) };
}

// The server's pagination block, plus how many items this page returned.
export function serverPagination(
  pagination: { nextCursor?: string | null; hasNextPage?: boolean } | undefined,
  returned: number
): Record<string, unknown> {
  const hasNextPage = pagination?.hasNextPage === true;
  return {
    returned,
    hasNextPage,
    nextCursor: pagination?.nextCursor ?? null,
    ...(hasNextPage
      ? { note: 'More results exist. Pass cursor=nextCursor to fetch them.' }
      : {}),
  };
}

// The cursor is a base64-encoded offset today; invalid values are treated as
// the start so a bad cursor never throws in an agent's face.
export function decodeCursorOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    // Strict digits-only: parseInt would accept "20junk" (and Node's base64
    // decoder silently strips non-alphabet bytes first), silently paginating
    // mid-list from a mangled cursor instead of restarting.
    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
    if (!/^\d+$/.test(decoded)) return 0;
    const offset = Number.parseInt(decoded, 10);
    return Number.isFinite(offset) && offset >= 0 ? offset : 0;
  } catch {
    return 0;
  }
}

export function encodeCursorOffset(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64');
}

// One page of a list the API returned whole, with the same pagination block a
// server-paged list returns. The cursor is an offset into `items`, so it is
// only valid with the arguments that produced the list.
export function pageInMemory<T>(
  items: T[],
  args: Record<string, unknown>
): { page: T[]; pagination: Record<string, unknown> } {
  const limit = clampListLimit(args.limit);
  const offset = decodeCursorOffset(
    typeof args.cursor === 'string' ? args.cursor : undefined
  );
  const page = items.slice(offset, offset + limit);
  const next = offset + page.length;
  const hasNextPage = next < items.length;
  return {
    page,
    pagination: serverPagination(
      {
        hasNextPage,
        nextCursor: hasNextPage ? encodeCursorOffset(next) : null,
      },
      page.length
    ),
  };
}
