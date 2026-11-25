---
'@runpod/mcp-server': minor
---

Set `MCP_PAGE_BUDGET_BYTES` to lower the byte budget of a list page (default 24,000) for clients with a small context window. A value that is not a plain positive integer keeps the default, and a value above 24,000 is capped at it.
