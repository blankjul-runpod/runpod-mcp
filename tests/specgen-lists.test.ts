// Every list tool follows one contract (src/specgen/pagination.ts):
// limit (1-100, default 20) and cursor in, { <rows>, pagination: { returned,
// hasNextPage, nextCursor } } out.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRunpodClient } from '@runpod/typescript-api-sdk';
import { dispatchGeneratedTool } from '#src/specgen/dispatch';
import { generatedTools } from '#src/specgen/generated/tools.gen';
import { curatedTools } from '#src/specgen/server';
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from '#src/specgen/pagination';

// The lists: every generated list operation, every curated list-* tool, and
// get-capacity, which pages a GPU list.
const listTools = [
  ...generatedTools.filter((tool) => tool.list),
  ...curatedTools.filter(
    (tool) => tool.name.startsWith('list-') || tool.name === 'get-capacity'
  ),
];

test('every list tool takes the shared limit and cursor', () => {
  const offenders = listTools.flatMap((tool) => {
    const properties = tool.inputSchema.properties as Record<
      string,
      Record<string, unknown>
    >;
    const { limit, cursor } = properties;
    const ok =
      limit?.minimum === 1 &&
      limit?.maximum === MAX_LIST_LIMIT &&
      cursor?.type === 'string';
    return ok ? [] : [tool.name];
  });
  assert.deepEqual(offenders, []);
  assert.ok(listTools.length >= 36, `only ${listTools.length} lists found`);
});

test('every generated list operation is paged as a list', () => {
  const unpaged = generatedTools
    .filter((tool) => tool.operationId.startsWith('list') && !tool.list)
    .map((tool) => tool.name);
  assert.deepEqual(unpaged, []);
});

type Call = { url: URL };

function fakeApi(body: unknown, calls: Call[]) {
  return createRunpodClient({
    apiKey: 'test',
    fetch: async (input: Request | string | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      calls.push({ url: new URL(request.url) });
      return new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
      });
    },
  });
}

const tool = (name: string) => {
  const found = generatedTools.find((candidate) => candidate.name === name);
  assert.ok(found, `missing tool ${name}`);
  return found;
};

test('a server-paged list sends the shared default limit, not the API 1000', async () => {
  const calls: Call[] = [];
  const api = fakeApi(
    {
      pods: [{ id: 'p1' }],
      pagination: { hasNextPage: true, nextCursor: 'c' },
    },
    calls
  );
  const result = await dispatchGeneratedTool(api, tool('list-pods'), {});
  assert.equal(calls[0].url.searchParams.get('limit'), `${DEFAULT_LIST_LIMIT}`);
  assert.deepEqual(
    (result.payload as { pagination: Record<string, unknown> }).pagination,
    {
      returned: 1,
      hasNextPage: true,
      nextCursor: 'c',
      note: 'More results exist. Pass cursor=nextCursor to fetch them.',
    }
  );

  await dispatchGeneratedTool(api, tool('list-pods'), {
    limit: 5000,
    cursor: 'c',
  });
  assert.equal(calls[1].url.searchParams.get('limit'), `${MAX_LIST_LIMIT}`);
  assert.equal(calls[1].url.searchParams.get('cursor'), 'c');
});

test('an unpaged API list is paged here and keeps the fields beside its rows', async () => {
  const calls: Call[] = [];
  const records = Array.from({ length: 45 }, (_, i) => ({ amount: i }));
  const api = fakeApi({ records, metadata: { currency: 'USD' } }, calls);
  type Page = {
    records: Array<{ amount: number }>;
    metadata: unknown;
    pagination: { returned: number; hasNextPage: boolean; nextCursor: string };
  };

  const first = (await dispatchGeneratedTool(api, tool('list-pod-billing'), {}))
    .payload as Page;
  assert.equal(first.records.length, DEFAULT_LIST_LIMIT);
  assert.deepEqual(first.metadata, { currency: 'USD' });
  assert.equal(first.pagination.hasNextPage, true);
  // The API takes no paging arguments, so none are sent.
  assert.equal(calls[0].url.searchParams.has('limit'), false);
  assert.equal(calls[0].url.searchParams.has('cursor'), false);

  const second = (
    await dispatchGeneratedTool(api, tool('list-pod-billing'), {
      cursor: first.pagination.nextCursor,
    })
  ).payload as Page;
  assert.equal(second.records[0].amount, 20);

  const last = (
    await dispatchGeneratedTool(api, tool('list-pod-billing'), {
      cursor: second.pagination.nextCursor,
    })
  ).payload as Page;
  assert.equal(last.records.length, 5);
  assert.equal(last.pagination.hasNextPage, false);
  assert.equal(last.pagination.nextCursor, null);
});
