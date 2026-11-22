/*
 * Every window the agent streams: those of running scripts and the standalone sites the page opens.
 *
 * Entities
 *   Window_Registry   tracks a Web per window, keeps its tab data fresh and streams the one window somebody watches
 *   Devtools_Surface  Chromium's DevTools of a window, streamed like a page under an id of their own
 *   Entry             the registry's record of one window
 *
 * Responsibilities
 *   Events: 'added' (info), 'updated' (info), 'removed' (id), 'frame' (id, jpeg), 'audio' (id, timestamp, opus packet),
 *   'hover' (id, seq, candidates), 'clipboard' (data).
 *   Streaming costs CPU and Cloudflare traffic, so nothing is captured until `watch` names a window, and sound only when asked.
 * Limits
 *   Needs Electron (BrowserWindow, debugger protocol): verified on the Pi only, see docs/feat/server.md.
 */
import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';
import type { WebContents } from 'electron';
import type { Clipboard_Data, Input_Event, Selector_Candidate, Window_Info } from '../../shared/protocol/wire.ts';
import type { Web } from './web.ts';
import { Audio_capture } from './audio.ts';
import { Clipboard_bridge, max_clipboard_chars } from './clipboard.ts';
import { Remote_Input } from './input.ts';

const default_size = { width: 800, height: 600 };
// What a page may ask for (window_resize): a window smaller or larger than this is of no use to anybody
const min_size = 100;
const max_size = 4096;
// The DevTools of a window start out like this, and then take the size of the area the page gives them
const devtools_start_size = { width: 800, height: 360 };


// Declared for TypeScript: injected by Web.run's page_prelude at runtime inside the browser context
declare function resilient_selectors(element: Element): Selector_Candidate[];

// The developer tools of a window: Chromium's own DevTools, drawn in a hidden window of their own and streamed like a
// page is. The id is numbered like the windows' (the pictures of both travel on the same connection)
interface Devtools_Surface {
    id: number;
    owner: Entry;
    window: BrowserWindow;
    contents: WebContents;
}

interface Entry {
    id: number;
    script: string;
    web: Web;
    info: Window_Info;
    contents: WebContents | null;
    devtools: Devtools_Surface | null;
    hover_busy: boolean;
    pending_hover: { x: number; y: number; seq: number } | null;
    // Numbers every pointer position of this window. An answer is only sent while it is still the newest
    // question (see #flush_hover), and the page applies answers in this order
    hover_seq: number;
    // The seq of the last answer that was sent
    hover_sent: number;
    // What the last answer said, so a pointer moving inside one element sends nothing new
    hover_key: string;
}

// The DevTools of a window are not a window of the script: they have an id (`info.devtools.id`) to be streamed and
// to receive input, and they go away with their window.
// Events: 'added' (info), 'updated' (info), 'removed' (id), 'frame' (id, jpeg), 'audio' (id, timestamp, opus packet),
// 'hover' (id, seq, selector candidates), 'clipboard' (data: something was copied, for the people watching)
// Knows every window of every running script, keeps its tab data fresh, and streams the pictures
// of the one window somebody is watching (a screencast through the DevTools protocol)
export class Window_Registry extends EventEmitter {
    readonly #entries = new Map<number, Entry>();
    #next_id = 1;
    #watched: number | null = null;
    #watched_width = 1280;
    // Everything that is streamed right now: the watched window, and its DevTools when they are open
    readonly #screencasts = new Set<WebContents>();
    readonly #surfaces = new Map<number, Devtools_Surface>();
    readonly #audio: Audio_capture;
    #wants_audio = false;
    // The window whose sound is being captured right now
    #audio_id: number | null = null;
    #audio_retry: NodeJS.Timeout | null = null;
    readonly #clipboard = new Clipboard_bridge();
    readonly #input = new Remote_Input();

    constructor(root: string) {
        super();
        this.#clipboard.on('change', (data: Clipboard_Data) => this.emit('clipboard', data));
        this.#audio = new Audio_capture(root);
        this.#audio.on('packet', (timestamp: number, packet: Buffer) => {
            if (this.#audio_id !== null) this.emit('audio', this.#audio_id, timestamp, packet);
        });
    }

    list(): Window_Info[] {
        return [...this.#entries.values()].map((item) => item.info);
    }

    // The window a picture belongs to: a window is its own owner, the DevTools belong to their window
    owner_of(id: number): number {
        return this.#surfaces.get(id)?.owner.id ?? id;
    }

    // ---------- Tracking ----------
    track(script: string, web: Web): void {
        const item: Entry = {
            id: this.#next_id++,
            script,
            web,
            contents: null,
            devtools: null,
            info: { id: 0, script, title: '', url: web.url, icon: '', can_back: false, can_forward: false, devtools: null, ...default_size },
            hover_busy: false,
            pending_hover: null,
            hover_seq: 0,
            hover_sent: 0,
            hover_key: '',
        };
        item.info.id = item.id;
        this.#entries.set(item.id, item);
        this.emit('added', item.info);
        web.once('close', () => this.#remove(item));
        void this.#hook(item);
    }

    // Closes a window the way a tab's cross does
    async close(id: number): Promise<void> {
        await this.#entries.get(id)?.web.close();
    }

    // Navigates to a URL or moves through session history (-1 = back, 0 = refresh, 1 = forward)
    async navigate(id: number, target: { url?: string; delta?: -1 | 0 | 1 }): Promise<void> {
        const item = this.#entries.get(id);
        if (!item) return;
        if (target.url !== undefined) {
            const raw = target.url.trim();
            if (!raw) return;
            const url = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw) ? raw : `https://${raw}`;
            item.web.url = url;
            this.#refresh(item);
            return;
        }
        if (target.delta !== undefined) {
            await item.web.history(target.delta).catch(() => {});
            this.#refresh(item);
        }
    }

    // Gives the window another size, or its default one (null). The next frames and the 'updated' event carry the result
    async resize(id: number, size: { width: number; height: number } | null): Promise<void> {
        const surface = this.#surfaces.get(id);
        if (surface) return this.#resize_devtools(surface, size);
        const item = this.#entries.get(id);
        if (!item) return;
        const wanted = size ?? default_size;
        const width = Math.round(wanted.width);
        const height = Math.round(wanted.height);
        if (!Number.isFinite(width) || !Number.isFinite(height)) return;
        const clamp = (value: number) => Math.max(min_size, Math.min(value, max_size));
        try {
            await item.web.viewport(clamp(width), clamp(height));
        } catch {
            // The window was closed in the meantime
            return;
        }
        if (!this.#entries.has(item.id)) return;
        this.#measure(item);
        this.emit('updated', item.info);
    }

    // ---------- Developer tools ----------
    // Opens or closes the DevTools of a window. They are shown where the window is shown (`info.devtools`)
    async devtools(id: number, open: boolean): Promise<void> {
        const item = this.#entries.get(id);
        if (!item) return;
        if (!open) return this.#close_devtools(item);
        const contents = item.contents;
        if (item.devtools || !contents || contents.isDestroyed()) return;
        const window = new BrowserWindow({
            ...devtools_start_size,
            useContentSize: true,
            show: false,
            webPreferences: { backgroundThrottling: false },
        });
        const surface: Devtools_Surface = { id: this.#next_id++, owner: item, window, contents: window.webContents };
        item.devtools = surface;
        this.#surfaces.set(surface.id, surface);
        this.#hook_devtools(surface);
        // Chromium draws the DevTools into the window that was made for them, and never into one of its own
        contents.setDevToolsWebContents(window.webContents);
        contents.openDevTools({ mode: 'detach' });
        // A hidden BrowserWindow does not composite frames under Xvfb.
        if (process.env.JAZU_VIRTUAL_DISPLAY === '1') window.showInactive();
        item.info.devtools = { id: surface.id, ...devtools_start_size };
        this.emit('updated', item.info);
        if (this.#watched === item.id) await this.#sync_screencast();
    }

    #close_devtools(item: Entry): void {
        const surface = item.devtools;
        if (!surface) return;
        item.devtools = null;
        item.info.devtools = null;
        this.#surfaces.delete(surface.id);
        this.#screencasts.delete(surface.contents);
        const contents = item.contents;
        if (contents && !contents.isDestroyed() && contents.isDevToolsOpened()) contents.closeDevTools();
        if (!surface.window.isDestroyed()) surface.window.destroy();
        if (this.#entries.has(item.id)) this.emit('updated', item.info);
        void this.#sync_screencast();
    }

    // The DevTools always take the size of the area that shows them: unlike a page, nobody wants them at 800x600
    #resize_devtools(surface: Devtools_Surface, size: { width: number; height: number } | null): void {
        if (!size || surface.window.isDestroyed()) return;
        const clamp = (value: number) => Math.max(min_size, Math.min(Math.round(value), max_size));
        if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) return;
        surface.window.setContentSize(clamp(size.width), clamp(size.height));
        this.#measure_devtools(surface);
    }

    #measure_devtools(surface: Devtools_Surface): void {
        const info = surface.owner.info;
        if (!info.devtools || info.devtools.id !== surface.id || surface.window.isDestroyed()) return;
        const [width, height] = surface.window.getContentSize();
        if (info.devtools.width === width && info.devtools.height === height) return;
        info.devtools.width = width;
        info.devtools.height = height;
        this.emit('updated', info);
    }

    // Its pictures are acknowledged like those of a page, and a DevTools that was closed from the inside is gone
    #hook_devtools(surface: Devtools_Surface): void {
        const { contents, owner } = surface;
        contents.debugger.on('message', (_event, method, params) => {
            if (method !== 'Page.screencastFrame' || this.#surfaces.get(surface.id) !== surface) return;
            const { deviceWidth, deviceHeight } = params.metadata ?? {};
            const info = owner.info.devtools;
            if (info && deviceWidth && deviceHeight && (Math.round(deviceWidth) !== info.width || Math.round(deviceHeight) !== info.height)) {
                info.width = Math.round(deviceWidth);
                info.height = Math.round(deviceHeight);
                this.emit('updated', owner.info);
            }
            if (owner.id === this.#watched) this.emit('frame', surface.id, Buffer.from(params.data, 'base64'));
            contents.debugger.sendCommand('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
        });
        // Nobody can close this window by hand: if it goes anyway (its page was destroyed), the DevTools are over
        surface.window.once('closed', () => {
            if (owner.devtools === surface) this.#close_devtools(owner);
        });
    }

    // ---------- Watching ----------
    // The page asks for one window at a time. Streaming costs CPU, so nothing is sent when nobody looks
    // Its sound is only captured when somebody can play it
    async watch(id: number | null, max_width: number, wants_audio = false): Promise<void> {
        this.#watched_width = Math.max(240, Math.min(Math.round(max_width) || 1280, 1920));
        this.#watched = id !== null && this.#entries.has(id) ? id : null;
        this.#wants_audio = wants_audio;
        // What a page copies is only passed on to somebody who is looking at a window
        this.#clipboard.active = this.#watched !== null;
        await this.#sync_screencast();
        await this.#sync_audio();
    }

    // Starts, moves or stops the sound capture so that it follows the watched window
    async #sync_audio(): Promise<void> {
        const item = this.#watched === null ? undefined : this.#entries.get(this.#watched);
        const contents = item?.contents && !item.contents.isDestroyed() ? item.contents : null;
        if (!item || !contents || !this.#wants_audio) {
            if (this.#audio_id === null) return;
            this.#audio_id = null;
            await this.#audio.stop().catch(() => {});
            return;
        }
        if (this.#audio_id === item.id) return;
        this.#audio_id = item.id;
        try {
            await this.#audio.start(contents);
        } catch (error) {
            if (this.#audio_id === item.id) this.#audio_id = null;
            console.error('[windows] audio capture failed:', error instanceof Error ? error.message : error);
            this.#retry_audio(item);
        }
    }

    // A page that is not ready yet (or is between two processes) cannot be captured: try again while it is watched
    #retry_audio(item: Entry): void {
        if (this.#audio_retry) clearTimeout(this.#audio_retry);
        this.#audio_retry = setTimeout(() => {
            this.#audio_retry = null;
            if (this.#watched === item.id && this.#audio_id === null && this.#entries.has(item.id)) void this.#sync_audio();
        }, 1500);
        this.#audio_retry.unref();
    }

    // The sound belongs to the page that was captured: a new page (maybe in a new process) needs a new capture
    #restart_audio(item: Entry): void {
        if (this.#audio_id !== item.id) return;
        this.#audio_id = null;
        void this.#audio.stop().catch(() => {}).then(() => this.#sync_audio());
    }

    // Streams the watched window and, while they are open, its DevTools: both are one thing for whoever watches
    async #sync_screencast(): Promise<void> {
        const item = this.#watched === null ? undefined : this.#entries.get(this.#watched);
        const wanted = new Set<WebContents>();
        for (const contents of [item?.contents, item?.devtools?.contents]) {
            if (contents && !contents.isDestroyed()) wanted.add(contents);
        }
        for (const contents of [...this.#screencasts]) if (!wanted.has(contents)) await this.#stop_screencast(contents);
        await Promise.all([...wanted].filter((contents) => !this.#screencasts.has(contents)).map((contents) => this.#start_screencast(contents)));
    }

    async #start_screencast(contents: WebContents): Promise<void> {
        this.#screencasts.add(contents);
        try {
            if (!contents.debugger.isAttached()) contents.debugger.attach('1.3');
            await contents.debugger.sendCommand('Page.startScreencast', {
                format: 'jpeg',
                quality: 70,
                maxWidth: this.#watched_width,
                everyNthFrame: 1,
            });
        } catch (error) {
            this.#screencasts.delete(contents);
            console.error('[windows] screencast failed:', error instanceof Error ? error.message : error);
        }
    }

    async #stop_screencast(contents: WebContents): Promise<void> {
        this.#screencasts.delete(contents);
        if (contents.isDestroyed() || !contents.debugger.isAttached()) return;
        await contents.debugger.sendCommand('Page.stopScreencast').catch(() => {});
    }

    // ---------- Input ----------
    // The page is driven with the same events a real mouse and keyboard would make
    async input(id: number, input: Input_Event): Promise<void> {
        // The DevTools take the same events as a page (but there is no selector to find under their pointer)
        const surface = this.#surfaces.get(id);
        const item = surface ? undefined : this.#entries.get(id);
        const contents = surface ? surface.contents : item?.contents;
        if (!contents || contents.isDestroyed()) return;
        try {
            await this.#input.send(contents, input);
            if (item && input.kind === 'mouse') this.#queue_hover(item, Math.round(input.x), Math.round(input.y));
        } catch (error) {
            if (!contents.isDestroyed()) console.error('[windows] input dispatch failed:', error instanceof Error ? error.message : error);
        }
    }

    // ---------- Clipboard ----------
    // Ctrl+C / Ctrl+X on the picture: the window copies like it would for a real keyboard. The bridge notices
    // what landed on the clipboard and the people watching get it ('clipboard' event)
    copy(id: number, cut = false): void {
        const contents = this.#contents_of(id);
        if (!contents || contents.isDestroyed()) return;
        if (cut) contents.cut();
        else contents.copy();
        this.#clipboard.hurry();
    }

    // Ctrl+V on the picture: what the person had on their clipboard is put on this one, and the window pastes it
    async paste(id: number, data: Clipboard_Data): Promise<void> {
        const contents = this.#contents_of(id);
        if (!contents || contents.isDestroyed()) return;
        if (typeof data?.text !== 'string' || (data.html !== undefined && typeof data.html !== 'string')) return;
        if (!data.text && !data.html) return;
        if (data.text.length + (data.html?.length ?? 0) > max_clipboard_chars) return;
        await this.#clipboard.write(data);
        if (!contents.isDestroyed()) contents.paste();
    }

    // The page of a window, or the DevTools of one
    #contents_of(id: number): WebContents | null | undefined {
        return this.#surfaces.get(id)?.contents ?? this.#entries.get(id)?.contents;
    }

    // ---------- Hover selector ----------
    // Finding a selector takes a round trip to the page, and the pointer keeps moving meanwhile. Every
    // position gets a number (`hover_seq`); an answer is only sent while its number is still the newest,
    // so the selector of an element the pointer already left can never replace the one it is on now
    #queue_hover(item: Entry, x: number, y: number): void {
        item.pending_hover = { x, y, seq: ++item.hover_seq };
        if (item.hover_busy) return;
        void this.#flush_hover(item);
    }

    async #flush_hover(item: Entry): Promise<void> {
        item.hover_busy = true;
        try {
            // One question at a time per window, and only the newest position waits behind it
            while (item.pending_hover && this.#entries.has(item.id)) {
                const { x, y, seq } = item.pending_hover;
                item.pending_hover = null;
                const candidates: Selector_Candidate[] = await item.web
                    .run((px: number, py: number) => {
                        const hit = document.elementFromPoint(px, py);
                        return hit ? resilient_selectors(hit) : [];
                    }, x, y)
                    .catch(() => []);
                if (!this.#entries.has(item.id)) return;
                // Stale: the pointer moved on, or the page navigated, while the page was working it out
                if (seq !== item.hover_seq || seq <= item.hover_sent) continue;
                this.#send_hover(item, seq, candidates);
            }
        } finally {
            item.hover_busy = false;
        }
    }

    #send_hover(item: Entry, seq: number, candidates: Selector_Candidate[]): void {
        item.hover_sent = seq;
        const key = candidates.map((candidate) => candidate.selector).join('\n');
        if (key === item.hover_key) return;
        item.hover_key = key;
        this.emit('hover', item.id, seq, candidates);
    }

    // What was under the pointer belongs to a page that is gone: forget it, and make every answer that
    // is still on its way stale
    #reset_hover(item: Entry): void {
        item.pending_hover = null;
        item.hover_key = '';
        const seq = ++item.hover_seq;
        item.hover_sent = seq;
        this.emit('hover', item.id, seq, []);
    }

    // ---------- Private ----------
    async #hook(item: Entry): Promise<void> {
        try {
            const contents = await item.web.contents();
            item.contents = contents;
            // The page is a picture of the window, so the window's own size is what input maps onto
            this.#measure(item);
            const refresh = () => this.#refresh(item);
            contents.on('page-title-updated', refresh);
            contents.on('audio-state-changed', refresh);
            contents.on('page-favicon-updated', (_event, icons) => {
                item.info.icon = icons[0] ?? '';
                refresh();
            });
            contents.on('did-navigate', () => {
                // The icon belongs to the old page until the new one announces its own
                item.info.icon = '';
                this.#reset_hover(item);
                refresh();
                this.#restart_audio(item);
            });
            // A crashed page comes back as a new process, and the capture of the old one is dead
            contents.on('render-process-gone', () => this.#restart_audio(item));
            // Closed from the inside (the page asked, or the window went): the DevTools are over
            contents.on('devtools-closed', () => this.#close_devtools(item));
            contents.on('did-navigate-in-page', refresh);
            contents.on('did-stop-loading', refresh);
            // Frames arrive as base64 and each one has to be acknowledged, or the stream stops
            contents.debugger.on('message', (_event, method, params) => {
                if (method !== 'Page.screencastFrame' || this.#entries.get(item.id) !== item) return;
                const { deviceWidth, deviceHeight } = params.metadata ?? {};
                // A script may resize the window (web.viewport): the frame says what size it really is
                if (deviceWidth && deviceHeight && (Math.round(deviceWidth) !== item.info.width || Math.round(deviceHeight) !== item.info.height)) {
                    item.info.width = Math.round(deviceWidth);
                    item.info.height = Math.round(deviceHeight);
                    this.emit('updated', item.info);
                }
                if (item.id === this.#watched) this.emit('frame', item.id, Buffer.from(params.data, 'base64'));
                contents.debugger.sendCommand('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
            });
            refresh();
            if (this.#watched === item.id) {
                await this.#sync_screencast();
                await this.#sync_audio();
            }
        } catch {
            // The window was closed before it was ready
        }
    }

    #measure(item: Entry): void {
        const contents = item.contents;
        if (!contents || contents.isDestroyed()) return;
        const [width, height] = (contents as any).getOwnerBrowserWindow?.()?.getContentSize?.() ?? [item.info.width, item.info.height];
        item.info.width = width;
        item.info.height = height;
    }

    #refresh(item: Entry): void {
        if (!this.#entries.has(item.id)) return;
        const contents = item.contents;
        if (contents && !contents.isDestroyed()) {
            item.info.title = contents.getTitle();
            item.info.url = contents.getURL() || item.web.url;
            const navigation = (contents.navigationHistory ?? contents) as unknown as {
                canGoBack?: () => boolean;
                canGoForward?: () => boolean;
            };
            item.info.can_back = navigation.canGoBack?.() ?? false;
            item.info.can_forward = navigation.canGoForward?.() ?? false;
            item.info.audible = contents.isCurrentlyAudible();
        }
        this.#measure(item);
        this.emit('updated', item.info);
    }

    #remove(item: Entry): void {
        if (!this.#entries.delete(item.id)) return;
        this.#close_devtools(item);
        if (this.#watched === item.id) {
            this.#watched = null;
            this.#screencasts.clear();
            this.#clipboard.active = false;
            void this.#sync_audio();
        }
        this.emit('removed', item.id);
    }
}
