<h1 align="center">x-agint MCP</h1>

<p align="center">
  Three Model Context Protocol servers that give an AI agent a working computer:<br/>
  a shell, a filesystem, and a browser.
</p>

<p align="center">
  <a href="#bashsystem">bashsystem</a> ·
  <a href="#filesystem">filesystem</a> ·
  <a href="#browser">browser</a> ·
  <a href="#install">install</a> ·
  <a href="#benchmarks">benchmarks</a> ·
  <a href="#tools">all tools</a>
</p>

---

Every screenshot and video in this repository was captured from a **real website** by these servers
— no mockups, no fixtures. The flight prices are quotes the site actually returned; the song is
actually playing.

Each server's full tool reference lives in `docs/`, one directory per server:
**[bashsystem](docs/bashsystem/bashsystem.md)** · **[filesystem](docs/filesystem/filesystem.md)** ·
**[browser](docs/browser/browser.md)**. The combined index is the [Tools](#tools) section below.

| | |
|---|---|
| [`bashsystem`](#bashsystem) | run shell commands, with a permission model that survives `rm` |
| [`filesystem`](#filesystem) | read / write / search files inside an allowlist |
| [`browser`](#browser) | drive Chromium: read pages as structured text, click, fill, debug |

All three are **stdio or HTTP MCP servers**, so they work with any MCP client (Claude Desktop,
Cursor, Cline, or your own agent host).

---

## What an agent actually does with them

### Book a flight — read, then act on what it read

A flight booking site is not a static document — the agent has to drive it. This sequence was
captured live through the MCP tools; each frame below **is** one tool call's screenshot, written by
that same call (`filePath`), so the image and the tool log come from the same action.

![flight booking flow](assets/flight-demo/flight-booking.gif)

<table>
<tr>
<td width="25%"><img src="assets/flight-demo/flight-01-form.jpg" alt="Fliggy flight form: Beijing to Hangzhou, 2026-11-24"/></td>
<td width="25%"><img src="assets/flight-demo/flight-02-results.jpg" alt="Result list: 47 flights with times, airports, on-time rate and price"/></td>
<td width="25%"><img src="assets/flight-demo/flight-03-filters.jpg" alt="Departure-time filter dropdown opened by the agent"/></td>
<td width="25%"><img src="assets/flight-demo/flight-04-filtered.jpg" alt="List narrowed to morning departures after the filter was checked"/></td>
</tr>
<tr>
<td><code>browser_page_open</code> — form prefilled 北京 → 杭州, 2026-11-24</td>
<td><code>browser_page_click</code> on <code>搜索机票</code> → a new tab with the flight list</td>
<td><code>browser_page_search</code> / <code>click</code> → 起飞时段 dropdown</td>
<td><code>browser_page_click</code> on 上午 (00:00-11:59) → list narrows to 07:25–11:30 departures</td>
</tr>
<tr>
<td width="25%"><img src="assets/flight-demo/flight-05-afternoon.jpg" alt="Afternoon filter selected, morning cleared"/></td>
<td width="25%"><img src="assets/flight-demo/flight-06-cheapest.jpg" alt="Price-sorted ascending: Xiamen Air MF8150 at 260 yuan is the cheapest afternoon flight"/></td>
<td width="25%"><img src="assets/flight-demo/flight-07-selected.jpg" alt="Fare panel expanded for the cheapest fare, showing the airline-direct 260 yuan economy option"/></td>
<td width="25%"><img src="assets/flight-demo/flight-08-login.jpg" alt="Booking click lands on the login wall with the order-confirm URL in redirectURL"/></td>
</tr>
<tr>
<td><code>browser_page_click</code> — swap 上午 off, 下午 (12:00-17:59) on</td>
<td><code>browser_page_click</code> on the price column → ascending; first row ¥260</td>
<td><code>browser_read_element_children</code> → the exact <code>&lt;button aria-label="预订"></code></td>
<td><code>click</code> that button → order page, behind login</td>
</tr>
</table>

The submit button is found by its **visible label**, not a selector: `browser_page_search("搜索机票")`
returns one hit at `[149]`, and clicking `[149]` opens the results tab. The same index space runs
through the whole flow — checking 上午 removes 47 rows and re-renders only morning departures, which
the click return reports as `NODE_REMOVED` / `NODE_ADDED` rather than leaving the agent to guess.

Then it *chooses*, from what it read. Swapping the filter to 下午 leaves six afternoon flights; sorting
by price (`click [225]` — the column title flips to 「点击按票价从高到低」, which is how the ascending
state is confirmed) puts the cheapest first, and reading the rows one at a time gives the comparison:

| Afternoon flight | Price | Seats |
|---|---|---|
| **厦航 MF8150** 13:10→15:20 大兴/萧山T3 | **¥260 (1.2折)** | 3张 |
| 东航 MU5147 12:20 | ¥300 | 少量 |
| 南航 CZ8627 12:25 | ¥300 | 少量 |
| 东航 MU5191 14:00 | ¥300 | 少量 |
| 东航 MU5133 15:35 | ¥350 | 少量 |
| 河北 NS8033 17:15 | ¥400 | 少量 |

MF8150 is the cheapest **and** a full-service carrier — the expanded fare panel says 航司直营 ·
托运行李20公斤, so it is not a baggage-excluded budget fare. `browser_read_element_children [5340]`
then names the exact control (`[5369]<button aria-label="预订">`), and clicking it navigates to
`fbuy.fliggy.com/travel/confirm_order.htm?…bizType=flight…quantity:1` — wrapped in a login redirect,
because no credentials are held here. **The agent gets the booking flow started; it does not log in as
you or pay.**

The point is not that it can screenshot a page. It is that **the read and the act share one
coordinate system**: the `[N]` index the agent read at is the same index it clicks minutes later.

### Play a recommended playlist — picking, not just pressing

Same capture method on a music site: open the library, *choose* from what the page recommends, then
play it. Each frame is one tool call's own screenshot.

![recommended playlist flow](assets/migu-demo/migu-playlist.gif)

<table>
<tr>
<td width="25%"><img src="assets/migu-demo/migu-01-library.jpg" alt="Migu music library home with the recommended-playlist carousel"/></td>
<td width="25%"><img src="assets/migu-demo/migu-02-playlist.jpg" alt="Playlist detail page with 161 tracks and a play-all button"/></td>
<td width="25%"><img src="assets/migu-demo/migu-03-playing.jpg" alt="First track playing, progress bar running and the row marked as playing"/></td>
<td width="25%"><img src="assets/migu-demo/migu-04-next.jpg" alt="Second track playing after next, the playing marker moved to that row"/></td>
</tr>
<tr>
<td><code>browser_page_open</code> — 乐库 home: a **推荐歌单** carousel with five playlists and play counts</td>
<td><code>browser_page_click</code> on the cover title → <code>#/playlist?playlistId=227616725</code>, **共161首**</td>
<td><code>browser_page_click</code> on <code>[912] 播放全部</code> → playing, <code>00:05 / 04:40</code></td>
<td><code>browser_page_click</code> on <code>[798] 下一首</code> → track 02, <code>00:16 / 04:35</code></td>
</tr>
</table>

The choice is made from the read. The home page lists five recommended playlists **with their play
counts** (`196.6万`, `305.0万`, `84.1万`, `198.6万`, …), so the agent picks the most-played one —
【华语怀旧向】80后的青春旧唱片 — rather than taking whatever is first.

And it never has to trust a click. The return value of each action *is* the evidence:

```text
click [912] 播放全部  ->  time: 00:01 / 04:40
                        <tr class="el-table__row playing-row">   ← row 01 marked
                        title="暂停"                             ← button flipped to pause
click [4783] (pause)  ->  playing-row removed, title="播放", time frozen at 00:15
click [4794] 下一首    ->  playing-row now on row 02
                        song-name: 单身情歌 / singers: 林志炫, 00:02 / 04:35
```

A pause is proven by the *absence* of the playing marker and a frozen timestamp — not by assuming the
button worked. That round trip (play → pause → resume → next) is what makes the demo verifiable rather
than decorative.

### Why every action returns the page it changed

The two demos above are also the verification story: the agent never has to guess whether a click
worked, because each action tool returns the page *after* the change. That is why the playlist demo
can prove a pause (the `playing-row` class disappears and the timestamp freezes) rather than assume
one, and why the flight demo can confirm the sort direction from a column title instead of trusting
the click.

### Screenshots that land where you asked

The screenshot tools save to a file and return `{ filePath, fileSize }` — the same call both produces
the image and names where it went. That is how every frame in both demos above was made: no separate
screen recorder, so the image and the tool log cannot disagree.

`filePath` must be absolute or start with `~/`, and is checked against the server's allowed
directories — relative paths are refused. Omit it and the image lands in
`~/.x-agint/browser/screenshots`, which is cleared on every server start so the directory never
accumulates.

The GIFs are assembled by [`scripts/make-gif.mjs`](scripts/make-gif.mjs) from a `steps.json` that names
the tool behind each frame, so both demos regenerate end to end:

```bash
node scripts/make-gif.mjs --steps assets/flight-demo/steps.json --out assets/flight-demo/flight-booking.gif
node scripts/make-gif.mjs --steps assets/migu-demo/steps.json  --out assets/migu-demo/migu-playlist.gif
```

The caption strip is rendered in a browser and composited with `overlay` — this ffmpeg build has no
`drawtext`/`ass`/`subtitles`, so text cannot be drawn by a filter. The strip is translucent (a solid
bar hid the page content underneath it) and names the tool only: arguments are long and belong in
prose.

---

## bashsystem

Run shell commands on the host. The interesting part is what it refuses.

```jsonc
// MCP config
{ "command": "x-bashsystem" }
```

**A deny-list of dangerous paths always misses one.** So `rm` is not matched by pattern — it is
checked against an *allowlist of directories*: a delete is allowed when its target resolves inside
one, refused otherwise. That holds for forms a regex cannot express:

```bash
{ rm -rf /etc; }        # refused — command boundary detected
( rm -rf /usr )         # refused
if true; then rm -rf /  # refused — control keyword starts a command
for f in x; do rm "$f"; done   # refused — the payload after `do` is judged
env X=1 rm -rf /var     # refused — exec wrappers unwrapped to the real command
```

Other structural guards: `mkfs`, raw-device writes (`dd of=/dev/disk…`), `find -exec` (judged by its
reconstructed payload; `-execdir` with a deleting payload is refused outright because per-match
directory execution cannot be confined), `su`/`doas`, and `chmod` — where only the *recursive* form
is policed, on purpose.

Two layers, deliberately separate:

| Layer | Where it lives | Removable? |
|---|---|---|
| Hard blocks | compiled into the server | **no** |
| Configurable blocks | `blockedCommands` in `config.json` | yes |
| sudo | `sudoCommands` — an **allowlist**: a match means permitted | per-user policy |

Long-running work does not block the call:

```jsonc
{ "command": "npm run dev", "background": true }
// -> { status: "backgroundStarted", pid, pgid, logPath }
```

Foreground commands are detached into their own process group, so cleanup reaches grandchildren
(`SIGKILL` to `-pgid`) rather than leaving orphans — the failure mode that plagues naive MCP shell
tools.

---

## filesystem

Read, write, search and manage files inside an allowlist.

```jsonc
{ "command": "x-filesystem" }
```

**Reading is windowed by design.** A 12,000-line log does not have to be slurped:

```jsonc
{ "path": "app.log", "offset": -50 }                 // last 50 lines (negative counts from the end)
{ "path": "app.log", "offset": 900, "count": 200 }
{ "path": "small.md", "tryFullRead": true }           // as much as fits, capped at 500
```

Results report `from` / `to` / `total`, so the agent knows whether to page further.

**Editing is targeted, not whole-file.** `edit_file` applies exact-text replacements, with `dryRun`
to preview and `needDiff` for a unified diff. Writes are atomic (`wx` + temp file + rename).

**Searching beats walking.** `search_text` shells out to ripgrep via `execFile(rgPath, argv[])` —
never a built shell string from user input.

Every handler starts with `validatePath()`: the allowlist is enforced lexically, follows symlinks via
`realpath`, and validates the nearest existing ancestor for new files. A path outside is refused
before any filesystem call happens.

---

## browser

Drive Chromium through Playwright. The design bet: **text beats screenshots** for an agent.

```jsonc
{ "command": "x-browser" }
```

A page read returns a tree of nodes, each with a stable `[N]` index and markers describing what the
node *is*:

```
[VIEWPORT]{SCROLLABLE width=940 height=968 scrollWidth=1214 scrollHeight=2764 scrollTop=0}
[114]<input id="form_depCity" aria-label="出发城市，可直接输入城市名称搜索" value="北京">
[142]<input id="form_depDate" aria-label="出发日期，可直接输入如2026-04-09, 输入完成后，关闭日历"
       value="2026-11-24">
[149]<button class="search-button" aria-label="搜索北京到杭州的机票，跳转列表"> 搜索机票
```

Captured from the flight demo above. The button's whole action is in its `aria-label`, so searching
the visible text `搜索机票` returns exactly one hit — and `[149]` is what gets clicked.

That encoding is what makes everything else cheap:

- **`{SCROLLABLE}`** carries `scrollWidth/Height` and the current offset — the agent knows content
  exists below *without* scrolling to discover it.
- **`{INNERTEXT_MOREABLE total=508}`** says 508 lines exist, 20 shown — read more only if needed.
- **The `[N]` is stable for the node's lifetime**, so `search → click → re-read` address the same
  element. No re-locating by CSS, no brittle selectors.

Cost-ordered reading (each step heavier than the last):

| | tool | when |
|---|---|---|
| 1 | the return value of the action you just took | always first — actions return the changed page |
| 2 | `browser_element_search` / `browser_page_search` | you have a keyword |
| 3 | `browser_get_element_content` / `browser_read_element_*` | you know `[N]` |
| 4 | `browser_get_viewport_content` | fallback, whole page unknown |
| 5 | `browser_page_evaluate` | last resort — runs JS, re-reads the page before and after |

### Debugging what the page cannot show you

The capture channel writes to disk, so it is auditable after the fact:

```jsonc
{ "id": "…", "options": { "network": true } }
// -> filePath: …/page-<id>/network-<…>.jsonl — one JSON object per line, safe to tail live
```

Real example from this repo's material — proving a streaming player actually fetched audio when the
DOM showed nothing:

```text
app.c.nf.migu.cn/strategy/pc/can-listen/v1.0            ← permission check
app.c.nf.migu.cn/…/listen/v2.0?…copyrightId=60054704101
→ d.musicapp.migu.cn/data/oss/resource/00/3u/hb/fe30fb977b88415b921b3cb31f953a25   ← the audio
```

The page had **no `<audio>` element and no player global on `window`**, so `querySelector('audio')`
returned null and there was nothing to read visually. The answer came from the network capture plus
`performance.getEntriesByType('resource')` (152 entries). Full write-up:
**[docs/browser/debugging.md](docs/browser/debugging.md)**.

Console capture works the same way, including `pageerror` for uncaught exceptions — which is how you
find a failure that never rendered anything.

A full worked run — a foreign market-data page, 75 fetch/XHR records narrowed to the one inline quote call
that feeds its market bar: **[docs/browser/inspect-demo.md](docs/browser/inspect-demo.md)**.

---

## Install

```bash
npm install @x-agint/bashsystem @x-agint/filesystem @x-agint/browser
```

Each ships a CLI. `--help` is written **for an agent to read**, and always carries the minimal MCP
host config (both the stdio spawn form and the HTTP connect form):

```bash
x-bashsystem --help
x-filesystem --help
x-browser --help
```

`browser` downloads Chromium in `postinstall`; if that download fails it does not break install —
the failure surfaces at runtime with instructions.

### HTTP instead of stdio

For a machine you reach over a network rather than a process you spawn:

```jsonc
{
  "mcpServers": {
    "remote-box": {
      "url": "https://<host>/fs/mcp",
      "headers": { "X-MCP-Endpoint": "<mcpAuthToken>" }
    }
  }
}
```

Note the header name: **`X-MCP-Endpoint`**, not `Authorization: Bearer`. A token never changes what
is bound — set `mcpHost` explicitly, keep the primary instance on `127.0.0.1`, and put a
TLS-terminating proxy in front (this repo's own setup uses `tailscale serve`, tailnet-only).

The allowlist is enforced **on the machine the server runs on**. Nothing a client sends widens it.

---

## Benchmarks

Measured on this host, not marketing numbers — one benchmark suite over these three servers, running
representative tasks against live websites.

| | |
|---|---|
| Model | `deepseek-v4-flash` |
| Tasks completed | **5 / 5** |
| Total wall time | **122.2 s** |
| Tokens consumed | 774,650 (cache-miss: 53,449) |
| Tool calls | 40 |

The token figure is the honest one to read: MCP tools are text-heavy, and a page read costs real
tokens. That is *why* the read tools are windowed and cost-ordered rather than dumping pages.

---

## Tools

Every tool listed in the per-server docs was read from a **running server** via MCP `tools/list` — not
copied from documentation. Signatures use `name(arg, opt?)`: required args first, optional marked `?`.

| Server | Tools | Doc |
|---|---|---|
| [`bashsystem`](docs/bashsystem/bashsystem.md) | **7** | permission model: hard blocks vs configurable blocks vs the sudo allowlist; why `rm` is an allowlist check and not a pattern |
| [`filesystem`](docs/filesystem/filesystem.md) | **16** | the path allowlist, and line-window reads where `offset: -50` means "last 50 lines" |
| [`browser`](docs/browser/browser.md) | **33** | the `[N]` index model, marker blocks, and the cost order for reading a page |

**56 tools total.**

### Why per-package docs instead of one flat list

The three servers share almost nothing at the interface level. `bashsystem`'s interesting content is its
permission model; `filesystem`'s is path validation and line windows; `browser`'s is a node-index model
and a cost ordering that decides which of 33 tools to call. A single flat list would flatten exactly the
parts that need explaining.

### Verifying a catalog yourself

The three servers expose `tools/list` over Streamable HTTP, so the authoritative list is one request away:

```bash
x-browser --server status          # prints its url, e.g. http://127.0.0.1:3007/mcp

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

Passing a made-up option name is silently accepted, the header never goes out, and the server answers 401
— which looks like a wrong token when the token was fine.

### Reading a real tool-call trace

Both demos above are driven through MCP, and each frame's tool is recorded in its `steps.json`
([`assets/flight-demo/steps.json`](assets/flight-demo/steps.json),
[`assets/migu-demo/steps.json`](assets/migu-demo/steps.json)). The playlist demo's call chain, with the
evidence each call returned:

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

---

## Design notes worth stealing

1. **Return the world after the action.** Every mutating tool returns the changed state. The agent
   needs no separate verification call, and cannot silently believe an action worked.
2. **Make volume explicit.** `{INNERTEXT_MOREABLE total=508}`, `from`/`to`/`total` in file reads — a
   truncated payload says so, instead of looking complete.
3. **Stable identity beats re-locating.** A node's `[N]` survives across calls; CSS selectors and
   pixel coordinates do not.
4. **Guard structure, not strings.** A deny-list regex for `rm` leaked 12 of 16 shell forms when
   tested. Parsing tokens and checking an allowlist is what actually holds.
5. **Errors are addressed to the model.** "Try `browser_page_list` to see open pages" beats "page not
   found", because the next action is the point.
6. **Keep the daemon and the browser separate.** Ending a session must not kill a browser that still
   owns pages — and stopping the daemon deliberately does *not* stop the server, which is why every
   cleanup script must stop both or Chromium is orphaned at PID 1.

---

## License

MIT — see [LICENSE](LICENSE).

The npm packages are published; **their source is not**. This repository is documentation and
reproducible capture scripts only. The scripts under [`scripts/`](scripts/) drive the published
servers over MCP, so every asset here can be regenerated without the implementation.
