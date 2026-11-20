import type { Input_Event } from './shared/protocol.ts';

export interface Input_Target {
    isDestroyed(): boolean;
    focus(): void;
    debugger: {
        isAttached(): boolean;
        attach(version: string): void;
        sendCommand(method: string, params: Record<string, unknown>): Promise<unknown>;
    };
}

type State = { queue: Promise<void>; buttons: number };
const button_bits = { left: 1, right: 2, middle: 4 };
const key_names: Record<string, string> = { Left: 'ArrowLeft', Right: 'ArrowRight', Up: 'ArrowUp', Down: 'ArrowDown', Space: ' ' };
const key_codes: Record<string, number> = {
    Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18, Escape: 27, ' ': 32,
    PageUp: 33, PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
    Insert: 45, Delete: 46, Meta: 91,
};

function modifier_bits(names: string[] = []): number {
    return names.reduce((bits, name) => bits | ({ alt: 1, ctrl: 2, control: 2, meta: 4, shift: 8 }[name] ?? 0), 0);
}

// Chromium routes these browser-level events to the frame under the pointer or
// holding keyboard focus. Electron's sendInputEvent misses cross-process iframes.
export class Remote_Input {
    readonly #states = new WeakMap<Input_Target, State>();

    send(target: Input_Target, input: Input_Event): Promise<void> {
        let state = this.#states.get(target);
        if (!state) { state = { queue: Promise.resolve(), buttons: 0 }; this.#states.set(target, state); }
        const current = state;
        // A release must not overtake its press while CDP dispatch is in flight.
        const next = current.queue.catch(() => {}).then(async () => {
            if (target.isDestroyed()) return;
            if (!target.debugger.isAttached()) target.debugger.attach('1.3');
            const command = (method: string, params: Record<string, unknown>) => target.debugger.sendCommand(method, params);
            if (input.kind === 'text') {
                target.focus();
                await command('Input.insertText', { text: input.text });
                return;
            }
            const modifiers = modifier_bits(input.modifiers);
            if (input.kind === 'key') {
                target.focus();
                const key = key_names[input.key] ?? input.key;
                const windowsVirtualKeyCode = key_codes[key] ?? (/^[a-z0-9]$/i.test(key) ? key.toUpperCase().charCodeAt(0) : /^F\d{1,2}$/.test(key) ? 111 + Number(key.slice(1)) : 0);
                const code = key === ' ' ? 'Space' : /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^\d$/.test(key) ? `Digit${key}` : key;
                await command('Input.dispatchKeyEvent', { type: input.action === 'down' ? 'keyDown' : 'keyUp', key, code, windowsVirtualKeyCode, modifiers, ...(key === 'Enter' && input.action === 'down' ? { text: '\r' } : {}) });
                return;
            }
            if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) return;
            const x = Math.round(input.x), y = Math.round(input.y);
            const button = input.button ?? 'left';
            if (input.action === 'down') { target.focus(); current.buttons |= button_bits[button]; }
            else if (input.action === 'up') current.buttons &= ~button_bits[button];
            if (input.action === 'wheel') {
                await command('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, modifiers, buttons: current.buttons, deltaX: input.dx ?? 0, deltaY: input.dy ?? 0 });
                return;
            }
            const type = input.action === 'move' ? 'mouseMoved' : input.action === 'down' ? 'mousePressed' : 'mouseReleased';
            const moved_button = current.buttons & 1 ? 'left' : current.buttons & 2 ? 'right' : current.buttons & 4 ? 'middle' : 'none';
            await command('Input.dispatchMouseEvent', { type, x, y, modifiers, button: input.action === 'move' ? moved_button : button, buttons: current.buttons, clickCount: input.action === 'move' ? 0 : input.clicks ?? 1 });
        });
        current.queue = next;
        return next;
    }
}
