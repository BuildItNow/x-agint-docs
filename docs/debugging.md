# Debugging a page that shows you nothing

The tools are most useful on pages where reading the DOM tells you nothing. This is a real session,
with the real captured records, working through one such case.

## The problem

Goal: verify that clicking **播放全部** ("play all") on `music.migu.cn` actually started playback — not
just changed a button label.

The obvious checks all fail:

```js
// 1. no media element at all
document.querySelector('audio')            // -> null
document.querySelectorAll('video').length  // -> 0

// 2. no player object to inspect
Object.keys(window).filter(k => /player|audio|muse/i.test(k))
// -> nothing useful; the player is closed over inside a module scope
```

A modern streaming app renders a progress bar, but the audio element and the player instance are both
invisible to DOM queries. **There is nothing to read.** A screenshot would show a timestamp — with no
way to tell whether it was advancing.

## The fix: capture at the network layer

`browser_page_inspect` starts a capture channel whose output is a file on disk:

```jsonc
{ "id": "<pageId>", "options": { "network": true } }
// -> { enabled: true, filePath: "…/page-<id>/network-<id>.jsonl" }
```

Then do whatever produces the activity — here, `browser_page_click` on 播放全部. Read the file at any
time while capture keeps running; it is one JSON object per line, safe to tail live.

What those few seconds actually produced (verbatim from the capture):

```text
seq  method  status  type   bodySize  url
1    POST    200     xhr    12        https://uem.migu.cn:18088/udcc/webData.html
2    POST    200     fetch  44        https://app.log.nf.migu.cn/log/h5binToKafka
3    POST    200     xhr    321       https://app.c.nf.migu.cn/strategy/pc/can-listen/v1.0
4    GET     200     xhr    2547      https://app.c.nf.migu.cn/strategy/pc/listen/v2.0?…&copyrightId=60054704101…
5    GET     200     xhr    2475      https://d.musicapp.migu.cn/data/oss/resource/00/3u/hb/fe30fb977b88415b921b3cb31f953a25
6-11 POST    200     xhr/fetch …      analytics beacons
```

That is the whole playback chain, and it is proof rather than a guess:

1. **`can-listen/v1.0`** — a permission gate. The client asks whether this track may be played *before*
   it fetches anything.
2. **`listen/v2.0?…copyrightId=60054704101`** — the rights lookup returns a stream URL. The
   `copyrightId` is what identifies the track; no DOM element ever mentions it.
3. **`d.musicapp.migu.cn/data/oss/resource/…`** — the audio bytes. A 200 here means playback is real.

Everything else in the file is analytics noise, which is itself useful to know: filter by URL rather
than scanning every line.

## The fallback when a channel is not enough

If capture was not started before the action, `performance.getEntriesByType('resource')` still recovers
what loaded — 152 entries in this session, including the CDN audio URL:

```js
return performance.getEntriesByType('resource')
    .filter(e => /m3u8|audio|resource/i.test(e.name))
    .map(e => ({ name: e.name, dur: e.duration }));
```

It is less structured than the capture (no status codes, no bodies), but it survives navigation and
needs no setup.

## What this generalises to

| Symptom | Where the answer actually is |
|---|---|
| A click appears to do nothing | `network: true` — did the app even make a request? |
| A blank area, missing list | `console: true` — look for `pageerror`, the record type for an uncaught exception (its `text` is the stack) |
| Data visible but no element to read | `performance.getEntriesByType('resource')` |
| A request that seems absent | **not proof it never ran** — see the gotcha below |
| State you cannot reach via DOM | module-scope closure; stop trying to find the object and observe its effects instead |

## Gotchas that cost time

- **Requests blocked before any network event leave no record.** CORS failures, mixed-content blocks and
  requests aborted by navigation produce nothing in the capture. A missing line is not evidence of
  absence — read `console` alongside `network`, since the page usually logs or `pageerror`s such a
  failure.
- **Closing the page destroys the capture.** `browser_page_close` stops capture and deletes the whole
  capture directory. Read the file *before* closing.
- **Capture is per page id and survives navigation, but not across pages.** A new page needs its own
  channel.
- **The file is a rolling window** capped at `maxFileBytes` (default 10 MB). Older lines fall off, so a
  file that does not start at `seq:1` is normal. Raise the cap when *starting* a channel — it is fixed
  for the channel's lifetime.
- **Newest records are at the bottom.** Read from the end for "what just happened".
- **DevTools formatting collapses objects** in console text (`{status: ok, data: Object}`). The real
  values are in the record's `args` array, JSON-decoded in order — read `args`, not `text`.
- `browser_page_evaluate` is the last resort, not the first: it re-reads the page before and after to
  diff changes, so it is far heavier than a targeted read or search.

## Also: screenshots go to a file you name

The `*_for_llm` screenshot tools save the image and return `{ filePath, fileSize }`, so the same call
that produces the pixels also says where they went. Pass an absolute path (or one starting with `~/`)
inside the server's allowed directories; relative paths are refused. Omit it and the image lands in
`~/.x-agint/browser/screenshots`, which is cleared on every server start.

That is what makes documentation self-generating: every frame of both README demos was written by the
tool call whose effect the frame shows, so the image and the tool log cannot disagree. No separate
recorder, no second session against the same page.

