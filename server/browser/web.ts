import { app, BrowserWindow, session as electron_session } from 'electron';
import type { DownloadItem, Session, WebContents } from 'electron';
import { EventEmitter } from 'events';
import { existsSync, mkdirSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { setTimeout as sleep } from 'timers/promises';
import { resilient_selectors } from './selector.ts';

// App configuration
// Anchored to the app folder (not __dirname) so compiling into dist/ does not move the data
app.setPath('userData', path.join(app.getAppPath(), 'user_data', 'Default'));
app.commandLine.appendSwitch(
    'disable-features',
    'WebAuthentication,WebAuthenticationConditionalUI,WebAuthedinticationUseNativeWinApi,CalculateNativeWinOcclusion',
);

// ---------- Types ----------
const load_stages = ['none', 'dom', 'load', 'net'] as const;

export type load_stage = (typeof load_stages)[number];

export interface load_error {
    code: number;
    description: string;
    url: string;
}

export interface load_result {
    reached: load_stage;
    error: load_error | null;
}

export interface rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface point {
    x: number;
    y: number;
}

export interface caption_entry {
    number: number;
    // Pass it to web.q(query) to act on the badge's element
    query: string;
    tag: string;
    text: string;
}

export interface screenshot_result {
    // Only present when the screenshot was not saved to `path`
    image?: Buffer;
    // Only present when the screenshot was saved
    path?: string;
    captions: caption_entry[];
    // Normalized zone path of this image, for example "NW,C"
    zone: string;
    format: 'png' | 'jpeg';
    // JPEG only
    quality?: number;
}

export interface download_result {
    path: string;
    filename: string;
    url: string;
    mime_type: string;
    size: number;
    state: 'completed' | 'cancelled' | 'interrupted';
}

export type key_modifier = 'shift' | 'control' | 'ctrl' | 'alt' | 'meta';

export interface web_options {
    // Initial visibility. Change it later with web.window(true | false)
    window?: boolean;
    width?: number;
    height?: number;
    user_agent?: string;
    partition?: string;
    // Directory for this instance's cookies, localStorage, cache, etc. Instances with different
    // directories are fully isolated, so the same site can be logged into with different accounts.
    // Relative paths resolve against the current working directory. Takes precedence over `partition`.
    user_data?: string;
    // Directory every download of this instance is saved into, created when missing. A name that is
    // already taken gets " (1)", " (2)" and so on. Relative paths resolve against the current working directory.
    download_dir?: string;
}

export interface screenshot_options {
    path?: string;
    caption?: string;
    zone?: string;
    format?: 'png' | 'jpeg';
    quality?: number;
}

const zone_cells: Record<string, [column: number, row: number]> = {
    NW: [0, 0],
    N: [1, 0],
    NE: [2, 0],
    W: [0, 1],
    C: [1, 1],
    E: [2, 1],
    SW: [0, 2],
    S: [1, 2],
    SE: [2, 2],
};

const caption_presets: Record<string, string> = {
    button: 'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"], summary',
    input: 'input:not([type="hidden"]), textarea, select, [contenteditable=""], [contenteditable="true"]',
    action: 'button, [role=button], input, summary, textarea, select, [contenteditable], a',
};

// Linux cannot fade a window, so an invisible one is parked far outside every screen
const parked_position = -32000;

// Re-rendering a tiny zone at its natural size would lose the detail the zone is meant to reveal
const max_zone_scale = 16;

// ---------- In-page code ----------
// Serialized with toString() and executed inside the web page, so these may only touch
// their arguments, browser globals and the helpers listed in `page_prelude`.
// Needs a compile target without async/spread downleveling (ES2017+).

function px(value: number): string {
    return `${value}px`;
}

function is_visible(element: Element): boolean {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return false;
    return getComputedStyle(element).visibility !== 'hidden';
}

// CSS by default; "text=..." matches own text, "xpath=..." or a leading "//" uses XPath
function find_elements(query: string, root: ParentNode = document): Element[] {
    if (query.startsWith('text=')) {
        const wanted = query.slice(5).toLowerCase();
        return [...root.querySelectorAll('body *:not(script, style, noscript)')].filter((element) => {
            const own_text = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE);
            return own_text.some((node) => node.textContent!.toLowerCase().includes(wanted));
        });
    }
    if (query.startsWith('xpath=') || query.startsWith('//')) {
        // Inside an element scope a leading "//" would search the whole document, so make it relative
        const xpath = query.replace(/^xpath=/, '');
        const snapshot = document.evaluate(
            root === document ? xpath : xpath.replace(/^\//, './'),
            root,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null,
        );
        return Array.from({ length: snapshot.snapshotLength }, (_, index) => snapshot.snapshotItem(index) as Element);
    }
    return [...root.querySelectorAll(query)];
}

// Each step searches inside the elements the previous step found
function resolve_chain(chain: string[]): Element[] {
    return chain.reduce<ParentNode[]>(
        (roots, query) => [...new Set(roots.flatMap((root) => find_elements(query, root)))],
        [document],
    ) as Element[];
}

function make_box(style: Record<string, string | number>, text = ''): HTMLDivElement {
    const box = document.createElement('div');
    for (const [name, value] of Object.entries(style)) box.style.setProperty(name, String(value));
    box.textContent = text;
    return box;
}

function clear_overlay(): void {
    document.querySelector('[data-web-overlay]')?.remove();
}

// Classes are skipped on purpose: sites generate them, so they change between visits
function unique_selector(element: Element): string {
    const is_unique = (selector: string) => document.querySelectorAll(selector).length === 1;
    const id_selector = (node: Element) => `#${CSS.escape(node.id)}`;
    if (element.id && is_unique(id_selector(element))) return id_selector(element);
    for (const attribute of ['aria-label', 'name', 'placeholder', 'data-testid', 'title', 'alt']) {
        const value = element.getAttribute(attribute) ?? '';
        const selector = `${element.localName}[${attribute}="${value.replace(/["\\]/g, '\\$&')}"]`;
        if (value && value.length < 80 && is_unique(selector)) return selector;
    }
    const path: string[] = [];
    for (let node: Element | null = element; node && node !== document.documentElement; node = node.parentElement) {
        const siblings = [...(node.parentElement?.children ?? [node])];
        const same_tag = siblings.filter((sibling) => sibling.localName === node!.localName);
        const is_anchor = node.id !== '' && is_unique(id_selector(node));
        path.unshift(is_anchor ? id_selector(node) : `${node.localName}:nth-of-type(${same_tag.indexOf(node) + 1})`);
        if (is_anchor || is_unique(path.join(' > '))) break;
    }
    return path.join(' > ');
}

const page_prelude = [px, is_visible, find_elements, resolve_chain, make_box, clear_overlay, unique_selector, resilient_selectors]
    .map((helper) => `const ${helper.name} = ${helper};`)
    .join('\n');

// Single-use on purpose: it is one unit that must be serialized whole into the page
function draw_overlay(region: rect, query: string | null, show_grid: boolean, scale: number): caption_entry[] {
    clear_overlay();
    const unit = 1 / scale;
    const host = make_box({
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        'max-width': 'none',
        'max-height': 'none',
        margin: 0,
        padding: 0,
        border: 0,
        overflow: 'visible',
        background: 'none',
        'pointer-events': 'none',
        'z-index': 2147483647,
    });
    host.setAttribute('data-web-overlay', '');
    // The top layer keeps the overlay above modal dialogs, which no z-index can beat
    host.popover = 'manual';
    document.documentElement.append(host);
    host.showPopover?.();
    const root = host.attachShadow({ mode: 'closed' });
    if (show_grid) {
        const line = `${px(2 * unit)} dotted rgba(255, 0, 90, 0.9)`;
        const grid = make_box({
            position: 'absolute',
            left: px(region.x),
            top: px(region.y),
            width: px(region.width),
            height: px(region.height),
        });
        ['NW', 'N', 'NE', 'W', 'C', 'E', 'SW', 'S', 'SE'].forEach((code, index) => {
            const column = index % 3;
            const row = Math.floor(index / 3);
            const cell = make_box({
                position: 'absolute',
                left: `${(column * 100) / 3}%`,
                top: `${(row * 100) / 3}%`,
                width: '33.334%',
                height: '33.334%',
                'box-sizing': 'border-box',
                'border-left': column > 0 ? line : 'none',
                'border-top': row > 0 ? line : 'none',
                padding: px(4 * unit),
            });
            cell.append(
                make_box(
                    {
                        display: 'inline-block',
                        padding: `${px(2 * unit)} ${px(4 * unit)}`,
                        font: `bold ${px(14 * unit)}/1 monospace`,
                        color: '#fff',
                        background: 'rgba(0, 0, 0, 0.6)',
                    },
                    code,
                ),
            );
            grid.append(cell);
        });
        root.append(grid);
    }
    if (query === null) return [];
    const exposed = find_elements(query).filter((element) => {
        if (!is_visible(element)) return false;
        const box = element.getBoundingClientRect();
        const left = Math.max(box.left, 0);
        const right = Math.min(box.right, window.innerWidth);
        const top = Math.max(box.top, 0);
        const bottom = Math.min(box.bottom, window.innerHeight);
        if (left >= right || top >= bottom) return false;
        const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
        return hit !== null && element.contains(hit);
    });
    // Numbered across the whole viewport so a number stays the same between zoomed zone shots
    return exposed.flatMap((element, index) => {
        const box = element.getBoundingClientRect();
        const x = Math.max(box.x, 0);
        const y = Math.max(box.y, 0);
        const is_in_zone =
            x >= region.x && x <= region.x + region.width && y >= region.y && y <= region.y + region.height;
        if (!is_in_zone) return [];
        root.append(
            make_box(
                {
                    position: 'absolute',
                    left: px(x),
                    top: px(y),
                    padding: `${px(unit)} ${px(3 * unit)}`,
                    font: `bold ${px(12 * unit)}/1 monospace`,
                    color: '#fff',
                    background: '#000',
                    opacity: 0.75,
                },
                String(index + 1),
            ),
        );
        const field = element as HTMLInputElement;
        const label = element.getAttribute('aria-label') || field.innerText || field.value || field.placeholder;
        return [
            {
                number: index + 1,
                query: unique_selector(element),
                tag: element.tagName.toLowerCase(),
                text: (label || element.getAttribute('name') || '').trim().slice(0, 80),
            },
        ];
    });
}

// ---------- Node side ----------
async function save_file(data: Buffer, file?: string): Promise<void> {
    if (file) await fs.writeFile(file, data);
}

// Node-side twin of the prefix rules in find_elements: anything else is a CSS selector
function is_css_query(query: string): boolean {
    return !(query.startsWith('text=') || query.startsWith('xpath=') || query.startsWith('//'));
}

function build_page_code(func: Function, args: unknown[]): string {
    return `(async () => { ${page_prelude}\nreturn (${func})(...${JSON.stringify(args)}); })()`;
}

async function send_cdp(contents: WebContents, method: string, params: object): Promise<any> {
    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3');
    return contents.debugger.sendCommand(method, params);
}

// Polling instead of events: one code path for state, network and in-page conditions.
// A negative timeout waits forever.
async function wait_until(is_done: () => boolean | Promise<boolean>, timeout_ms: number): Promise<boolean> {
    const deadline = timeout_ms < 0 ? Infinity : Date.now() + timeout_ms;
    while (!(await is_done())) {
        if (Date.now() >= deadline) return false;
        await sleep(25);
    }
    return true;
}

// Runs tasks strictly in call order. A strict queue stops after its first failure and rethrows it
class Task_queue {
    readonly #is_strict: boolean;
    readonly #on_failure: (error: unknown) => void;
    #tail: Promise<unknown> = Promise.resolve();
    #failure: { error: unknown } | null = null;
    #reported = new WeakSet<object>();

    constructor(is_strict: boolean, on_failure: (error: unknown) => void = () => {}) {
        this.#is_strict = is_strict;
        this.#on_failure = on_failure;
    }

    add<result>(task: () => Promise<result>): Promise<result> {
        const outcome = this.#tail.then(() => {
            if (this.#failure) throw this.#failure.error;
            return task();
        });
        // The tail swallows failures so one failed task never blocks the queue or leaves an unhandled rejection
        this.#tail = outcome.catch((error) => {
            this.#report(error);
            if (this.#is_strict) this.#failure ??= { error };
        });
        return outcome;
    }

    // A skipped step rethrows the failure of an earlier one, which must still be reported only once
    #report(error: unknown): void {
        if (typeof error === 'object' && error !== null) {
            if (this.#reported.has(error)) return;
            this.#reported.add(error);
        }
        this.#on_failure(error);
    }
}

export class Web extends EventEmitter {
    // Headless scripts have no dock to keep alive for, so the app quits with its last window
    static keep_alive = false;

    // One promise replaces the old `ready` flag + `pending` queue
    static #app_ready = app.whenReady();
    static #pages = new Set<Web>();
    // Closed by the user (not through close()), so macOS `activate` may reopen them
    static #orphans = new Set<Web>();
    // webRequest allows one listener per session, so a shared session needs one dispatcher
    static #by_contents_id = new Map<number, Web>();
    static #hooked_sessions = new WeakSet<Session>();
    static #next_id = 0;

    static {
        app.on('window-all-closed', () => {
            if (!Web.keep_alive) app.quit();
        });
        app.on('activate', () => {
            if (Web.#pages.size > 0) return;
            for (const page of Web.#orphans) page.#ready = page.#open();
        });
    }

    static get pages(): Web[] {
        return [...Web.#pages];
    }

    static async close_all(): Promise<number> {
        const results = await Promise.all(Web.pages.map((page) => page.close()));
        return results.filter(Boolean).length;
    }

    static #route_request(
        event_name: string,
        details: { id: number; resourceType: string; webContentsId?: number },
        is_open: boolean,
    ): void {
        const owner = Web.#by_contents_id.get(details.webContentsId ?? -1);
        // WebSockets stay open by design and would keep the network from ever going idle
        if (!owner || details.resourceType === 'webSocket') return;
        if (is_open) owner.#in_flight.add(details.id);
        else owner.#in_flight.delete(details.id);
        owner.#last_network_change = Date.now();
        owner.emit(event_name, details);
    }

    // The save path must be set synchronously inside will-download, or Electron opens a save dialog
    static #route_download(item: DownloadItem, source: WebContents): void {
        const owner = Web.#by_contents_id.get(source.id);
        if (!owner) return;
        const directory = path.resolve(owner.#options.download_dir);
        mkdirSync(directory, { recursive: true });
        const parsed = path.parse(path.basename(item.getFilename()));
        let copy = 0;
        let target = path.join(directory, parsed.base);
        // Two downloads of one name can run at once, and neither file exists on disk until it is done
        while (existsSync(target) || owner.#pending_downloads.has(target)) {
            copy++;
            target = path.join(directory, `${parsed.name} (${copy})${parsed.ext}`);
        }
        owner.#pending_downloads.add(target);
        item.setSavePath(target);
        item.once('done', (_event, state) => {
            owner.#pending_downloads.delete(target);
            const result: download_result = {
                path: target,
                filename: path.basename(target),
                url: item.getURL(),
                mime_type: item.getMimeType(),
                size: item.getReceivedBytes(),
                state,
            };
            owner.#finished_downloads.push(result);
            owner.emit('download', result);
        });
    }

    #window: BrowserWindow | null = null;
    #parked_from: point | null = null;
    #options: Required<Omit<web_options, 'user_agent' | 'user_data'>> &
        Pick<web_options, 'user_agent' | 'user_data'> & { url: string };
    #ready: Promise<void>;
    #progress: load_result = { reached: 'none', error: null };
    #is_loading = false;
    #in_flight = new Set<number>();
    #pending_downloads = new Set<string>();
    #finished_downloads: download_result[] = [];
    #last_network_change = 0;
    #queue = new Task_queue(false, (error) => this.emit('query_error', error));

    constructor(url = 'about:blank', options: web_options = {}) {
        super();
        this.#options = {
            window: false,
            width: 800,
            height: 600,
            // In-memory session per instance, so multi-browsing pages do not share cookies
            partition: `web_${Web.#next_id++}`,
            download_dir: 'downloads',
            ...options,
            url: url || 'about:blank',
        };
        this.#ready = this.#open();
    }

    // ---------- Properties ----------
    get ready(): Promise<void> {
        return this.#ready;
    }

    // Native Electron WebContents, for anything this class does not wrap
    async contents(): Promise<WebContents> {
        return (await this.#use_window()).webContents;
    }

    get title(): string {
        return this.#live?.webContents.getTitle() ?? '';
    }

    get url(): string {
        return this.#live?.webContents.getURL() ?? this.#options.url;
    }

    get download_dir(): string {
        return this.#options.download_dir;
    }

    // Applies to downloads that start after the change
    set download_dir(directory: string) {
        this.#options.download_dir = directory;
    }

    // Fire-and-forget; use goto() to wait for the load
    set url(url: string) {
        this.#options.url = url;
        this.#navigate(url);
    }

    // ---------- Lifecycle ----------
    async close(): Promise<boolean> {
        await this.#ready;
        const browser_window = this.#live;
        if (browser_window === null) return false;
        // destroy() skips beforeunload like Puppeteer's default, and emits no 'close' (so no orphan)
        await new Promise<void>((resolve) => {
            browser_window.once('closed', () => resolve());
            browser_window.destroy();
        });
        return true;
    }

    // ---------- Navigation ----------
    async goto(url: string, { load = 'load' } = {}): Promise<load_result> {
        await this.contents();
        this.#options.url = url;
        this.#navigate(url);
        return this.load(load);
    }

    // type: "dom" | "load" | "net" | "netN" | "netN:Ss" (N connections allowed, quiet for S seconds)
    async load(type = 'load', timeout_ms = 30000): Promise<load_result> {
        await this.contents();
        const deadline = Date.now() + timeout_ms;
        const net_rule = /^net(\d*)(?::(\d*\.?\d+)s)?$/.exec(type);
        if (type !== 'dom' && type !== 'load' && !net_rule) throw new Error(`Unknown load type "${type}"`);
        const wanted = type === 'dom' ? 'dom' : 'load';
        await wait_until(() => this.#is_at_least(wanted) || !this.#is_loading, timeout_ms);
        if (!net_rule || !this.#is_at_least('load')) return { ...this.#progress };
        const max_connections = Number(net_rule[1] || 0);
        const quiet_ms = Number(net_rule[2] ?? 0.5) * 1000;
        // Any change in the count restarts the quiet period, slightly stricter than Puppeteer when N > 0
        const is_idle = await wait_until(
            () => this.#in_flight.size <= max_connections && Date.now() - this.#last_network_change >= quiet_ms,
            deadline - Date.now(),
        );
        if (is_idle) this.#advance('net');
        return { ...this.#progress };
    }

    // Returns the offset actually travelled, clamped to the available history (0 = reload)
    async history(offset = 0): Promise<number> {
        const contents = await this.contents();
        if (offset === 0) {
            this.#begin_navigation();
            contents.reload();
            await this.load();
            return 0;
        }
        // navigationHistory is Electron 30+; older versions expose the same methods on webContents
        const navigation = (contents.navigationHistory ?? contents) as unknown as {
            getActiveIndex(): number;
            length(): number;
            goToOffset(offset: number): void;
        };
        const index = navigation.getActiveIndex();
        const travel = Math.max(-index, Math.min(offset, navigation.length() - 1 - index));
        if (travel === 0) return 0;
        this.#begin_navigation();
        navigation.goToOffset(travel);
        await this.load();
        return travel;
    }

    // ---------- Evaluation / querying ----------
    // func runs in the page: it cannot use outer variables, and args/result must be JSON-serializable
    async run<arg_list extends unknown[], return_value>(
        func: (...args: arg_list) => return_value,
        ...args: arg_list
    ): Promise<Awaited<return_value>> {
        return (await this.contents()).executeJavaScript(build_page_code(func, args), true);
    }

    // Entry point for chainable element commands, see Query.
    // Several queries are joined with a comma, so an element matching any of them counts:
    // `web.q(can_message, must_login)`. A comma can only join CSS selectors, so "text=" and "xpath="
    // queries must be passed alone
    // An arrow property rather than a method, so it keeps its instance when detached: `const q = web.q`
    readonly q = (...queries: string[]): Query => {
        if (queries.length === 0) throw new Error('q() needs at least one query');
        if (queries.length > 1 && !queries.every(is_css_query)) {
            throw new Error('q() joins queries with a comma, which only works for CSS selectors; use "text=" and "xpath=" queries alone');
        }
        return new Query(this, [queries.join(',')], this.#queue);
    };

    async html(): Promise<string> {
        return this.run(() => document.documentElement.outerHTML);
    }

    async text(): Promise<string> {
        return this.run(() => document.body.innerText);
    }

    async add_script(code: string): Promise<unknown> {
        return (await this.contents()).executeJavaScript(code);
    }

    async add_style(css: string): Promise<string> {
        return (await this.contents()).insertCSS(css);
    }

    // ---------- Downloads ----------
    // Resolves with the oldest finished download nobody has taken yet, so one that finished before
    // this call is not missed. Check `state`: cancelled and interrupted downloads are returned too.
    // Negative timeout waits forever. Resolves null on timeout
    async wait_download(timeout = -1): Promise<download_result | null> {
        const is_found = await wait_until(() => this.#finished_downloads.length > 0, timeout);
        return is_found ? this.#finished_downloads.shift()! : null;
    }

    // ---------- Output ----------
    async screenshot(options: screenshot_options = {}): Promise<screenshot_result> {
        const viewport = await this.run(() => ({
            x: 0,
            y: 0,
            width: window.innerWidth,
            height: window.innerHeight,
            scroll_x: window.scrollX,
            scroll_y: window.scrollY,
        }));
        // "NW,C,S," : each step crops to one ninth; a trailing empty step (or "") adds the zone grid
        const steps = options.zone?.split(',').map((step) => step.trim().toUpperCase()) ?? [];
        const show_grid = options.zone !== undefined && steps.at(-1) === '';
        const zone_path = steps.filter(Boolean);
        const region = zone_path.reduce<rect>((current, code) => {
            if (!(code in zone_cells)) throw new Error(`Unknown zone "${code}"`);
            const [column, row] = zone_cells[code];
            return {
                x: current.x + (column * current.width) / 3,
                y: current.y + (row * current.height) / 3,
                width: current.width / 3,
                height: current.height / 3,
            };
        }, viewport);
        const scale = Math.min(viewport.width / region.width, max_zone_scale);
        const query = options.caption === undefined ? null : (caption_presets[options.caption] ?? options.caption);
        const has_overlay = query !== null || show_grid;
        const captions = has_overlay ? await this.run(draw_overlay, region, query, show_grid, scale) : [];
        const format = options.format ?? (/\.jpe?g$/i.test(options.path ?? '') ? 'jpeg' : 'png');
        const quality = format === 'jpeg' ? (options.quality ?? 90) : undefined;
        const { data } = await send_cdp(await this.contents(), 'Page.captureScreenshot', {
            format,
            quality,
            // CDP clips in document coordinates, while zones and the overlay use viewport coordinates
            clip: { ...region, x: region.x + viewport.scroll_x, y: region.y + viewport.scroll_y, scale },
        }).finally(() => has_overlay && this.run(clear_overlay));
        const image = Buffer.from(data, 'base64');
        await save_file(image, options.path);
        return {
            ...(options.path ? { path: options.path } : { image }),
            captions,
            zone: zone_path.join(','),
            format,
            quality,
        };
    }

    async pdf(options: { path?: string } = {}): Promise<Buffer> {
        const buffer = await (await this.contents()).printToPDF({});
        await save_file(buffer, options.path);
        return buffer;
    }

    // ---------- Input ----------
    // key: single character or an Electron key code such as "Enter", "Tab", "Backspace".
    // Goes to whatever has focus; use web.q(...).press() to focus an element first
    async press(key: string, modifier?: key_modifier | key_modifier[]): Promise<void> {
        const contents = await this.contents();
        const modifiers = [modifier ?? []].flat();
        contents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers });
        // A character event would also type the letter for shortcuts such as Control+A
        if (key.length === 1 && modifiers.every((name) => name === 'shift')) {
            contents.sendInputEvent({ type: 'char', keyCode: key, modifiers });
        }
        contents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers });
    }

    // ---------- Environment ----------
    // Shows (true) or hides (false) the window, for example to let the user solve a captcha.
    // Resolves to whether the window is visible; without an argument it only reports
    async window(is_visible?: boolean): Promise<boolean> {
        const browser_window = await this.#use_window();
        if (is_visible !== undefined) this.#apply_window(browser_window, is_visible);
        return this.#options.window;
    }

    async viewport(width?: number, height?: number): Promise<{ width: number; height: number }> {
        const browser_window = await this.#use_window();
        if (width !== undefined && height !== undefined) browser_window.setContentSize(width, height);
        const [content_width, content_height] = browser_window.getContentSize();
        return { width: content_width, height: content_height };
    }

    // Applies from the next navigation
    async user_agent(value: string): Promise<void> {
        (await this.contents()).setUserAgent(value);
    }

    cookies(action: 'get', filter?: Electron.CookiesGetFilter): Promise<Electron.Cookie[]>;
    cookies(action: 'set', details: Electron.CookiesSetDetails): Promise<void>;
    cookies(action: 'clear'): Promise<void>;
    async cookies(action: 'get' | 'set' | 'clear', data?: unknown): Promise<Electron.Cookie[] | void> {
        const { session } = await this.contents();
        if (action === 'get') return session.cookies.get((data ?? {}) as Electron.CookiesGetFilter);
        if (action === 'set') return session.cookies.set(data as Electron.CookiesSetDetails);
        return session.clearStorageData({ storages: ['cookies'] });
    }

    // ---------- Private ----------
    get #live(): BrowserWindow | null {
        if (this.#window === null || this.#window.isDestroyed()) return null;
        return this.#window;
    }

    async #use_window(): Promise<BrowserWindow> {
        await this.#ready;
        const browser_window = this.#live;
        if (browser_window === null) throw new Error('Web is closed');
        return browser_window;
    }

    async #open(): Promise<void> {
        await Web.#app_ready;
        if (this.#live !== null) return;
        Web.#orphans.delete(this);
        const browser_window = new BrowserWindow({
            width: this.#options.width,
            height: this.#options.height,
            useContentSize: true,
            show: false,
            webPreferences: {
                nodeIntegration: false,
                backgroundThrottling: false,
                // Nobody sits at the window to press play: sound (and the passthrough of it to the site) has to start by itself
                autoplayPolicy: 'no-user-gesture-required',
                // A directory-backed session keeps this instance's data separate from every other one
                ...(this.#options.user_data
                    ? { session: electron_session.fromPath(path.resolve(this.#options.user_data)) }
                    : {}),
                //partition: this.#options.partition,
            },
        });
        const contents = browser_window.webContents;
        const contents_id = contents.id;
        this.#window = browser_window;
        this.#parked_from = null;
        this.#apply_window(browser_window, this.#options.window);
        Web.#pages.add(this);
        Web.#by_contents_id.set(contents_id, this);
        if (!Web.#hooked_sessions.has(contents.session)) {
            Web.#hooked_sessions.add(contents.session);
            contents.session.webRequest.onBeforeRequest((details, callback) => {
                Web.#route_request('request', details, true);
                callback({});
            });
            contents.session.webRequest.onCompleted((details) => Web.#route_request('response', details, false));
            contents.session.webRequest.onErrorOccurred((details) =>
                Web.#route_request('request_failed', details, false),
            );
            contents.session.on('will-download', (_event, item, source) => Web.#route_download(item, source));
        }
        contents.on('did-start-loading', () => this.#begin_navigation());
        contents.on('did-stop-loading', () => {
            this.#is_loading = false;
            this.#emit_progress();
        });
        contents.on('dom-ready', () => this.#advance('dom'));
        contents.on('did-finish-load', () => this.#advance('load'));
        contents.on('did-navigate-in-page', () => {
            this.#is_loading = false;
            this.#advance('load');
        });
        contents.on('did-fail-load', (_event, code, description, url, is_main_frame) => {
            // -3 is ERR_ABORTED: fires for redirects and for navigations replaced by a newer one
            if (!is_main_frame || code === -3) return;
            this.#record_error({ code, description, url });
        });
        contents.on('did-navigate', (_event, url, status, description) => {
            if (status >= 400) this.#record_error({ code: status, description, url });
        });
        contents.on('console-message', (event: object, ...legacy: unknown[]) => {
            // Electron 35 moved the positional arguments into the event object
            const legacy_details = { level: legacy[0], message: legacy[1], lineNumber: legacy[2], sourceId: legacy[3] };
            this.emit('console', 'message' in event ? event : legacy_details);
        });
        contents.setWindowOpenHandler(({ url }) => {
            this.emit('popup', new Web(url, this.#options));
            return { action: 'deny' };
        });
        browser_window.on('close', () => Web.#orphans.add(this));
        browser_window.once('closed', () => {
            Web.#pages.delete(this);
            Web.#by_contents_id.delete(contents_id);
            this.#window = null;
            this.emit('close');
        });
        if (this.#options.user_agent) contents.setUserAgent(this.#options.user_agent);
        this.#navigate(this.#options.url);
    }

    // A merely hidden window never produces frames, so screenshots would hang. "Hidden" is therefore
    // a shown window that is see-through, click-through and unfocusable (so it cannot steal the
    // keyboard). Offscreen rendering is not used because it can never be switched to a real window
    #apply_window(browser_window: BrowserWindow, is_visible: boolean): void {
        this.#options.window = is_visible;
        // Xvfb has no desktop to hide from. Parking outside its screen stops
        // Chromium's compositor, including the DevTools screencast.
        const virtual_display = process.platform === 'linux' && process.env.JAZU_VIRTUAL_DISPLAY === '1';
        browser_window.setOpacity(is_visible || virtual_display ? 1 : 0);
        browser_window.setIgnoreMouseEvents(!is_visible);
        browser_window.setFocusable(is_visible);
        browser_window.setSkipTaskbar(!is_visible);
        const home = this.#parked_from;
        if (is_visible && home !== null) {
            browser_window.setPosition(home.x, home.y);
            this.#parked_from = null;
        }
        if (!is_visible && process.platform === 'linux' && !virtual_display && home === null) {
            const [x, y] = browser_window.getPosition();
            this.#parked_from = { x, y };
            browser_window.setPosition(parked_position, parked_position);
        }
        if (!is_visible) {
            browser_window.showInactive();
            return;
        }
        if (browser_window.isMinimized()) browser_window.restore();
        browser_window.show();
        browser_window.focus();
    }

    #navigate(url: string): void {
        this.#begin_navigation();
        // loadURL also rejects for failed or superseded navigations; load() already reports those
        this.#live?.webContents.loadURL(url).catch(() => {});
    }

    #begin_navigation(): void {
        this.#progress = { reached: 'none', error: null };
        this.#is_loading = true;
        this.#emit_progress();
    }

    #is_at_least(stage: load_stage): boolean {
        return load_stages.indexOf(this.#progress.reached) >= load_stages.indexOf(stage);
    }

    #advance(stage: load_stage): void {
        // Chromium net errors are negative; the error page Electron then shows must not count as loaded
        const has_network_error = (this.#progress.error?.code ?? 0) < 0;
        if (!has_network_error && !this.#is_at_least(stage)) this.#progress.reached = stage;
        this.#emit_progress();
    }

    #record_error(error: load_error): void {
        this.#progress.error = error;
        this.#emit_progress();
    }

    #emit_progress(): void {
        this.emit('progress', { ...this.#progress });
    }

}

// Chainable locator, for example `await web.q(a).q(b).exists().click(2)`.
// Every method queues one step and returns a Query, so calls chain, and the steps run in call order
// even when nobody awaits. A Query is awaitable and resolves to the result of its last step, so
// `await web.q(a).wait().type(text).waitno()` resolves to what waitno() resolves to.
// When a step fails, the steps after it in the same chain are skipped and the await rejects with
// the first failure.
export class Query<result = void> implements PromiseLike<result> {
    readonly #web: Web;
    readonly #chain: string[];
    readonly #queue: Task_queue;
    readonly #is_guarded: boolean;
    // Outcome of the latest step of this chain: the next step waits for it, and an await resolves to it
    readonly #outcome: Promise<result>;

    constructor(
        web: Web,
        chain: string[],
        queue: Task_queue,
        is_guarded = false,
        outcome: Promise<result> = Promise.resolve(undefined as result),
    ) {
        this.#web = web;
        this.#chain = chain;
        this.#queue = queue;
        this.#is_guarded = is_guarded;
        this.#outcome = outcome;
    }

    // ---------- Awaiting ----------
    then<fulfilled = result, rejected = never>(
        on_fulfilled?: ((value: result) => fulfilled | PromiseLike<fulfilled>) | null,
        on_rejected?: ((reason: any) => rejected | PromiseLike<rejected>) | null,
    ): Promise<fulfilled | rejected> {
        return this.#outcome.then(on_fulfilled, on_rejected);
    }

    catch<rejected = never>(on_rejected?: ((reason: any) => rejected | PromiseLike<rejected>) | null): Promise<result | rejected> {
        return this.#outcome.catch(on_rejected);
    }

    finally(on_finally?: (() => void) | null): Promise<result> {
        return this.#outcome.finally(on_finally);
    }

    // ---------- Targeting ----------
    // Sub query: searches inside the elements this query matches. It only retargets the chain, so it
    // still waits for the steps before it
    q(query: string): Query {
        const carried = this.#outcome.then(() => undefined);
        // Nobody may await this copy, and a failure must not become an unhandled rejection
        carried.catch(() => {});
        return new Query<void>(this.#web, [...this.#chain, query], this.#queue, this.#is_guarded, carried);
    }

    // Without a function: resolves to whether something visible matches, and the actions chained
    // after it skip quietly when nothing does: `if (await web.q(a).exists()) ...`.
    // With a function: runs it only if something matches, handing it a Query for the same target so
    // several commands can share it. Its steps run in order and the first failure is rethrown here.
    // Resolves whether it ran. Inside the function use the given Query, not web.q(): a web.q() step
    // would wait for this very call to finish.
    exists(): Query<boolean>;
    exists(func: (scoped: Query) => unknown): Promise<boolean>;
    exists(func?: (scoped: Query) => unknown): Query<boolean> | Promise<boolean> {
        if (!func) return this.#step(() => this.#is_present(), true);
        return this.#enqueue(async () => {
            if (!(await this.#is_present())) return false;
            const scoped_queue = new Task_queue(true);
            await func(new Query(this.#web, this.#chain, scoped_queue));
            // A no-op task resolves after every queued step and rethrows the first failure
            await scoped_queue.add(async () => undefined);
            return true;
        });
    }

    // ---------- Reading ----------
    count(): Query<number> {
        return this.#step(() => this.#web.run((chain) => resolve_chain(chain).length, this.#chain));
    }

    rect(): Query<rect | null> {
        return this.#step(() =>
            this.#web.run((chain) => {
                const box = resolve_chain(chain).find(is_visible)?.getBoundingClientRect();
                return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
            }, this.#chain),
        );
    }

    text(): Query<string | null> {
        return this.#step(() =>
            this.#web.run(
                (chain) => (resolve_chain(chain).find(is_visible) as HTMLElement | undefined)?.innerText ?? null,
                this.#chain,
            ),
        );
    }

    // ---------- Acting ----------
    // Resolves to how many clicks happened. The element can disappear after a click, so every extra
    // click checks again and stops quietly once it is gone
    click(count = 1): Query<number> {
        return this.#step(() => this.#click(count));
    }

    hover(): Query {
        return this.#step(async () => {
            const position = await this.#locate();
            if (position === null) return;
            (await this.#web.contents()).sendInputEvent({ type: 'mouseMove', ...position });
        });
    }

    // Clicks to focus, then inserts the text at the caret. Existing text stays
    type(text: string): Query {
        return this.#step(async () => {
            if ((await this.#click(1)) === 0) return;
            /*await (await this.#web.contents()).executeJavaScript(`(() => {
                const input = document.querySelector('${this.#chain.join(',')}');
                if (input) {
                    input.focus();
                    if (input.setSelectionRange) {
                        const length = input.value.length;
                        input.setSelectionRange(length, length);
                    } else {
                        const range = document.createRange();
                        const sel = window.getSelection();
                        
                        range.selectNodeContents(input);
                        range.collapse(false);
                        
                        sel.removeAllRanges();
                        sel.addRange(range);
                    }
                    input.focus();
                }
            })()`);*/
            await (await this.#web.contents()).insertText(text);
        });
    }
    // Clicks to focus, then inserts the text at the caret. Existing text stays
    insert_text(text: string): Query {
        return this.#step(async () => {
            await (await this.#web.contents()).executeJavaScript(`try {
                const dom = document.querySelector('${this.#chain.join(',').replaceAll("'","\\'")}');
                const txt = \`${text.replaceAll('\\','\\\\').replaceAll('\n','\\n').replaceAll('`','\\`')}\`;
                if (dom.setSelectionRange) dom.value += txt;
                else dom.appendChild(document.createTextNode(txt));
            } catch (e) { console.log(e); }`);
        });
    }

    // Waits until something visible matches. Negative timeout waits forever. Resolves false on timeout.
    // A timeout does not stop the chain: the next step decides what a missing element means
    wait(timeout = -1): Query<boolean> {
        return this.#step(() => wait_until(() => this.#is_present(), timeout));
    }

    // Waits until nothing visible matches. Negative timeout waits forever. Resolves false on timeout
    waitno(timeout = -1): Query<boolean> {
        return this.#step(() => wait_until(async () => !(await this.#is_present()), timeout));
    }

    // Scrolls the element's own content. For the page itself use web.q('html')
    scroll(amount_x: number, amount_y = 0): Query {
        return this.#step(async () => {
            const is_found = await this.#web.run(
                (chain, delta_x, delta_y) => {
                    const element = resolve_chain(chain).find(is_visible);
                    if (!element) return false;
                    const is_page = element === document.body || element === document.documentElement;
                    (is_page ? window : element).scrollBy({ left: delta_x, top: delta_y, behavior: 'instant' });
                    return true;
                },
                this.#chain,
                amount_x,
                amount_y,
            );
            this.#require(is_found);
        });
    }

    // Focuses the element (without clicking it), then presses the key
    press(key: string, modifier?: key_modifier | key_modifier[]): Query {
        return this.#step(async () => {
            const is_found = await this.#web.run((chain) => {
                const element = resolve_chain(chain).find(is_visible) as HTMLElement | undefined;
                element?.scrollIntoView({ block: 'center', behavior: 'instant' });
                element?.focus();
                return element !== undefined;
            }, this.#chain);
            this.#require(is_found);
            if (is_found) await this.#web.press(key, modifier);
        });
    }

    // Sets files on an <input type="file">, which may be hidden. A folder goes to an input with webkitdirectory
    upload(...files: string[]): Query {
        return this.#step(async () => {
            const contents = await this.#web.contents();
            const { result } = await send_cdp(contents, 'Runtime.evaluate', {
                expression: build_page_code((chain: string[]) => resolve_chain(chain)[0] ?? null, [this.#chain]),
                awaitPromise: true,
            });
            this.#require(result.objectId !== undefined);
            if (result.objectId === undefined) return;
            const object_id = { objectId: result.objectId };
            await send_cdp(contents, 'DOM.setFileInputFiles', { ...object_id, files: files.map((file) => path.resolve(file)) });
            await send_cdp(contents, 'Runtime.releaseObject', object_id);
        });
    }

    // ---------- Private ----------
    // Queues a task behind the chain's previous step: when that step failed, the await rethrows its
    // failure and the task is skipped. Returns the raw promise, which the queue already guards
    // against unhandled rejections
    #enqueue<next>(task: () => Promise<next>): Promise<next> {
        const previous = this.#outcome;
        return this.#queue.add(async () => {
            await previous;
            return task();
        });
    }

    // Same, but returns the Query that carries on the chain
    #step<next>(task: () => Promise<next>, is_guarded = this.#is_guarded): Query<next> {
        return new Query<next>(this.#web, this.#chain, this.#queue, is_guarded, this.#enqueue(task));
    }

    #is_present(): Promise<boolean> {
        // A page that is navigating mid-check counts as "nothing matches"
        return this.#web.run((chain) => resolve_chain(chain).some(is_visible), this.#chain).catch(() => false);
    }

    // Guarded queries skip quietly; unguarded ones fail loudly like Puppeteer
    #require(is_found: boolean): void {
        if (!is_found && !this.#is_guarded) throw new Error(`No matching element for ${this.#chain.join(' >> ')}`);
    }

    // Scrolls the first visible match to the centre and returns its centre point
    async #locate(is_required = true): Promise<point | null> {
        const position = await this.#web.run((chain) => {
            const element = resolve_chain(chain).find(is_visible);
            if (!element) return null;
            element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
            const box = element.getBoundingClientRect();
            return {
                x: Math.round(Math.min(Math.max(box.x + box.width / 2, 0), window.innerWidth - 1)),
                y: Math.round(Math.min(Math.max(box.y + box.height / 2, 0), window.innerHeight - 1)),
            };
        }, this.#chain);
        if (is_required) this.#require(position !== null);
        return position;
    }

    async #click(count: number): Promise<number> {
        const contents = await this.#web.contents();
        contents.focus();
        for (let clicks = 0; clicks < count; clicks++) {
            // Gives the page a moment to react, and stays inside the double-click time
            if (clicks > 0) await sleep(50);
            const position = await this.#locate(clicks === 0);
            if (position === null) return clicks;
            contents.sendInputEvent({ type: 'mouseMove', ...position });
            contents.sendInputEvent({ type: 'mouseDown', ...position, button: 'left', clickCount: clicks + 1 });
            contents.sendInputEvent({ type: 'mouseUp', ...position, button: 'left', clickCount: clicks + 1 });
        }
        return count;
    }
}
