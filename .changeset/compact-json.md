---
'@runpod/mcp-server': minor
---

Tool results are now compact JSON instead of JSON indented by two spaces. A result under its size cap costs about 13 to 19% fewer tokens on current Claude models. A list page that reaches the 24,000-byte budget, which measures the text as sent, holds more rows instead: about a fifth more on flat lists such as `list-guides`, more on nested rows such as Pods, so walking a long list takes fewer calls. Set `MCP_PRETTY_RESPONSES=true` to switch back to indented JSON.

Two changes keep agents paging correctly on compact results. `pagination.nextCursor` is now opaque: decoded, it no longer shows readable fields, which some models rebuilt instead of copying. And the connect instructions say to pass `nextCursor` exactly as returned, and to count by filtering the list and reading `pagination.total` instead of paging. Text results such as READMEs are unchanged.
