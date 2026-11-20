import { client_message_types, heartbeat_ping, heartbeat_pong, parse_message, protocol_version } from './shared/protocol.ts';
import type { Agent_Message, Agent_To_Hub, Hub_To_Agent, Client_Message, Relayed, Routed } from './shared/protocol.ts';

/*
 * The agent's one connection to the Worker's Server_Hub Durable Object.
 *
 * Entities
 *   Socket_Like   the few methods of a WebSocket the link needs (the `ws` package in production, a fake in tests)
 *   Hub_Link      connects, says hello, reconnects with backoff, answers nothing by itself except heartbeats and the viewer count
 *   Incoming      what the hub delivers: a page's request (with `peer`) or a hub notice
 *
 * Responsibilities
 *   Free-tier budget: nothing is sent while no page is connected (`has_viewers()`); heartbeats are tiny text frames the hub auto-answers.
 *   A connection that stays silent past `silence_ms` is dropped and re-opened, so a dead Wi-Fi never leaves the agent "online" on the site.
 * Limits
 *   Does not interpret requests: handlers register through `on_message`.
 */
export interface Socket_Like {
    send(data: string | Uint8Array): void;
    close(code?: number): void;
    terminate(): void;
    // Bytes queued but not yet sent, to drop video frames instead of lagging
    readonly buffered: number;
    on(event: 'open', handler: () => void): void;
    on(event: 'message', handler: (data: string | Uint8Array, is_binary: boolean) => void): void;
    on(event: 'close', handler: (code: number) => void): void;
    on(event: 'error', handler: (error: Error) => void): void;
    // The upgrade was answered with an HTTP status instead of 101 (401 = wrong secret)
    on(event: 'rejected', handler: (status: number) => void): void;
}

export type Incoming = Relayed<Client_Message> | Hub_To_Agent;
export type Open_Socket = (url: string, headers: Record<string, string>) => Socket_Like;

export interface Link_Options {
    // wss://host/api/server/agent
    url: string;
    sign: (url: string) => Record<string, string>;
    open: Open_Socket;
    app: string;
    platform: string;
    heartbeat_ms?: number;
    silence_ms?: number;
    backoff_min_ms?: number;
    backoff_max_ms?: number;
    log?: (line: string) => void;
}

const incoming_types = new Set<string>([...client_message_types, 'viewers', 'peer_gone', 'api_req', 'fastfetch_req']);

export class Hub_Link {
    readonly #options: Required<Link_Options>;
    #socket: Socket_Like | null = null;
    #is_open = false;
    #stopped = true;
    #viewers = 0;
    #attempts = 0;
    #last_seen = 0;
    #opened_at = 0;
    #timers: { retry?: NodeJS.Timeout; beat?: NodeJS.Timeout } = {};
    on_message: (message: Incoming) => void = () => {};
    on_open: () => void = () => {};
    on_close: () => void = () => {};

    constructor(options: Link_Options) {
        this.#options = { heartbeat_ms: 25_000, silence_ms: 75_000, backoff_min_ms: 1_000, backoff_max_ms: 60_000, log: () => {}, ...options };
    }

    get is_open(): boolean {
        return this.#is_open;
    }

    get buffered(): number {
        return this.#socket?.buffered ?? 0;
    }

    // True when at least one page is connected: only then may the agent send anything that is not an answer
    has_viewers(): boolean {
        return this.#is_open && this.#viewers > 0;
    }

    start(): void {
        if (!this.#stopped) return;
        this.#stopped = false;
        this.#connect();
    }

    stop(): void {
        this.#stopped = true;
        this.#clear_timers();
        this.#socket?.close(1000);
        this.#socket = null;
        this.#is_open = false;
    }

    // To one page (`to`) or to every page. False when the link is down, so callers can keep their data for later
    send(message: Routed<Agent_Message>, to?: string): boolean {
        return this.#write(to === undefined ? message : { ...message, to });
    }

    // For the hub itself: hello, endpoint map, gateway and snapshot answers
    send_hub(message: Agent_To_Hub): boolean {
        return this.#write(message);
    }

    send_binary(packet: Uint8Array): boolean {
        if (!this.#is_open || !this.#socket) return false;
        this.#socket.send(packet);
        return true;
    }

    #write(message: unknown): boolean {
        if (!this.#is_open || !this.#socket) return false;
        this.#socket.send(JSON.stringify(message));
        return true;
    }

    #connect(): void {
        if (this.#stopped) return;
        const { url, sign, open, log } = this.#options;
        this.#attempts++;
        let socket: Socket_Like;
        try {
            socket = open(url, sign(url));
        } catch (error) {
            log(`connect failed: ${error instanceof Error ? error.message : error}`);
            return this.#schedule(false);
        }
        this.#socket = socket;
        let rejected = false;
        socket.on('open', () => this.#on_open(socket));
        socket.on('message', (data, is_binary) => this.#on_data(socket, data, is_binary));
        socket.on('rejected', (status) => {
            rejected = true;
            log(status === 401 || status === 403 ? `the Worker refused the agent (${status}): check SERVER_AGENT_SECRET` : `the Worker answered ${status}`);
        });
        socket.on('error', (error) => log(`socket error: ${error.message}`));
        socket.on('close', () => this.#on_close(socket, rejected));
    }

    #on_open(socket: Socket_Like): void {
        if (socket !== this.#socket) return;
        this.#is_open = true;
        this.#viewers = 0;
        this.#last_seen = this.#opened_at = Date.now();
        this.#timers.beat = setInterval(() => this.#beat(socket), this.#options.heartbeat_ms);
        this.#options.log('connected to the Worker');
        this.#write({ t: 'agent_hello', version: protocol_version, app: this.#options.app, platform: this.#options.platform });
        this.on_open();
    }

    #beat(socket: Socket_Like): void {
        if (socket !== this.#socket) return;
        if (Date.now() - this.#last_seen > this.#options.silence_ms) {
            this.#options.log('no answer from the Worker, reconnecting');
            socket.terminate();
            return;
        }
        socket.send(heartbeat_ping);
    }

    #on_data(socket: Socket_Like, data: string | Uint8Array, is_binary: boolean): void {
        if (socket !== this.#socket) return;
        this.#last_seen = Date.now();
        if (is_binary || typeof data !== 'string' || data === heartbeat_pong) return;
        const message = parse_message(data, incoming_types) as Incoming | null;
        if (!message) return;
        if (message.t === 'viewers') this.#viewers = Math.max(0, Math.floor(Number(message.count)) || 0);
        this.on_message(message);
    }

    #on_close(socket: Socket_Like, rejected: boolean): void {
        if (socket !== this.#socket) return;
        const was_open = this.#is_open;
        const stable = was_open && Date.now() - this.#opened_at > 30_000;
        this.#socket = null;
        this.#is_open = false;
        this.#viewers = 0;
        this.#clear_timers();
        if (stable) this.#attempts = 0;
        if (was_open) this.on_close();
        if (!this.#stopped) this.#schedule(rejected);
    }

    #schedule(rejected: boolean): void {
        const { backoff_min_ms, backoff_max_ms, log } = this.#options;
        const ceiling = rejected ? backoff_max_ms * 5 : backoff_max_ms;
        const base = Math.min(ceiling, backoff_min_ms * 2 ** Math.min(this.#attempts - 1, 16));
        // Jitter keeps a restarted Worker from being hit by every agent at the same instant
        const wait = Math.round(base * (0.75 + Math.random() * 0.5));
        log(`reconnecting in ${Math.round(wait / 1000)} s`);
        this.#timers.retry = setTimeout(() => this.#connect(), wait);
    }

    #clear_timers(): void {
        clearInterval(this.#timers.beat);
        clearTimeout(this.#timers.retry);
        this.#timers = {};
    }
}
