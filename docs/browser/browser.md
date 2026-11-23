# browser

Drive a real Chromium through MCP: read pages, search, click, fill, scroll, screenshot.

```bash
npm install @x-agint/browser   # postinstall downloads Chromium
```

```jsonc
{ "mcpServers": { "browser": { "command": "x-browser" } } }   // stdio
```

- npm: `@x-agint/browser` · latest **1.0.3**
- tools: **33** (read live from `tools/list`, not copied from docs)
- runtime: a long-lived **daemon** the MCP host talks to, which spawns a detached **browser server** on
  demand that owns Chromium. `browser_open`/`browser_close` are handled by the daemon itself and are not
  forwarded — a server cannot start or stop itself.

---

## The cost order — this is the whole design

The tools are ranked by how expensive they are. Reach down the list only as far as needed; the further you
get, the more redundant information comes back.

1. **The return value of an action** — `browser_page_click`, `_fill`, `_scroll` etc. all return the page
   *after* the change. Judge success from that first; do not re-read.
2. **`browser_element_search` / `browser_page_search`** — you have a keyword: find the node and its index,
   without reading a large region. Scoped (element) search first, whole-page as fallback.
3. **`browser_get_element_content(N)`** — index known, need that node's full content.
4. **`browser_read_element_*`** — index known, expand structure precisely:
   `innertext` (text only, lightest) · `children` (windowed children) · `ancestors` (ownership) ·
   `attributes` (every real attribute)
5. **`browser_get_viewport_content`** — fallback: page refreshed, no keyword, index unknown.
6. **`browser_page_evaluate`** — last resort; it re-reads the page before *and* after to diff changes.

---

## The `[N]` index model

Bulk output marks nodes as `[N]<tag>`, and **the index stays stable for the lifetime of that DOM node**.
It is also reachable from inside a script — the index is the node's `__xagent_data_id` attribute:

```js
document.querySelector('[__xagent_data_id="12"]')?.innerText
```

A marker block may follow the index; the first word is the type, the rest are `k=v` pairs:

| Marker | Meaning |
|---|---|
| `{SCROLLABLE width height scrollWidth scrollHeight scrollLeft scrollTop}` | node can scroll; sizes are CSS pixels. Content larger than the box on an axis means that axis overflows — scroll it with `browser_page_scroll` passing this `[N]`. `width/height` are `clientWidth/clientHeight` for an element (scrollbar excluded) but `innerWidth/innerHeight` for the viewport (scrollbar included) — asymmetric on purpose |
| `{CHILD_OF_PARENT index=N}` | the node's 1-based ordinal in its parent's child list; only printed when the parent's retained children are non-contiguous |
| `{CHILD_MOREABLE total from to}` | children not fully returned; page with `browser_read_element_children` |
| `{INNERTEXT_MOREABLE total from to}` | innerText truncated by line; page with `browser_read_element_innertext` |
| `{INNERTEXT}` | content presented as concatenated innerText (non-structured children) |

Markers stack: `[5]{CHILD_OF_PARENT index=3}{SCROLLABLE …}{CHILD_MOREABLE total=40 from=1 to=10}<div>`.

---

## Tools (33)

### Browser lifecycle (2)
```
browser_open()
browser_close()
```
`browser_open` is safe when already open — it reuses the browser and brings the window forward.
`browser_close` ends the session; the next open starts fresh.

### Page lifecycle (8)
```
browser_page_open(url)              browser_page_list()
browser_page_navigate_to(id, url)   browser_page_info(id)
browser_page_back(id)               browser_page_close(id)
browser_page_forward(id)            browser_page_reload(id)
```

### Reading — cheapest first (7)
```
browser_read_element_innertext(id, index, offset?, count?, tryFullRead?)   # 20 lines default, max 100
browser_read_element_children(id, index, offset?, count?, tryFullRead?)    # 10 children default, max 50
browser_read_element_ancestors(id, index, level?)                          # 3 levels up default
browser_read_element_attributes(id, index)
browser_get_element_content(id, index, offset?, count?, tryFullRead?)      # 250 default, max 500
browser_get_viewport_content(id, offset?, count?, tryFullRead?)            # 500 default, max 1000
browser_page_inspect(id, options?)
```

All reads report `from` / `to` / `total`, and every child returned by `read_element_children` carries an
`[N]` usable directly in the next call.

**Why `read_element_attributes` exists**: bulk output is lossy *by design* — `class` is truncated when
long, `<a href>` is trimmed to its path, `<img src>` is dropped. Only this tool returns every attribute as
it truly is: full class, complete href (domain, query, hash), `src` including inline base64, `data-*`,
`target`, `style`.

The structure returned is a tree of **ancestor-descendant** relations, not direct parent-child — and a
paged payload always leads with its `[VIEWPORT]` line even when the window is empty (`count: 0`, or an
offset past the end): one line with `from`/`to`/`total` at 0. A node-level read has no viewport line and
genuinely can be empty.

### Searching (2)
```
browser_page_search(id, text, useRegex?, maxResults?, level?)
browser_element_search(id, index, text, useRegex?, maxResults?, level?)    # scoped: prefer
```

Matching is over **visually readable** content, in this order: `#text` node text →
`placeholder`/`title`/`alt`/`aria-label` → a form control's current runtime `value` (what the user actually
typed) → falling back to `innerText`.

Hits come back as **one forest, not one path per hit**: hits sharing an ancestor print it once, unrelated
tops are separated by a blank line (`''` when nothing matched), and order is DOM order (the walk is
depth-first). The result is a single string, not an array.

### Interaction (9) — every one returns the page after the change
```
browser_page_click(id, index)
browser_page_fill(id, index, value)
browser_page_hover(id, index)
browser_page_press_key(id, key)
browser_page_select_option(id, index, value)
browser_page_double_click(id, index)
browser_page_check(id, index)
browser_page_uncheck(id, index)
browser_page_scroll(id, index?, xDirection?, yDirection?)
```

`press_key` is page-level: focus the input with `browser_page_click` first, then submit. Keys are named
(`Enter`, `Escape`, `Tab`, `ArrowDown`, …).

`browser_page_scroll` — omit `index` to scroll the whole viewport (`[VIEWPORT]{SCROLLABLE …}`), or pass the
`[N]` of a `[N]{SCROLLABLE …}` container. The two axes are independent: `down`/`up` move 80% of viewport
height, `top`/`bottom` jump to an end; giving only `xDirection` performs **no** vertical scroll; giving
neither defaults to `yDirection=down`; both scrolls diagonally.

### Positioning, scripting, screenshots (4)
```
browser_element_into_viewport(id, index)      # no-op when already visible; handles iframes + scroll containers
browser_page_evaluate(id, script, timeoutMs?)
browser_page_screenshot_for_llm(id)
browser_element_screenshot_for_llm(id, index) # prefer when the index is known: more precise, cheaper
```

`browser_page_evaluate` gotchas, all of which bite:

- The script is a **code body**, not a function: write `return document.title`, not `() => document.title`
  (a bare function evaluates to a function object and comes back `undefined`).
- Variables from the caller are not in scope — the script must be self-contained.
- Return JSON-serializable data. DOM nodes, functions and cyclic objects arrive as `undefined`.
- `await` works directly in the body.
- A body with no `return` is valid but yields no result.
- The default deadline is 120000 ms; **a script that exceeds it keeps running and leaves the page
  blocked**, so keep loops bounded.

### Meta (1)
```
browser_readme()
```
The built-in usage guide — the cost order above, plus CLI commands. Cheap way for an agent to re-read the
operating instructions mid-session.

---

## What these tools actually did, frame by frame

All four galleries below were captured **through these tools**, and every frame is one tool call's own
screenshot: the same call that acted on the page produced the image, which was then moved into the demo
directory. So the image
and the tool log cannot disagree — there was no separate screen recorder.

### Publish a repository to GitHub: driving a logged-in product UI

The first gallery drives a signed-in product rather than a public page — create an empty repo and push the local
history. Each frame is one tool call's own screenshot, named in call order; the agent never touches billing or
deletes anything.

![publish to GitHub flow](../../assets/github-demo/publish-to-github.gif)

<table>
<tr>
<td width="33%"><img src="../../assets/github-demo/gh-01-home.jpg" alt="GitHub dashboard, signed in as BuildItNow: Home pinned, Join GitHub Education banner, Good afternoon greeting"/></td>
<td width="33%"><img src="../../assets/github-demo/gh-02-create-menu.jpg" alt="The top-bar plus menu open: New issue, New repository, Import repository, New codespace, gist, organization, project"/></td>
<td width="34%"><img src="../../assets/github-demo/gh-04-named.jpg" alt="Create-repository form with x-agint-docs typed and the green 'x-agint-docs is available.' check; Owner BuildItNow, visibility Public"/></td>
</tr>
<tr>
<td><code>browser_page_open</code> → <code>github.com/</code>; signed in as <code>BuildItNow</code></td>
<td><code>browser_page_click</code> [55] the create “+” menu → <code>New repository</code> item appears</td>
<td><code>browser_page_fill</code> [130] "x-agint-docs" → return reports <code>x-agint-docs is available.</code></td>
</tr>
<tr>
<td width="33%"><img src="../../assets/github-demo/gh-03-form.jpg" alt="Empty Create-a-new-repository form: Owner BuildItNow, empty name field, Public selected, README/gitignore/license off"/></td>
<td width="33%"><img src="../../assets/github-demo/gh-05-created.jpg" alt="Empty repo page BuildItNow/x-agint-docs, Public, with the Quick setup remote URL and the 'push an existing repository' git commands"/></td>
<td width="34%"><img src="../../assets/github-demo/gh-06-pushed.jpg" alt="Same repo after push: file tree (.agents, assets, docs, scripts, README.md, package.json…), HEAD at f4a843f, README rendered"/></td>
</tr>
<tr>
<td><code>browser_page_click</code> [468] New repository → navigate to <code>/new</code></td>
<td><code>browser_page_open</code> the repo URL → Quick setup shows <code>…/x-agint-docs.git</code></td>
<td><code>git push -u origin main</code> then <code>browser_page_reload</code> → tree at <code>f4a843f</code></td>
</tr>
</table>

The proof is in the **fill return**, not the picture: typing the name makes GitHub add `x-agint-docs is available.`
to the same change set (`NODE_ADDED`). The create click leaves the page briefly unresponsive (the form POST runs a
long script); `browser_page_close` reports the tab had already navigated to `github.com/BuildItNow/x-agint-docs`
— that URL is the evidence the repo exists. The push is plain git (`git remote add origin … && git push -u origin
main`), the exact commands GitHub prints in the empty-repo Quick-setup panel (frame 5). Frames + tool log:
[`assets/github-demo/steps.json`](../../assets/github-demo/steps.json).

### Booking a flight: read, choose, act

![flight booking flow](../../assets/flight-demo/flight-booking.gif)

<table>
<tr>
<td width="25%"><img src="../../assets/flight-demo/flight-01-form.jpg" alt="Fliggy flight form: Beijing to Hangzhou, 2026-11-24"/></td>
<td width="25%"><img src="../../assets/flight-demo/flight-02-results.jpg" alt="Result list: 47 flights with times, airports, on-time rate and price"/></td>
<td width="25%"><img src="../../assets/flight-demo/flight-03-filters.jpg" alt="Departure-time filter dropdown opened by the agent"/></td>
<td width="25%"><img src="../../assets/flight-demo/flight-04-filtered.jpg" alt="List narrowed to morning departures after the filter was checked"/></td>
</tr>
<tr>
<td><code>browser_page_open</code> — form prefilled 北京 → 杭州, 2026-11-24</td>
<td><code>browser_page_click</code> on 搜索机票 → a new tab with the flight list</td>
<td><code>browser_page_search</code> then <code>click</code> → 起飞时段 dropdown</td>
<td><code>browser_page_click</code> on 上午 (00:00-11:59) → list narrows to 07:25–11:30 departures</td>
</tr>
<tr>
<td width="25%"><img src="../../assets/flight-demo/flight-05-afternoon.jpg" alt="Afternoon filter selected, morning cleared"/></td>
<td width="25%"><img src="../../assets/flight-demo/flight-06-cheapest.jpg" alt="Price-sorted ascending: Xiamen Air MF8150 at 260 yuan is the cheapest afternoon flight"/></td>
<td width="25%"><img src="../../assets/flight-demo/flight-07-selected.jpg" alt="Fare panel expanded for the cheapest fare"/></td>
<td width="25%"><img src="../../assets/flight-demo/flight-08-login.jpg" alt="Booking click lands on the login wall with the order-confirm URL in redirectURL"/></td>
</tr>
<tr>
<td><code>browser_page_click</code> — swap 上午 off, 下午 (12:00-17:59) on</td>
<td><code>browser_page_click</code> on the price column → ascending; first row ¥260</td>
<td><code>browser_read_element_children [5340]</code> → the exact <code>&lt;button aria-label="预订"></code></td>
<td><code>browser_page_click</code> that button → order page, behind login</td>
</tr>
</table>

The whole flow runs on **one index space**. `browser_page_search("搜索机票")` returns a single hit at
`[149]`, and clicking `[149]` opens the results tab; checking 上午 removes 47 rows and re-renders only
morning departures, which the click return reports as `NODE_REMOVED` / `NODE_ADDED` instead of leaving the
agent to guess. Sorting by price is confirmed from the column title flipping to 「点击按票价从高到低」 — not
from assuming the click worked — and reading the rows one at a time gives the comparison the agent then
chooses from:

| Afternoon flight | Price | Seats |
|---|---|---|
| **厦航 MF8150** 13:10→15:20 大兴/萧山T3 | **¥260 (1.2折)** | 3张 |
| 东航 MU5147 12:20 | ¥300 | 少量 |
| 南航 CZ8627 12:25 | ¥300 | 少量 |
| 东航 MU5191 14:00 | ¥300 | 少量 |

MF8150 is the cheapest **and** a full-service carrier (the expanded fare panel says 航司直营 ·
托运行李20公斤), and `browser_read_element_children [5340]` names the exact control
`[5369]<button aria-label="预订">`. Clicking it navigates to
`fbuy.fliggy.com/travel/confirm_order.htm?…bizType=flight…quantity:1`, wrapped in a login redirect — no
credentials are held here, so the agent gets the flow started and stops there.

One gotcha that cost a retry: Fliggy's filter checkboxes are `<li>` elements styled to look like tickers.
`browser_page_uncheck` refuses them (*"Not a checkbox"*) because they really are not — the working move is a
plain `browser_page_click` on the row.

Frame-by-frame arguments and returns:
[`assets/flight-demo/steps.json`](../../assets/flight-demo/steps.json).

### Playing a recommended playlist: picking, not just pressing

![recommended playlist flow](../../assets/migu-demo/migu-playlist.gif)

<table>
<tr>
<td width="25%"><img src="../../assets/migu-demo/migu-01-library.jpg" alt="Migu music library home with the recommended-playlist carousel"/></td>
<td width="25%"><img src="../../assets/migu-demo/migu-02-playlist.jpg" alt="Playlist detail page with 161 tracks and a play-all button"/></td>
<td width="25%"><img src="../../assets/migu-demo/migu-03-playing.jpg" alt="First track playing, progress bar running and the row marked as playing"/></td>
<td width="25%"><img src="../../assets/migu-demo/migu-04-next.jpg" alt="Second track playing after next, the playing marker moved to that row"/></td>
</tr>
<tr>
<td><code>browser_page_open</code> — 乐库 home: a **推荐歌单** carousel with playlists and play counts</td>
<td><code>browser_page_click</code> on the cover title → <code>#/playlist?playlistId=227616725</code>, **共161首**</td>
<td><code>browser_page_click</code> on <code>[912] 播放全部</code> → playing, <code>00:01 / 04:40</code></td>
<td><code>browser_page_click</code> on <code>[798] 下一首</code> → track 02, <code>00:02 / 04:35</code></td>
</tr>
</table>

The choice comes out of the read: the home page lists the recommended playlists **with their play counts**
(`196.6万`, `305.0万`, `84.1万`, `198.6万`), so the agent takes the most-played one — 【华语怀旧向】80后的青春旧唱片
— rather than whatever happens to be first.

And no step has to trust a click, because each action returns the page it changed:

```text
click [912] 播放全部  ->  time: 00:01 / 04:40
                        <tr class="el-table__row playing-row">   ← row 01 marked
                        title="暂停"                             ← button flipped to pause
click [4783] (pause)  ->  playing-row removed, title="播放", time frozen at 00:15
click [798] 下一首     ->  playing-row now on row 02
                        song-name: 单身情歌 / singers: 林志炫, 00:02 / 04:35
```

A pause is proven by the **absence** of the playing marker and a frozen timestamp. That round trip
(play → pause → resume → next) is what makes the demo verifiable rather than decorative.

Frame-by-frame arguments and returns:
[`assets/migu-demo/steps.json`](../../assets/migu-demo/steps.json).

### Debugging a market page: reading the XHR behind a number

The three galleries above all *act* on a page. This one *reads what the page does not expose*: which interface call feeds
a number, and its exact return — captured by `browser_page_inspect` into **two separate logs** (network and
console). The frames are intermediate states; the evidence is the raw log slices.

<table>
<tr><td><img src="../../assets/inspect-demo/step-01-loaded.jpg" alt="Yahoo Finance NVDA Historical Data page, fully loaded before any interaction: quote header 125.53 -20.45 (-14.01%) and the historical prices table"/></td></tr>
<tr><td><code>browser_page_screenshot_for_llm</code> — initial loaded state, before any action; the header reads <code>NVDA 125.53 -20.45 (-14.01%)</code></td></tr>
</table>

<table>
<tr><td><img src="../../assets/inspect-demo/step-02-search.jpg" alt="Yahoo Finance search typeahead open after typing AAPL: Symbols list AAPL/AAPU/AAPL.MX/AAPL.TO plus News and Related Research"/></td></tr>
<tr><td><code>browser_page_fill</code> [21] "AAPL" — the intermediate state that fires a search XHR (typeahead)</td></tr>
</table>

The page's own market data arrives over an **XHR small enough to stay inline** in the capture record, so the whole
call — request *and* return — is one readable line:

```text
network-excerpt.jsonl  seq 12  xhr GET v7/finance/quote?&symbols=NVDA
                               bodySize 1235 · responseBody INLINE:
                               regularMarketPrice 125.53, change -20.45, changePercent -14.01,
                               postMarketPrice 130.01            ← matches the header verbatim
console-excerpt.jsonl  seq 32  error  a CSP img-src violation (full allowlist + location kept)
                       seq 33  info   "Powered by AMP ⚡ HTML – Version …" + script location
```

`seq 13` (the Trending-tickers call) sits one line away and is just over the inline threshold, so its body is
filed to disk instead — the contrast between inline and filed is itself the lesson. Inspect writes **one JSONL per
channel**, so the network log and the console log are separate files; both carry a `time`, read together they
reconstruct what the page actually did.

Full write-up (the two raw logs, the inline-vs-externalized threshold, and why this site was chosen):
**[inspect-demo.md](inspect-demo.md)**.

### Regenerating the GIFs

The animations are assembled from the same frames by
[`scripts/make-gif.mjs`](../../scripts/make-gif.mjs), from a `steps.json` that names the tool behind each
frame:

```bash
node scripts/make-gif.mjs --steps assets/flight-demo/steps.json --out assets/flight-demo/flight-booking.gif
node scripts/make-gif.mjs --steps assets/migu-demo/steps.json  --out assets/migu-demo/migu-playlist.gif
node scripts/make-gif.mjs --steps assets/github-demo/steps.json --out assets/github-demo/publish-to-github.gif
```

The caption strip is rendered in a browser and composited with `overlay` — this ffmpeg build has no
`drawtext`/`ass`/`subtitles`, so text cannot be drawn by a filter. It stays translucent because a solid bar
hid the page content underneath it, and it names the tool only: arguments are long and belong in prose.

---

## Debugging a page that misbehaves

`browser_page_inspect` reads what the rendered page cannot tell you: a console error, what an interface
call actually returned, which request failed, how long it took.

1. Start the channel you need — `{console: true}` and/or `{network: true}` (with
   `networkOptions.categories` to pick kinds). The result gives each channel's `filePath`.
2. Do whatever on the page produces the activity.
3. Read the file at any time — capture keeps running while you read. Each channel reports `enabled`,
   `filePath`, and for network the live categories.

The file is **one JSON object per line**, safe to tail live. Newest records sit at the bottom, so read from
the **end** for "what just happened"; `seq` numbers them for the session. It is a rolling window capped at
`maxFileBytes` (default 10 MB) — a file not starting at `seq:1` is normal (older lines trimmed to fit, not
lost).

Two things that are easy to get wrong:

- **Closing the page discards capture entirely** — it stops and deletes the whole capture directory. Read
  the file *before* `browser_page_close`.
- **A missing record is not proof a request never ran.** Requests the browser blocks before any network
  event (CORS, mixed content, aborted by navigation) leave no record at all; the page usually logs or
  `pageerror`s such a failure, so read console alongside network.

Network records carry `method`, `url`, `resourceType`, `status`, `contentType`, `bodySize`, plus timings
(`durationMs`, `ttfbMs`, `dnsMs`, `connectMs`, `tlsMs?`, `downloadMs`). `status: 0` means no response;
`bodySize/headerSize: -1` means unknown. A body is inlined when small, otherwise `{file, bytes}` — open
that path directly, it is never truncated. Which kinds are captured defaults to **fetchxhr only**; a
reapplied `{network: true, networkOptions: {categories}}` changes the switches in place without restarting,
though an omitted key keeps its default.

**A worked example**: [inspect-demo.md](inspect-demo.md) (gallery above, "Debugging a market page") captures a live
Yahoo Finance page into inspect's two separate logs — an inline `v7/finance/quote?symbols=NVDA` **xhr**
(`bodySize 1235`) and the page's own console records — then matches the body's `125.53 / -20.45 / -14.01%` back to
the on-screen quote header.

---

## Error messages are written for the model

A tool error is relayed straight back to the LLM, so it names the next action — `getPage` answers a bad
page id with *"Try browser_page_list …"*. Descriptions always refer to other tools by their full name
(`browser_get_viewport_content`, never `get_page_content`), because a shortened name sends the model looking
for a tool that does not exist.

---

## Gotchas

- **Output markers like `[VIEWPORT]` are part of the external contract** — they appear in every page read this
  repo documents, so changing one changes the output format and every example that quotes it.
