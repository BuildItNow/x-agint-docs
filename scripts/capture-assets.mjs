#!/usr/bin/env node
/**
 * Capture public-facing assets for the x-agint MCP docs from REAL websites.
 *
 * Everything this script produces is reproducible: same site, same viewport, same wait
 * strategy. Run it from anywhere; output lands in ../assets/ relative to this file so a
 * re-run refreshes the committed material rather than drifting.
 *
 * Why Playwright directly instead of the x-browser MCP: the MCP reads pages for an agent
 * (indexed text) and its screenshot tools upload to the model without writing a file, while
 * this needs pixels saved to disk. Both drive the same Chromium binary, so what is captured
 * here is what the tools actually render.
 *
 * Usage:
 *   node scripts/capture-assets.mjs                # all scenes
 *   node scripts/capture-assets.mjs migu           # one scene by name
 *   HEADED=1 node scripts/capture-assets.mjs       # watch it run
 */
import { mkdirSync, rmSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(HERE, '..', 'assets');
const SHOTS = join(ASSETS, 'screenshots');
const DEMOS = join(ASSETS, 'demos');

// 1280x800 is a neutral desktop size that stays legible in a README column.
const VIEWPORT = { width: 1280, height: 800 };
const DEVICE_SCALE = 2; // retina capture, so text stays crisp when the README scales it down

/**
 * Resolve Playwright without depending on where this repo sits relative to it.
 *
 * ESM ignores NODE_PATH, so the usual trick fails. Two supported answers, in order:
 * X_AGINT_PLAYWRIGHT (a directory containing node_modules/playwright) or a local
 * `npm install`. Keeping this explicit means a fresh clone fails with a clear message rather
 * than a confusing ERR_MODULE_NOT_FOUND.
 */
async function loadPlaywright() {
    const candidates = [
        'playwright',
        ...(process.env.X_AGINT_PLAYWRIGHT
            ? [join(process.env.X_AGINT_PLAYWRIGHT, 'node_modules', 'playwright', 'index.js')]
            : []),
    ];
    for (const spec of candidates) {
        try {
            const mod = await import(spec);
            // playwright's entry is CommonJS, so under ESM interop the named exports arrive
            // on .default rather than at module top level.
            return mod.chromium ? mod : mod.default;
        } catch {
            /* try the next candidate */
        }
    }
    console.error(
        'playwright is not resolvable. Either run `npm install` in this directory, or point\n' +
        'X_AGINT_PLAYWRIGHT at a directory whose node_modules contains playwright.',
    );
    process.exit(1);
}

/**
 * Resolve the proxy Chromium must use, or every non-trivial site times out.
 *
 * Measured on this host: a bare launch reached example.com but timed out on wikipedia /
 * duckduckgo / herokuapp, because macOS has a system web proxy enabled and Playwright does
 * not inherit it the way the browser server's profile does. Passing `--proxy-server` made
 * all four answer 200.
 *
 * Read the live system setting instead of hard-coding an address, so the script keeps
 * working on a machine with a different proxy (or none).
 */
function detectProxy() {
    if (process.env.X_AGINT_PROXY) return process.env.X_AGINT_PROXY;
    if (process.platform === 'darwin') {
        try {
            const out = execFileSync('networksetup', ['-getwebproxy', 'Wi-Fi'], { encoding: 'utf8' });
            const enabled = /^Enabled:\s*Yes/m.test(out);
            const server = out.match(/^Server:\s*(\S+)/m)?.[1];
            const port = out.match(/^Port:\s*(\d+)/m)?.[1];
            if (enabled && server && port) return `http://${server}:${port}`;
        } catch {
            /* no networksetup, or not on Wi-Fi: fall through to a direct connection */
        }
    }
    return null;
}

const { chromium } = await loadPlaywright();

/** Wait for network quiet plus a beat, so lazy content is actually painted. */
async function settle(page, ms = 900) {
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(ms);
}

/** Screenshot the viewport to <SHOTS>/<name>.png. */
async function shot(page, name) {
    const path = join(SHOTS, `${name}.png`);
    await page.screenshot({ path });
    console.log(`  shot  ${path}`);
}

/** Click a visible control by text, tolerating sites that change their chrome. */
async function clickText(page, text, timeoutMs = 8_000) {
    const loc = page.getByText(text, { exact: false }).first();
    await loc.waitFor({ state: 'visible', timeout: timeoutMs });
    await loc.click();
}

/**
 * Type into a named search input, then submit.
 *
 * Selectors come from what the live pages actually expose (each site was probed first), not
 * from guesses: Wikipedia's box is `input[name="search"]`, while DuckDuckGo's homepage input
 * carries no name, placeholder or aria-label at all — which is why a generic selector fails
 * there.
 */
async function search(page, query, selector = 'input[name="search"]') {
    const input = page.locator(selector).first();
    await input.waitFor({ state: 'visible', timeout: 10_000 });
    await input.click();
    await input.fill(query);
    await page.keyboard.press('Enter');
}

/**
 * @typedef {Object} Scene
 * @property {string} name - output basename (also the CLI filter)
 * @property {string} site - label used in the log line only; never injected into the page
 * @property {string} url - real page to open
 * @property {(page: import('playwright').Page) => Promise<void>} act - what to do on it
 */
const scenes = [
    {
        name: 'wikipedia-read',
        site: 'en.wikipedia.org',
        // Wikipedia localises by IP, so pin the English article title rather than relying on
        // a redirect from a lowercase form.
        url: 'https://en.wikipedia.org/wiki/Model_Context_Protocol',
        async act(page) {
            await settle(page);
            await shot(page, 'read-01-article');
            // Scroll like a reader would, to show the agent follows content down.
            await page.mouse.wheel(0, 1200);
            await page.waitForTimeout(600);
            await shot(page, 'read-02-scrolled');
        },
    },
    {
        name: 'wikipedia-search-flow',
        site: 'en.wikipedia.org',
        url: 'https://en.wikipedia.org/wiki/Model_Context_Protocol',
        async act(page) {
            await settle(page, 500);
            await search(page, 'browser automation');
            await settle(page);
            await shot(page, 'search-01-results');
            // Follow a result, the way an agent chains read -> locate -> click.
            await clickText(page, 'Browser automation', 8_000);
            await settle(page);
            await shot(page, 'search-02-followed');
        },
    },
    {
        name: 'example-form',
        site: 'the-internet (test site)',
        // A deliberately stable form host: no cookie wall, no bot wall, safe to automate in
        // public material. Used to show fill + submit against a real form.
        url: 'https://the-internet.herokuapp.com/login',
        async act(page) {
            await settle(page);
            await shot(page, 'form-01-before');
            const user = page.locator('#username');
            const pass = page.locator('#password');
            if (await user.count()) {
                await user.fill('tomsmith');
                await pass.fill('SuperSecretPassword!');
                await shot(page, 'form-02-filled');
                await page.locator('button[type=submit]').click();
                await settle(page);
                await shot(page, 'form-03-after');
            }
        },
    },
    {
        name: 'migu-play',
        site: 'music.migu.cn',
        // A multi-step flow across pages: search box -> autocomplete -> results table ->
        // playback. Probed live: the site redirects /v3 paths to /v5/#/musicLibrary, the
        // search box is `input[role="textbox"]`, and the control labels are Chinese.
        url: 'https://music.migu.cn/v5/#/musicLibrary',
        async act(page) {
            await settle(page, 1500);
            await shot(page, 'migu-01-library');

            const box = page.locator('input[role="textbox"]').first();
            await box.waitFor({ state: 'visible', timeout: 15_000 });
            await box.click();
            await box.fill('晴天 周杰伦');
            await page.waitForTimeout(1200);
            // The suggestion list is rendered into a portal: the outer popper container
            // reports as invisible, so capture the visible inner wrap instead.
            const list = page.locator('.el-autocomplete-suggestion__wrap').first();
            if (await list.count()) await shot(page, 'migu-02-suggest');

            const option = page.locator('li[role="option"]').first();
            await option.waitFor({ state: 'visible', timeout: 8_000 });
            await option.click();
            await settle(page, 1500);
            await shot(page, 'migu-03-results');

            // "播放全部" starts playback; the bottom player bar is the visible evidence that
            // a multi-step flow actually reached its goal.
            const playAll = page.getByText('播放全部', { exact: false }).first();
            if (await playAll.count()) {
                await playAll.click();
                await page.waitForTimeout(3000);
                const bar = page.locator('.footer-player').first();
                if (await bar.count()) {
                    await bar.scrollIntoViewIfNeeded().catch(() => {});
                    await shot(page, 'migu-04-playing');
                }
            }
        },
    },
    {
        name: 'flights-search',
        site: 'google.com/travel/flights',
        // A multi-path query flow: origin/destination come prefilled from the URL, then the
        // date picker is opened and a filter applied. Probed live: the page answers with 74
        // results and full per-flight aria-labels, which is why reading it beats screenshotting.
        url: 'https://www.google.com/travel/flights?q=Shanghai+to+Beijing&hl=en',
        async act(page) {
            await settle(page, 2500);
            await shot(page, 'flight-01-results');

            const dep = page.locator('input[aria-label="Departure"]').first();
            if (await dep.count()) {
                await dep.click();
                await page.waitForTimeout(1200);
                await shot(page, 'flight-02-dates');
                await page.keyboard.press('Escape');
                await page.waitForTimeout(600);
            }

            // Open the Stops panel and screenshot it: an agent driving a real filter widget,
            // without submitting a query (submitting here made Google answer "Something went
            // wrong", which is not usable material).
            const stops = page.locator('button[aria-label*="Stops"]').first();
            if (await stops.count()) {
                await stops.click();
                await page.waitForTimeout(1200);
                await shot(page, 'flight-03-filters');
            }
        },
    },
];

/**
 * Playwright names each recorded video by a random uuid and only exposes it after the page
 * closes, so capture the mapping while closing and rename immediately. Without this, a
 * re-run leaves orphan uuid files next to the committed asset.
 */
async function closePageAndNameVideo(page, name) {
    const video = page.video();
    await page.close();
    if (!video) return;
    const src = await video.path();
    const to = join(DEMOS, `${name}.webm`);
    rmSync(to, { force: true });
    renameSync(src, to);
    console.log(`  video ${to}`);
}

async function main() {
    const wanted = process.argv[2];
    const selected = wanted ? scenes.filter((s) => s.name.includes(wanted)) : scenes;
    if (selected.length === 0) {
        console.error(`no scene matches "${wanted}"; known: ${scenes.map((s) => s.name).join(', ')}`);
        process.exit(1);
    }

    mkdirSync(SHOTS, { recursive: true });
    mkdirSync(DEMOS, { recursive: true });

    // A throwaway profile: captures must never touch the real browsing profile, which holds
    // logins and would put private cookies into public material.
    const profile = join(ASSETS, '.capture-profile');
    rmSync(profile, { recursive: true, force: true });

    const proxy = detectProxy();
    if (proxy) console.log(`proxy ${proxy}`);

    const context = await chromium.launchPersistentContext(profile, {
        headless: !process.env.HEADED,
        viewport: VIEWPORT,
        deviceScaleFactor: DEVICE_SCALE,
        // Record video for the demo reel; the browser server itself records nothing, so this
        // is the only place video exists.
        recordVideo: { dir: DEMOS, size: { width: VIEWPORT.width, height: VIEWPORT.height } },
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-first-run',
            ...(proxy ? [`--proxy-server=${proxy}`] : []),
        ],
    });

    for (const scene of selected) {
        console.log(`== ${scene.name} (${scene.site})`);
        const page = await context.newPage();
        try {
            await page.goto(scene.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
            await scene.act(page);
        } catch (error) {
            // A live site can be down or behind a bot wall; keep the other scenes and report
            // honestly instead of failing the whole run.
            console.error(`  FAILED ${scene.name}: ${error.message.split('\n')[0]}`);
        } finally {
            await closePageAndNameVideo(page, scene.name);
        }
    }

    await context.close();
    rmSync(profile, { recursive: true, force: true });
}

main().catch((e) => { console.error(e); process.exit(1); });
