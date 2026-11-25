---
'@runpod/mcp-server': minor
---

The byte budget of a list page is now configurable with `MCP_PAGE_BUDGET_BYTES` (default 24,000): lower it for a client with a small context window, raise it for one that takes large results. A value that is not a plain positive integer keeps the default.
