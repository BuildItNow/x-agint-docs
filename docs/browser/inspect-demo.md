# Inspect demo: reading a live market page's XHR and console

A live run against **Yahoo Finance** (a foreign market-data page). The point is narrow and practical:
`browser_page_inspect` captures the page's real behaviour across **two separate logs** — one for **network**, one
for **console**. The network log holds an **XHR whose response body is small enough to stay inline**; the console
log holds the page's own output. Each committed asset is a contiguous slice of its own raw log.

Run through the published `@x-agint/browser` server on 2026-11-23. The committed evidence is **two files**:
[`network-excerpt.jsonl`](../../assets/inspect-demo/network-excerpt.jsonl) (2 xhr records) and
[`console-excerpt.jsonl`](../../assets/inspect-demo/console-excerpt.jsonl) (2 console records), each scrubbed only
of session credentials. Frames show the intermediate page states.

---

## The flow (frames are the intermediate steps)

<table>
<tr><td><img src="../../assets/inspect-demo/step-01-loaded.jpg" alt="Yahoo Finance NVDA Historical Data page, fully loaded before any interaction: quote header 125.53 -20.45 (-14.01%) and the historical prices table"/></td></tr>
<tr><td><code>browser_page_screenshot_for_llm</code> — initial loaded state, before any action (ad slots still skeleton)</td></tr>
</table>

<table>
<tr><td><img src="../../assets/inspect-demo/step-02-search.jpg" alt="Yahoo Finance search typeahead open after typing AAPL: Symbols list AAPL/AAPU/AAPL.MX/AAPL.TO plus News and Related Research"/></td></tr>
<tr><td><code>browser_page_fill</code> [21] "AAPL" — the intermediate state that fires the search XHR</td></tr>
</table>

Sequence, in order:

```jsonc
// browser_page_open      -> https://finance.yahoo.com/quote/NVDA/history/
//   (screenshot step-01-loaded.jpg)
// browser_page_inspect   -> { console: true, network: true,
//                             networkOptions: { categories: { fetchxhr: true } },
//                             maxFileBytes: 0 }            // 0 = unbounded, nothing rolls off
//   console.filePath : …/inspectdatas/page-<id>/console-<id>.jsonl
//   network.filePath : …/inspectdatas/page-<id>/network-<id>.jsonl
// browser_page_fill [21] "AAPL"  -> typeahead fires (screenshot step-02-search.jpg)
```

**Capture is started before the activity**, and the **page is never closed during capture** — closing discards the
capture directory entirely, so the log must be read while the page is still open.

---

## Two logs, not one

`browser_page_inspect` writes **one file per channel** — a network log and a console log, each an independent
JSONL stream. They are committed separately, exactly as written, scrubbed only of the session `crumb` /
`publisherToken`. (Inspect interleaves them by `time` when you read both; here they stay in their own files.)

### network-excerpt.jsonl — two consecutive xhr records

```text
seq 12  GET query1.finance.yahoo.com/v7/finance/quote?&symbols=NVDA …
        xhr · status 200 · application/json · bodySize 1235 · durationMs 1050.8 · ttfbMs 1048.9
        responseBody: {"quoteResponse":{"result":[{
          "regularMarketPrice":125.53, "regularMarketChange":-20.449997,
          "regularMarketChangePercent":-14.008766, "regularMarketPreviousClose":145.98,
          "postMarketPrice":130.01, "postMarketChange":4.4799957, … "symbol":"NVDA"}]}}   // INLINE

seq 13  GET query1.finance.yahoo.com/v7/finance/quote?&symbols=MU,NVDA,SOXL,TSLA,ZS …
        xhr · status 200 · bodySize 1030   -> responseBody: {file: "…/body-13-res.json", bytes: 4869}
```

The headline record is **`seq 12`, an XHR with `bodySize: 1235`** — small enough that inspect keeps the whole
response *inside* the record instead of writing a body file. Parsed, it returns exactly the quote shown on screen:

| field | value |
|---|---|
| `regularMarketPrice` | 125.53 |
| `regularMarketChange` | -20.449997 |
| `regularMarketChangePercent` | -14.008766 |
| `postMarketPrice` / `postMarketChange` | 130.01 / +4.4799957 |

Those match the page header verbatim — `125.53  -20.45 (-14.01%)` and after-hours `130.01 +4.48 (+3.57%)`, visible
in `step-01-loaded.jpg`. The second XHR (`seq 13`, the Trending-tickers sidebar) is just over the inline threshold,
so its body is filed as `body-13-res.json` — a useful contrast sitting one line away.

### console-excerpt.jsonl — two consecutive console records

The other log holds what the page itself printed, kept verbatim (full CSP allowlist and `location` included):

```text
seq 32  error "Loading the image 'https://s.seedtag.com/se/hb/timeout?publisherToken=<REDACTED>&…' violates
              the following Content Security Policy directive: \"img-src 'self' data: blob: about:
              https://*.amazon-adsystem.com … <full img-src allowlist> …\". The action has been blocked."
        location: https://finance.yahoo.com/quote/NVDA/history/
seq 33  info  "Powered by AMP ⚡ HTML – Version 2607210106000 …safeframe/1-0-45/html/container.html"
        location: https://cdn.ampproject.org/rtv/…/amp4ads-v0.mjs
```

A CSP violation and an AMP info line — real console output the rendered DOM never shows. Read alongside the
network log (both carry a `time`), they reconstruct what the page actually did.

---

## Why this site, given the requirement “an XHR, as small as possible”

inspect files a response body to disk once the payload grows past an internal threshold; below it the body stays
in the record. Candidates that failed the inline requirement:

| Site | Data call | Result |
|---|---|---|
| Yahoo history `chart` (1y daily) | ~29 KB | externalized to a body file ✗ |
| WSJ `michelangelo/timeseries` | 3.5 KB wire / ~11 KB JSON | externalized ✗ |
| Google Finance `batchexecute` | the NVDA chart call ~9.7 KB | externalized; only an unrelated 792 B call stayed inline ✗ |
| **Yahoo `v7/finance/quote?symbols=NVDA`** | **1235 B, single symbol** | **inline ✓ xhr** |

So the demo targets the *quote* endpoint with one symbol — the smallest real market XHR that still survives
inline. Which of a page's many XHRs is small enough to read whole is exactly what reading the capture teaches.

---

## Why this demo exists

The other two demos show an agent acting on a page. This one shows an agent **reading what the page does not
expose**: which XHR feeds a number, how long it took, its exact return — kept inline because the payload is small
— and the page's own console behaviour. The evidence is two committed log slices (network + console) rather than a
directory of body files.

Capture files live under `~/.x-agint/browser/inspectdatas/page-<id>/` and are **deleted when the page is closed**
— read them first. Only this credential-redacted slice is committed: the raw request carries a session `crumb`,
and the full capture also holds cookies, ad identifiers and geolocation for a site this repository does not own.
