import { BrowserWindow, ipcMain, session } from 'electron';
import type { IpcMainEvent, WebContents } from 'electron';
import { EventEmitter } from 'events';
import * as path from 'path';

// Events: 'packet' (timestamp in microseconds, one Opus packet)
// Takes the sound of one page. Electron can hand the audio of a single frame to a page that asks for a
// display capture, so a hidden window of ours asks, encodes what it gets (assets/audio_capture.html)
// and the packets travel on to the people watching. Nothing plays on the server meanwhile
export class Audio_capture extends EventEmitter {
    readonly #assets: string;
    #window: Promise<BrowserWindow> | null = null;
    #target: WebContents | null = null;
    // start() and stop() are slow and must not overlap
    #queue: Promise<unknown> = Promise.resolve();

    constructor(root: string) {
        super();
        this.#assets = path.join(root, 'assets');
        ipcMain.on('server:audio', (event: IpcMainEvent, timestamp: number, bytes: Uint8Array) => {
            if (this.#target && this.#window) {
                void this.#window.then((window) => {
                    if (event.sender === window.webContents) this.emit('packet', timestamp, Buffer.from(bytes));
                });
            }
        });
    }

    // Captures this page, instead of whatever was captured before
    start(target: WebContents): Promise<void> {
        return this.#enqueue(async () => {
            const window = await this.#capture_window();
            await window.webContents.executeJavaScript('stop_capture()', true);
            this.#target = target;
            await window.webContents.executeJavaScript('start_capture()', true);
        });
    }

    stop(): Promise<void> {
        return this.#enqueue(async () => {
            this.#target = null;
            if (!this.#window) return;
            const window = await this.#window;
            if (!window.isDestroyed()) await window.webContents.executeJavaScript('stop_capture()', true);
        });
    }

    #enqueue(task: () => Promise<void>): Promise<void> {
        const outcome = this.#queue.then(task);
        this.#queue = outcome.catch(() => {});
        return outcome;
    }

    #capture_window(): Promise<BrowserWindow> {
        this.#window ??= (async () => {
            // A session of its own: the pages of the scripts share the default one, and the display
            // capture of this window must never be answered for (or by) them
            const capture_session = session.fromPartition('jazu-server-audio-capture');
            capture_session.setDisplayMediaRequestHandler((_request, callback) => {
                const target = this.#target;
                if (!target || target.isDestroyed()) return callback({});
                callback({ video: target.mainFrame, audio: target.mainFrame });
            });
            const window = new BrowserWindow({
                show: false,
                width: 320,
                height: 200,
                webPreferences: {
                    session: capture_session,
                    preload: path.join(this.#assets, 'audio_preload.js'),
                    contextIsolation: true,
                    backgroundThrottling: false,
                    autoplayPolicy: 'no-user-gesture-required',
                },
            });
            window.webContents.on('console-message', (event: any, ...legacy: unknown[]) => {
                const message = 'message' in event ? event.message : legacy[1];
                console.log('[audio]', message);
            });
            // A file: page is a secure context, which getDisplayMedia and WebCodecs insist on
            await window.loadFile(path.join(this.#assets, 'audio_capture.html'));
            return window;
        })();
        // A failed start must not stick: the next call tries again
        this.#window.catch(() => (this.#window = null));
        return this.#window;
    }
}
