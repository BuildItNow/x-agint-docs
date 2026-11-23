#!/usr/bin/env node
/**
 * Drive the x-browser MCP server with real tool calls and emit a call log that can
 * be burned into a video as subtitles.
 *
 * This is deliberately NOT Playwright: the material should show the MCP contract an
 * agent actually uses. Every logged line is a genuine tools/call against the running
 * daemon, so the subtitle cannot drift from what the video shows. (Playwright has no
 * `Tool.*` CDP domain in this version — types/protocol.d.ts exposes only Input / Page /
 * Network / Runtime / Emulation — so intercepting at that layer would not even see the
 * MCP calls.)
 *
 * Subtitles carry the tool NAME only. Arguments and results are long by design (a
 * viewport read is tens of lines), and putting them on screen makes the clip unreadable.
 * The full arguments and results still go to the JSONL for anyone who wants them.
 *
 * Timeline model: the page changes when a call lands, and the recorder runs on the same
 * wall clock, so a call's start timestamp is already the correct subtitle start time.
 *
 * Usage:
 *   node scripts/mcp-demo.mjs [--out calls.jsonl] [--url <mcp url>]
 * Requires: x-browser --daemon start (the daemon owns the MCP endpoint).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i > -1 ? argv[i + 1] : fallback;
};
const MCP_URL = flag('url', process.env.X_BROWSER_MCP_URL || 'http://127.0.0.1:3007/mcp');
const OUT = resolve(flag('out', 'mcp-calls.jsonl'));

/** On-screen dwell per step, so the viewer can read the name and see the page react. */
const BEAT_MS = 2600;
const beat = (ms = BEAT_MS) => new Promise((r) => setTimeout(r, ms));

/**
 * A scripted MCP call, logged with its wall-clock start.
 *
 * `args` may reference `pageId`, which only exists after the page is opened; it is
 * filled from the previous call's result rather than hard-coded, because ids are
 * generated per session and a stale id would make the demo lie.
 *
 * @param {Client} client - connected MCP client
 * @param {string} label - subtitle headline (what the agent is doing)
 * @param {string} tool - MCP tool name, called exactly as an agent calls it
 * @param {(ctx: { pageId?: string }) => object} [argsFor] - real arguments
 */
async function step(client, ctx, label, tool, argsFor = () => ({})) {
    const args = argsFor(ctx);
    const at = Date.now();
    let result;
    try {
        result = await client.callTool({ name: tool, arguments: args });
    } catch (error) {
        result = { isError: true, content: [{ type: 'text', text: error.message }] };
    }
    // The browser tools nest their payload under `result`; other tools do not.
    const payload = result.structuredContent?.result ?? result.structuredContent ?? null;
    if (payload && payload.id) ctx.pageId = payload.id;

    const ok = !result.isError;
    console.log(`${new Date(at).toISOString()}  ${ok ? 'ok  ' : 'FAIL'} ${tool}`);
    return { at, label, tool, ok, args };
}

async function main() {
    const client = new Client({ name: 'x-agint-demo', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)));

    // Real discovery, so the demo never calls a tool this server does not expose.
    const { tools } = await client.listTools();
    const names = new Set(tools.map((t) => t.name));
    console.log(`connected ${MCP_URL} — ${tools.length} tools`);

    const plan = [
        ['Open a real page', 'browser_page_open', () => ({
            url: 'https://en.wikipedia.org/wiki/Model_Context_Protocol',
        })],
        ['Read the viewport as an indexed tree', 'browser_get_viewport_content', (c) => ({ id: c.pageId, count: 24 })],
        ['Search inside the page', 'browser_page_search', (c) => ({ id: c.pageId, text: 'transport' })],
        ['Scroll down', 'browser_page_scroll', (c) => ({ id: c.pageId, yDirection: 'down' })],
        ['Read the viewport again', 'browser_get_viewport_content', (c) => ({ id: c.pageId, count: 24 })],
        ['Take a screenshot for the model', 'browser_page_screenshot_for_llm', (c) => ({ id: c.pageId })],
        ['Close the page', 'browser_page_close', (c) => ({ id: c.pageId })],
    ];

    const missing = plan.filter(([, tool]) => !names.has(tool)).map(([, tool]) => tool);
    if (missing.length) throw new Error(`server does not expose: ${missing.join(', ')}`);

    const ctx = {};
    const log = [];
    for (const [label, tool, argsFor] of plan) {
        log.push(await step(client, ctx, label, tool, argsFor));
        await beat();
    }

    writeFileSync(OUT, log.map((e) => JSON.stringify(e)).join('\n') + '\n');
    console.log(`wrote ${OUT} (${log.length} calls)`);
    await client.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
