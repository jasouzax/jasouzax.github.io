import { clipboard } from 'electron';
import { EventEmitter } from 'events';
import type { Clipboard_Data } from '../../../shared/protocol/wire.ts';

// Electron's clipboard has changed shape between versions (synchronous or promise based, `readHTML` or not),
// so it is used through what it really offers at runtime instead of through its typings
const system: any = clipboard;

const idle_poll_ms = 500;
// Right after a copy was asked for the result is wanted as soon as the page has written it
const fast_poll_ms = 40;
const fast_for_ms = 1000;
// Bigger than this is not worth shipping through a WebSocket
export const max_clipboard_chars = 2_000_000;

// Events: 'change' (Clipboard_Data)
// The clipboard of the machine running the windows is where the pages copy to and paste from, so it is the
// bridge: pages copy into it and this tells the site, the site hands over what it pasted and this puts it there.
// There is no event for "the clipboard changed", so it is looked at while somebody is watching a window
export class Clipboard_bridge extends EventEmitter {
    #is_active = false;
    #is_looking = false;
    #timer: NodeJS.Timeout | null = null;
    // What was seen last, so that only changes are reported (and what the site pasted is not sent back to it)
    #last = '';
    #fast_until = 0;

    // Looking costs a little CPU, so it only happens while somebody watches
    set active(value: boolean) {
        if (value === this.#is_active) return;
        this.#is_active = value;
        if (!value) {
            this.#cancel();
            return;
        }
        // What is on the clipboard already is old news
        void this.read().then((data) => {
            this.#last = this.#signature(data);
            this.#schedule();
        });
    }

    // Reads what is on the clipboard now, null when there is nothing the site could use
    async read(): Promise<Clipboard_Data | null> {
        try {
            const text: string = (await system.readText?.()) ?? '';
            const read_html = system.readHTML ?? system.readHtml;
            const html: string = read_html ? ((await read_html.call(system)) ?? '') : '';
            if (!text && !html) return null;
            if (text.length + html.length > max_clipboard_chars) return null;
            return html ? { text, html } : { text };
        } catch {
            return null;
        }
    }

    // Puts what the site pasted on the clipboard, for the window to paste from
    async write(data: Clipboard_Data): Promise<void> {
        try {
            if (data.html && (system.readHTML || system.readHtml)) {
                // Electron's own flavour of write(): an object with the formats
                await system.write({ text: data.text, html: data.html });
            } else {
                await system.writeText(data.text);
            }
        } catch (error) {
            console.error('[clipboard] write failed:', error instanceof Error ? error.message : error);
        }
        this.#last = this.#signature(await this.read());
    }

    // A copy was just asked of a page: look often for a moment
    hurry(): void {
        this.#fast_until = Date.now() + fast_for_ms;
        if (!this.#is_active) return;
        this.#cancel();
        this.#schedule();
    }

    #schedule(): void {
        if (!this.#is_active || this.#timer) return;
        const delay = Date.now() < this.#fast_until ? fast_poll_ms : idle_poll_ms;
        this.#timer = setTimeout(() => {
            this.#timer = null;
            void this.#look().finally(() => this.#schedule());
        }, delay);
        this.#timer.unref();
    }

    #cancel(): void {
        if (this.#timer) clearTimeout(this.#timer);
        this.#timer = null;
    }

    async #look(): Promise<void> {
        if (this.#is_looking) return;
        this.#is_looking = true;
        try {
            const data = await this.read();
            const signature = this.#signature(data);
            if (!this.#is_active || signature === this.#last) return;
            this.#last = signature;
            if (data) this.emit('change', data);
        } finally {
            this.#is_looking = false;
        }
    }

    #signature(data: Clipboard_Data | null): string {
        return data ? `${data.text}\u0000${data.html ?? ''}` : '';
    }
}
