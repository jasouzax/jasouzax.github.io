/* Hub_Link with a fake socket and mocked timers: hello, viewer gating, heartbeat, silence detection, backoff and auth rejection. */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Hub_Link } from '../link/hub.ts';
import type { Socket_Like } from '../link/hub.ts';

class Fake implements Socket_Like {
    sent: (string | Uint8Array)[] = [];
    buffered = 0;
    closed = false;
    terminated = false;
    handlers: Record<string, (...args: any[]) => void> = {};
    send(data: string | Uint8Array) { this.sent.push(data); }
    close() { this.closed = true; }
    terminate() { this.terminated = true; this.handlers.close?.(1006); }
    on(event: string, handler: (...args: any[]) => void) { this.handlers[event] = handler; }
    emit(event: string, ...args: unknown[]) { this.handlers[event]?.(...args); }
    texts(): any[] { return this.sent.filter((item) => typeof item === 'string' && item !== 'ping').map((item) => JSON.parse(item as string)); }
}

function setup() {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    const sockets: Fake[] = [];
    const headers: Record<string, string>[] = [];
    const link = new Hub_Link({
        url: 'wss://example.test/api/_/server/agent', app: 'test', platform: 'linux',
        sign: () => { const value = { 'x-jazu-nonce': String(headers.length) }; headers.push(value); return value; },
        open: () => { const socket = new Fake(); sockets.push(socket); return socket; },
        backoff_min_ms: 1000, backoff_max_ms: 8000,
    });
    return { link, sockets, headers };
}

test('says hello on open, signs every attempt freshly and gates traffic on viewers', () => {
    const { link, sockets, headers } = setup();
    try {
        const messages: any[] = [];
        link.on_message = (message) => messages.push(message);
        link.start();
        assert.equal(headers.length, 1);
        assert.equal(link.send({ t: 'auto_state', scripts: [] }), false);
        sockets[0].emit('open');
        assert.deepEqual(sockets[0].texts()[0], { t: 'agent_hello', version: 1, app: 'test', platform: 'linux' });
        assert.equal(link.has_viewers(), false);
        sockets[0].emit('message', JSON.stringify({ t: 'viewers', count: 2 }), false);
        assert.equal(link.has_viewers(), true);
        sockets[0].emit('message', JSON.stringify({ t: 'fs', id: 1, op: 'stat', path: '/', peer: 'p1' }), false);
        sockets[0].emit('message', JSON.stringify({ t: 'api_set' }), false);
        sockets[0].emit('message', 'pong', false);
        sockets[0].emit('message', Uint8Array.of(1), true);
        assert.deepEqual(messages.map((message) => message.t), ['viewers', 'fs']);
        link.send({ t: 'pty_out', id: 3, data: 'eA==' }, 'p1');
        assert.deepEqual(sockets[0].texts().at(-1), { t: 'pty_out', id: 3, data: 'eA==', to: 'p1' });
        assert.equal(link.send_binary(Uint8Array.of(1, 2)), true);
    } finally { mock.timers.reset(); }
});

test('reconnects with growing, capped backoff and resets it after a stable connection', () => {
    const { link, sockets } = setup();
    try {
        link.start();
        const waits: number[] = [];
        for (let attempt = 0; attempt < 5; attempt++) {
            sockets.at(-1)!.emit('close', 1006);
            let waited = 0;
            while (sockets.length === attempt + 1 && waited < 20_000) { mock.timers.tick(250); waited += 250; }
            waits.push(waited);
        }
        assert.ok(waits[0] <= 1500 && waits[0] >= 750, `first wait ${waits[0]}`);
        assert.ok(waits[1] > waits[0] * 1.2, 'grows');
        assert.ok(waits.every((wait) => wait <= 10_000), `capped ${waits}`);
        sockets.at(-1)!.emit('open');
        mock.timers.tick(31_000);
        sockets.at(-1)!.emit('close', 1006);
        const count = sockets.length;
        mock.timers.tick(1500);
        assert.equal(sockets.length, count + 1, 'back to the minimum wait after a stable connection');
    } finally { mock.timers.reset(); }
});

test('heartbeats go out, and a silent connection is terminated and re-opened', () => {
    const { link, sockets } = setup();
    try {
        link.start();
        sockets[0].emit('open');
        mock.timers.tick(25_000);
        assert.equal(sockets[0].sent.filter((item) => item === 'ping').length, 1);
        sockets[0].emit('message', 'pong', false);
        mock.timers.tick(50_000);
        assert.equal(sockets[0].terminated, false);
        mock.timers.tick(50_000);
        assert.equal(sockets[0].terminated, true);
        assert.equal(link.is_open, false);
        mock.timers.tick(2000);
        assert.equal(sockets.length, 2);
    } finally { mock.timers.reset(); }
});

test('a refused upgrade is logged with the likely cause and retried slowly; stop() ends everything', () => {
    const { sockets } = setup();
    const lines: string[] = [];
    try {
        const logged = new Hub_Link({ url: 'wss://x/api/_/server/agent', app: 't', platform: 'l', sign: () => ({}), open: () => { const socket = new Fake(); sockets.push(socket); return socket; }, log: (line) => lines.push(line), backoff_min_ms: 1000, backoff_max_ms: 8000 });
        logged.start();
        const socket = sockets.at(-1)!;
        socket.emit('rejected', 401);
        socket.emit('close', 1006);
        assert.ok(lines.some((line) => line.includes('SERVER_AGENT_SECRET')));
        logged.stop();
        const count = sockets.length;
        mock.timers.tick(600_000);
        assert.equal(sockets.length, count, 'no retry after stop');
    } finally { mock.timers.reset(); }
});
