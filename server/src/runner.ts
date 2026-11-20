/*
 * Runs `*.auto.js` files the way Browsite ran its scripts, but the scripts are files of the Pi, identified by their absolute path.
 *
 * Entities
 *   Script_Runner   starts, stops and watches scripts; emits 'log' (path, entry), 'status' (path, running), 'logs_cleared' (path), 'web' (path, web)
 *   Run             one execution: the windows, timers and APIs it started, so stopping can take all of it away
 *   Runner_Options  what is injected: how to read a file, the Web class (Electron), the API registry
 *
 * Responsibilities
 *   The body of the file is the body of an `async` function with `Web`, `API`, `require`, `console`, `sleep` and scoped timers.
 *   A script is running until its code and every timer and API it made are done: a timer or an API makes it a service.
 *   Logs (1000 per script) live here, so a page that connects later can read what happened while it was away.
 * Limits
 *   Not a sandbox: the script is the owner's code on the owner's machine. Only the owner can reach the channel that starts it.
 *   The Web class is injected so this file never imports Electron and its tests run under plain Node.
 */
import { AsyncLocalStorage } from 'async_hooks';
import { EventEmitter } from 'events';
import { createRequire } from 'module';
import * as path from 'path';
import { format, inspect } from 'util';
import * as vm from 'vm';
import type { Log_Entry, Log_Level, Script_Info } from './shared/protocol.ts';
import type { Web, web_options } from './web.ts';
import type { Auto_Start } from './autostart.ts';
import { Api_Registry } from './api.ts';
import type { Api, Api_Options, Api_Owner } from './api.ts';

export const max_logs_per_script = 1000;
export const script_suffix = '.auto.js';
let next_log_id = 1;

type Web_Class = typeof Web;

export interface Runner_Options {
    // The source of a script, or a rejection with a readable message
    read_source: (script_path: string) => Promise<string>;
    web_class: Web_Class;
    apis: Api_Registry;
    // Scripts `require` the packages next to this folder's package.json
    root: string;
    // Electron would show an error dialog for an uncaught exception: route them to the logs instead
    catch_stray?: boolean;
    autostart?: Auto_Start;
    restart_min_ms?: number;
    restart_max_ms?: number;
}

class Run {
    readonly script_path: string;
    readonly webs = new Set<Web>();
    readonly timers = new Set<NodeJS.Timeout>();
    // The APIs the script publishes: like a timer, one keeps the script running as a service
    readonly apis = new Set<Api>();
    readonly abort = new AbortController();
    // The "Ended" line was logged: the main code and every timer are done
    is_over = false;
    // Stop was pressed (or a newer run replaced this one): from then on it may do nothing visible
    is_stopped = false;
    is_main_done = false;
    failed = false;
    callbacks = 0;
    started_at = Date.now();

    constructor(script_path: string) {
        this.script_path = script_path;
    }
}

export class Script_Runner extends EventEmitter {
    readonly #options: Runner_Options;
    readonly #require: NodeJS.Require;
    readonly #runs = new Map<string, Run>();
    readonly #loading = new Map<string, symbol>();
    readonly #retries = new Map<string, NodeJS.Timeout>();
    readonly #attempts = new Map<string, number>();
    #shutting_down = false;
    readonly #logs = new Map<string, Log_Entry[]>();
    // Lets an error that nobody caught be traced back to the run it came from
    readonly #context = new AsyncLocalStorage<Run>();

    constructor(options: Runner_Options) {
        super();
        this.#options = options;
        this.#require = createRequire(path.join(options.root, 'package.json'));
        if (options.catch_stray !== false) {
            process.on('uncaughtException', (error) => this.#on_stray_error(error));
            process.on('unhandledRejection', (reason) => this.#on_stray_error(reason));
        }
    }

    // ---------- Reading ----------
    is_running(script_path: string): boolean {
        const run = this.#runs.get(script_path);
        return run !== undefined && !run.is_over;
    }

    logs(script_path: string): Log_Entry[] {
        return this.#logs.get(script_path) ?? [];
    }

    // Every script that ran (or has a window) since the agent started
    list(): Script_Info[] {
        const paths = new Set([...this.#runs.keys(), ...this.#logs.keys(), ...(this.#options.autostart?.list() ?? [])]);
        return [...paths].sort().map((script_path) => ({ path: script_path, running: this.is_running(script_path), windows: this.#runs.get(script_path)?.webs.size ?? 0, ...this.#state(script_path) }));
    }

    // ---------- Control ----------
    #state(script_path: string): { autostart?: boolean, restarting?: boolean } {
        if (!this.#options.autostart) return {};
        const autostart = this.#options.autostart.has(script_path);
        return { autostart, restarting: autostart && !this.is_running(script_path) };
    }

    #status(script_path: string): void {
        this.emit('status', script_path, this.is_running(script_path), this.#state(script_path));
    }

    async restore(): Promise<void> {
        await Promise.all((this.#options.autostart?.list() ?? []).map(script => this.start(script)));
    }

    async start(script_path: string): Promise<void> {
        if (this.#shutting_down || !script_path.endsWith(script_suffix) || this.is_running(script_path) || this.#loading.has(script_path)) return;
        this.#options.autostart?.set(script_path, true);
        this.#cancel_retry(script_path);
        this.#attempts.delete(script_path);
        await this.#launch(script_path);
    }

    async #launch(script_path: string): Promise<void> {
        if (this.#shutting_down) return;
        const token = Symbol();
        this.#loading.set(script_path, token);
        let code: string;
        try { code = await this.#options.read_source(script_path); }
        catch (error) {
            if (this.#loading.get(script_path) !== token) return;
            this.#loading.delete(script_path);
            this.#log(script_path, 'error', `Cannot read ${script_path}: ${error instanceof Error ? error.message : error}`);
            this.#retry(script_path);
            this.#status(script_path);
            return;
        }
        if (this.#loading.get(script_path) !== token || this.#shutting_down) return;
        const previous = this.#runs.get(script_path);
        if (previous) await this.#end_run(previous);
        if (this.#loading.get(script_path) !== token || this.#shutting_down) return;
        this.#loading.delete(script_path);
        const run = new Run(script_path);
        this.#runs.set(script_path, run);
        this.#log(script_path, 'system', 'Started');
        this.#status(script_path);
        void this.#execute(run, path.basename(script_path), code);
    }

    #cancel_retry(script_path: string): void {
        clearTimeout(this.#retries.get(script_path));
        this.#retries.delete(script_path);
        this.#loading.delete(script_path);
    }

    #retry(script_path: string): void {
        if (this.#shutting_down || !this.#options.autostart?.has(script_path)) return;
        const attempt = this.#attempts.get(script_path) ?? 0;
        this.#attempts.set(script_path, attempt + 1);
        const delay = Math.min(this.#options.restart_max_ms ?? 60_000, (this.#options.restart_min_ms ?? 1000) * 2 ** Math.min(attempt, 16));
        this.#log(script_path, 'system', `Restarting in ${delay} ms`);
        const timer = setTimeout(() => {
            this.#retries.delete(script_path);
            void this.#launch(script_path);
        }, delay);
        timer.unref();
        this.#retries.set(script_path, timer);
    }

    async stop(script_path: string): Promise<void> {
        this.#options.autostart?.set(script_path, false);
        this.#cancel_retry(script_path);
        this.#attempts.delete(script_path);
        const run = this.#runs.get(script_path);
        if (run && !run.is_over) { await this.#end_run(run); this.#finish(run); }
        else this.#status(script_path);
    }

    async stop_all(): Promise<void> {
        await Promise.all(this.list().map(script => this.stop(script.path)));
    }

    // Shutdown is different from Stop: persisted intent survives the process.
    async shutdown(): Promise<void> {
        this.#shutting_down = true;
        for (const script of new Set([...this.#retries.keys(), ...this.#loading.keys()])) this.#cancel_retry(script);
        await Promise.all([...this.#runs.values()].map(async run => { await this.#end_run(run); this.#finish(run); }));
    }

    // Remove the session, including stopped runs and manually opened windows.
    // Its source file is independent of runtime state and stays in Files.
    async remove(script_path: string): Promise<void> {
        this.#options.autostart?.set(script_path, false);
        this.#cancel_retry(script_path);
        this.#attempts.delete(script_path);
        const run = this.#runs.get(script_path);
        if (run) {
            await this.#end_run(run);
            this.#finish(run);
            // A newer start may have arrived while the old windows were closing.
            if (this.#runs.get(script_path) !== run) return;
            this.#runs.delete(script_path);
        }
        this.#logs.delete(script_path);
        this.emit('deleted', script_path);
    }

    // A blank window in the group of a script, without running any code (the "+" of the window tabs).
    // It joins the run the script has, or a bare one of its own: Stop and the next Start take it away again
    open_window(script_path: string): boolean {
        if (!script_path.endsWith(script_suffix)) return false;
        let run = this.#runs.get(script_path);
        if (!run || run.is_stopped) {
            run = new Run(script_path);
            // No code behind it: it does not make the script "running", and it has nothing to wait for
            run.is_main_done = true;
            run.is_over = true;
            this.#runs.set(script_path, run);
        }
        this.#adopt(run, new (this.#options.web_class)('about:blank'));
        return true;
    }

    clear_logs(script_path: string): void {
        this.#logs.delete(script_path);
        this.emit('logs_cleared', script_path);
    }

    // ---------- Running ----------
    async #execute(run: Run, name: string, code: string): Promise<void> {
        const scope = this.#scope(run);
        try {
            // One line of wrapper, so line numbers in errors are the lines of the script
            const script = new vm.Script(`(async function (${Object.keys(scope).join(', ')}) {${code}\n})`, {
                filename: name,
                importModuleDynamically: vm.constants?.USE_MAIN_CONTEXT_DEFAULT_LOADER as any,
            });
            const main = script.runInThisContext() as (...args: unknown[]) => Promise<unknown>;
            await this.#context.run(run, () => main(...Object.values(scope)));
        } catch (error) {
            this.#report(run, error);
        } finally {
            run.is_main_done = true;
            this.#settle(run);
        }
    }

    // The globals of a script. Everything that outlives a line of code is tied to the run
    #scope(run: Run): Record<string, unknown> {
        const write = (level: Log_Level) => (...args: unknown[]) => {
            if (!run.is_stopped) this.#log(run.script_path, level, format(...args));
        };
        const guard = (callback: (...args: any[]) => unknown, args: unknown[]) => {
            if (run.is_stopped) return;
            run.callbacks++;
            Promise.resolve().then(() => callback(...args)).catch((error) => this.#report(run, error)).finally(() => {
                run.callbacks--;
                this.#settle(run);
            });
        };
        const runner = this;
        const Base = this.#options.web_class;
        const Scoped_Web = class extends Base {
            constructor(url?: string, options?: web_options) {
                super(url, options);
                runner.#adopt(run, this);
            }
            static override async close_all(): Promise<number> {
                const results = await Promise.all([...run.webs].map((web) => web.close()));
                return results.filter(Boolean).length;
            }
            static override get pages(): Web[] {
                return [...run.webs];
            }
        };

        // `new API('name')` publishes an API, `API('name')` calls one (of any script)
        const owner: Api_Owner = {
            script_id: run.script_path,
            script_name: () => path.basename(run.script_path),
            run: (task) => this.#context.run(run, task),
            report: (error) => this.#report(run, error),
            closed: (api) => {
                run.apis.delete(api);
                this.#settle(run);
            },
        };
        const registry = this.#options.apis;
        const API = function (this: unknown, name: string, options?: Api_Options) {
            if (!new.target) return registry.client(name);
            if (run.is_stopped) throw new Error('Script stopped');
            const api = registry.create(owner, name, options);
            run.apis.add(api);
            return api;
        };

        return {
            Web: Scoped_Web,
            API,
            require: this.#require,
            console: {
                log: write('log'),
                info: write('info'),
                debug: write('debug'),
                warn: write('warn'),
                error: write('error'),
                trace: (...args: unknown[]) => write('error')(new Error(format(...args)).stack?.replace('Error:', 'Trace:')),
                dir: (value: unknown) => write('log')(inspect(value, { depth: 4 })),
                table: (value: unknown) => write('log')(inspect(value, { depth: 4 })),
                assert: (condition: unknown, ...args: unknown[]) => condition || write('error')('Assertion failed:', ...args),
            },
            // Rejects when the script is stopped, so a sleeping script wakes up and ends
            sleep: (milliseconds: number) =>
                new Promise<void>((resolve, reject) => {
                    const timer = setTimeout(resolve, milliseconds);
                    run.abort.signal.addEventListener('abort', () => {
                        clearTimeout(timer);
                        reject(new Error('Script stopped'));
                    }, { once: true });
                }),
            // A script with a running timer is a service: it is not over until the timers are
            setTimeout: (callback: (...args: any[]) => unknown, milliseconds?: number, ...args: unknown[]) => {
                const timer = setTimeout(() => {
                    run.timers.delete(timer);
                    this.#context.run(run, () => guard(callback, args));
                    this.#settle(run);
                }, milliseconds);
                run.timers.add(timer);
                return timer;
            },
            setInterval: (callback: (...args: any[]) => unknown, milliseconds?: number, ...args: unknown[]) => {
                const timer = setInterval(() => this.#context.run(run, () => guard(callback, args)), milliseconds);
                run.timers.add(timer);
                return timer;
            },
            clearTimeout: (timer: NodeJS.Timeout) => {
                clearTimeout(timer);
                run.timers.delete(timer);
                this.#settle(run);
            },
            clearInterval: (timer: NodeJS.Timeout) => {
                clearInterval(timer);
                run.timers.delete(timer);
                this.#settle(run);
            },
            __dirname: path.dirname(run.script_path),
            __filename: run.script_path,
        };
    }

    #adopt(run: Run, web: Web): void {
        run.webs.add(web);
        web.once('close', () => run.webs.delete(web));
        // A page that opens a popup: the popup belongs to the same script
        web.on('popup', (child: Web) => this.#adopt(run, child));
        this.emit('web', run.script_path, web);
        if (run.is_stopped) void web.close();
    }

    // ---------- Ending ----------
    // Nothing of the run may keep going: timers, sleeps, APIs and windows
    async #end_run(run: Run): Promise<void> {
        run.is_stopped = true;
        run.abort.abort();
        for (const timer of run.timers) {
            clearTimeout(timer);
            clearInterval(timer);
        }
        run.timers.clear();
        // Nobody can call the APIs of a script that is stopped
        this.#options.apis.remove_all(run.apis);
        run.apis.clear();
        await Promise.allSettled([...run.webs].map((web) => web.close()));
    }

    #settle(run: Run): void {
        if (!run.failed && !run.is_stopped && run.is_main_done && run.callbacks === 0 && run.timers.size === 0 && run.apis.size === 0) this.#finish(run);
    }

    #finish(run: Run): void {
        if (run.is_over) return;
        run.is_over = true;
        this.#log(run.script_path, 'system', 'Ended');
        // A newer run may already own the script: only the current one reports the status
        if (this.#runs.get(run.script_path) === run) {
            if (!this.#shutting_down && !run.failed) {
                try { this.#options.autostart?.set(run.script_path, false); }
                catch (error) { this.#log(run.script_path, 'error', `Cannot update restart list: ${error}`); }
            }
            if (run.failed) {
                if (Date.now() - run.started_at >= 60_000) this.#attempts.delete(run.script_path);
                this.#retry(run.script_path);
            }
            this.#status(run.script_path);
        }
    }

    // ---------- Errors ----------
    #report(run: Run, error: unknown): void {
        if (run.is_stopped) return;
        this.#log(run.script_path, 'error', this.#describe(error));
        if (run.failed) return;
        run.failed = true;
        void this.#end_run(run).then(() => this.#finish(run));
    }

    #on_stray_error(error: unknown): void {
        const run = this.#context.getStore();
        const owners = run ? [run] : [...this.#runs.values()].filter((candidate) => !candidate.is_over);
        console.error('[runner] uncaught:', error);
        for (const owner of owners) this.#report(owner, error);
    }

    // The message and the frames inside the script, without the plumbing of Node and Electron
    #describe(error: unknown): string {
        if (!(error instanceof Error)) return `Uncaught ${inspect(error)}`;
        // A syntax error's stack starts with "file:line" and the source line, which would show the wrapper
        const location = /^(.+\.js):(\d+)\n/.exec(error.stack ?? '');
        if (error instanceof SyntaxError && location) return `${error.name}: ${error.message}\n    at ${location[1]}:${location[2]}`;
        const lines = (error.stack ?? `${error.name}: ${error.message}`).split('\n');
        return lines.filter((line) => !/node:|node_modules|[\\/]dist[\\/]|app\.asar/.test(line)).join('\n');
    }

    #log(script_path: string, level: Log_Level, text: string): void {
        const entry: Log_Entry = { id: next_log_id++, time: Date.now(), level, text };
        const entries = this.#logs.get(script_path) ?? [];
        entries.push(entry);
        if (entries.length > max_logs_per_script) entries.splice(0, entries.length - max_logs_per_script);
        this.#logs.set(script_path, entries);
        this.emit('log', script_path, entry);
    }
}
