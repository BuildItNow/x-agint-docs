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

## Reading a real tool-call trace

Both README demos are driven through MCP, and each frame's tool is recorded in its `steps.json`
(`assets/flight-demo/steps.json`, `assets/migu-demo/steps.json`). The playlist demo's call chain, with
the evidence each call returned:

```jsonc
// browser_page_open   -> 乐库 home; the read lists recommended playlists WITH play counts
//                        196.6万 / 305.0万 / 84.1万 / 198.6万 …
// browser_page_click [302]  -> URL becomes #/playlist?playlistId=227616725, list reports 共161首
// browser_page_search "播放全部" -> one hit: [912]<span class="active"> 播放全部
// browser_page_click [912]  -> time: 00:01 / 04:40
//                             <tr class="el-table__row playing-row">   ← row 01 marked
//                             title="暂停"                             ← button flipped to pause
// browser_page_click [798] 下一首 -> playing-row moves to row 02,
//                                    song-name: 单身情歌 / singers: 林志炫, 00:02 / 04:35
```

Note the shape: **locate by visible text → act on the returned `[N]` → read the change from the same
call's return**. The agent never re-reads the whole page — it narrows. And a pause is proven by the
*absence* of `playing-row` plus a frozen timestamp, not by assuming the button worked.
