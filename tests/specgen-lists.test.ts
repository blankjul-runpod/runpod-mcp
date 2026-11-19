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

test('an empty success from a list answers with its status, not nothing', async () => {
  const api = createRunpodClient({
    apiKey: 'test',
    fetch: async () => new Response(null, { status: 204 }),
  });
  const result = await dispatchGeneratedTool(api, tool('list-secrets'), {});
  assert.equal(result.ok, true);
  assert.deepEqual(result.payload, { status: 204 });
});

// Every hand-written list answers in the shared shape: its rows under the
// resource's key, and the pagination block with exactly these keys.
test('every curated list answers with its rows and the shared pagination block', async () => {
  const many = (make: (i: number) => object) =>
    Array.from({ length: 25 }, (_, i) => make(i));
  const ctx = {
    sdk: {
      // Like the API: returns `limit` rows and says more exist.
      GET: async (
        _path: string,
        init: { params: { query: { limit: number } } }
      ) => ({
        data: {
          endpoints: many((i) => ({ id: `ep${i}` })).slice(
            0,
            init.params.query.limit
          ),
          templates: many((i) => ({ id: `t${i}` })).slice(
            0,
            init.params.query.limit
          ),
          pagination: { hasNextPage: true, nextCursor: 'next' },
        },
        response: new Response(null, { status: 200 }),
      }),
    },
    graphql: {
      public: async () => ({
        listings: many((i) => ({
          id: `l${i}`,
          repoOwner: 'o',
          repoName: `r${i}`,
        })),
        allAiApiPublicConfigs: many((i) => ({
          id: `pe${i}`,
          aiApiId: `a${i}`,
          modelName: `model-${i}`,
          displayName: `Model ${i}`,
          isLive: true,
        })),
        gpuTypes: many((i) => ({
          id: `GPU ${i}`,
          displayName: `GPU ${i}`,
          memoryInGb: 24,
          secureCloud: true,
          communityCloud: false,
          securePrice: 1,
          communityPrice: null,
          lowestPrice: {
            stockStatus: 'Low',
            uninterruptablePrice: 1,
            gpuTypeCudaVersions: [
              { cudaVersion: '13.2', availability: 'AVAILABLE' },
            ],
          },
        })),
      }),
    },
  } as never;
  const rowsKey: Record<string, string> = {
    'list-endpoints': 'endpoints',
    'list-templates': 'templates',
    'list-hub-repos': 'repos',
    'list-public-endpoints': 'endpoints',
    'list-guides': 'guides',
    'get-capacity': 'gpus',
  };
  const curatedLists = curatedTools.filter(
    (candidate) =>
      candidate.name.startsWith('list-') || candidate.name === 'get-capacity'
  );
  assert.deepEqual(
    curatedLists.map((candidate) => candidate.name).sort(),
    Object.keys(rowsKey).sort(),
    'a new curated list needs its rows key here'
  );
  for (const list of curatedLists) {
    const result = await list.handler(ctx, {});
    assert.equal(result.ok, true, list.name);
    const payload = result.payload as Record<string, unknown> & {
      pagination: Record<string, unknown>;
    };
    const rows = payload[rowsKey[list.name]];
    assert.ok(Array.isArray(rows), `${list.name} rows`);
    assert.equal(rows.length, DEFAULT_LIST_LIMIT, `${list.name} page size`);
    assert.deepEqual(
      Object.keys(payload.pagination).sort(),
      ['hasNextPage', 'nextCursor', 'note', 'returned'],
      `${list.name} pagination`
    );
    assert.equal(payload.pagination.hasNextPage, true, list.name);
    assert.ok(!('items' in payload), `${list.name} still returns items`);
  }
});
