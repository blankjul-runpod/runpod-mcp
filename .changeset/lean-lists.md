---
'@runpod/mcp-server': minor
---

Every list tool now pages the same way: `limit` (1 to 100, default 20) and `cursor` in, and the rows plus `pagination: { returned, hasNextPage, nextCursor }` out. Follow `nextCursor` while `hasNextPage` is true.

- The 13 lists the API pages (`list-pods`, `list-clusters`, `list-network-volumes`, `list-audit-logs` and others) now return 20 rows per call by default instead of the API's 1000 (or 100 or 200), and at most 100.
- The 17 lists the API returns whole (`list-gpu-types`, `list-data-centers`, `list-cpu-types`, the six billing lists, `list-cluster-pods`, `list-endpoint-workers`, `list-public-templates`, `list-secrets`, `list-registries`, `list-delegations`, the organization users, roles and invites) now take `limit` and `cursor` and return one page. Fields beside the rows, such as billing `metadata` or the worker `summary`, are kept.
- `list-guides` pages its 118 guides the same way; `count` is replaced by `pagination`.
- Rows sit under the resource's own key: `list-endpoints` returns `endpoints`, `list-hub-repos` returns `repos`, `list-public-endpoints` returns `endpoints` and `get-capacity` returns `gpus` (all were `items`). Their `pagination` drops `total`, `offset` and `truncated`.

A caller that reads only the first page, or reads `items`, sees fewer rows: follow `pagination.nextCursor`.
