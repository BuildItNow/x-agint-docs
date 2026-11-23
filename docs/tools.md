# Tools

Every tool listed here was read from a **running server** via MCP `tools/list` — not copied from
documentation. Signatures use `name(arg, opt?)`: required args first, optional marked `?`.

| Server | Tools | Doc |
|---|---|---|
| [`bashsystem`](bashsystem.md) | **7** | permission model: hard blocks vs configurable blocks vs the sudo allowlist; why `rm` is an allowlist check and not a pattern |
| [`filesystem`](filesystem.md) | **16** | the path allowlist, and line-window reads where `offset: -50` means "last 50 lines" |
| [`browser`](browser.md) | **33** | the `[N]` index model, marker blocks, and the cost order for reading a page |

**56 tools total.**

---

## Why per-package docs instead of one list

The three servers share almost nothing at the interface level. `bashsystem`'s interesting content is its
permission model; `filesystem`'s is path validation and line windows; `browser`'s is a node-index model and
a cost ordering that decides which of 33 tools to call. A single flat list would flatten exactly the parts
that need explaining.

---

## Verifying a catalog yourself

The three servers expose `tools/list` over Streamable HTTP, so the authoritative list is one request away:

```bash
# browser daemon (already running once any browser tool has been used)
x-browser --server status                    # prints its url, e.g. http://127.0.0.1:3007/mcp

# filesystem / bashsystem as HTTP instances
x-filesystem --config-path ~/.x-agint/filesystem/config.json --server start
x-bashsystem --server start
```

Any MCP client works. If you script it with the official SDK, note that the auth header must ride on
**every** request (POST, the SSE GET, and DELETE):

```js
const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { 'X-MCP-Endpoint': token } },   // not `fetchImpl` — that key is ignored
});
```

Passing a made-up option name is silently accepted, the header never goes out, and the server answers 401 —
which looks like a wrong token when the token was fine.

---

## Reading a real tool-result trace

`assets/demos/mcp-calls.jsonl` holds a captured 7-call browser session, one JSON object per call:

```jsonc
{"tool":"browser_page_open",              "ok":true, "args":{"url":"https://en.wikipedia.org/wiki/Model_Context_Protocol"}}
{"tool":"browser_get_viewport_content",  "ok":true, "args":{"id":"edd391ad-…","count":24}}
{"tool":"browser_page_search",           "ok":true, "args":{"id":"edd391ad-…","text":"transport"}}
{"tool":"browser_page_scroll",           "ok":true, "args":{"id":"edd391ad-…","yDirection":"down"}}
{"tool":"browser_get_viewport_content",  "ok":true, "args":{"id":"edd391ad-…","count":24}}
{"tool":"browser_page_screenshot_for_llm","ok":true,"args":{"id":"edd391ad-…"}}
{"tool":"browser_page_close",            "ok":true, "args":{"id":"edd391ad-…"}}
```

Steps sit ~2.8 s apart. Note the shape: `read → search → scroll → read`. The agent never re-reads the whole
page — it narrows.
