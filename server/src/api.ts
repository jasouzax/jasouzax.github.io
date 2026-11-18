/*
 * The API feature: a script publishes named endpoints (`new API('sample')`) that answer on jasouza.com/api/sample/...
 * and that other scripts call directly (`API('sample').get('friend')`), without a network hop.
 *
 * Entities
 *   Api_Registry   every API of every running script; tells the hub what it publishes (`on_change`)
 *   Api / Api_Scope   what a script gets from `new API(name)`: a tree of routes
 *   Api_Client     what a script gets from `API(name)`: calls an API of any script
 *   Api_Reply      the `res` of a handler (send, html, file, download, redirect)
 *   serve_http     turns one request relayed by the Worker (`api_req`) into the answer (`api_res`)
 *
 * Limits
 *   Knows names, routes and handlers only: no Electron, no sockets. A handler that is silent for 30 s answers 504.
 *   Whether a caller may see a private API is decided by the Worker (it answers 404 to everybody else); the agent trusts the relay.
 */
import { api_body_limit, api_name_pattern, reserved_api_names } from './shared/protocol.ts';
import type { Api_Answer, Api_Call, Api_Info } from './shared/protocol.ts';

export const api_methods = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type Api_Method = (typeof api_methods)[number];

const reserved_names = new Set<string>(reserved_api_names);
const name_pattern = api_name_pattern;
// A handler that has not answered by then gives the caller a 504
const handler_timeout_ms = 30_000;

export interface Api_Options {
    // Answers without a signed in session. Off by default: an API is as private as the rest of the site
    public?: boolean;
}

// The second argument of every handler: what was asked (the answer is the third one, `res`)
export interface Api_Request {
    method: string;
    // The part after /api/<name>/, without slashes at the ends
    path: string;
    // The :segments of the route that matched
    params: Record<string, string>;
    query: Record<string, string | string[]>;
    // The headers of the HTTP request, empty for a call from another script
    headers: Record<string, string | string[] | undefined>;
    ip: string;
    via: 'http' | 'script';
}

// The third argument of every handler: how to answer. What the handler returns is sent as JSON; to answer something else
// than JSON (a page, a picture, a download...) it calls one of the methods below, and what it returns is then ignored
export class Api_Reply {
    // The HTTP status, 200 unless set
    status = 200;
    // Headers of the answer (the names are not case sensitive)
    headers: Record<string, string> = {};
    #body: Buffer | null = null;

    // Answers with these bytes (or this text) as they are
    send(body: string | Uint8Array | ArrayBuffer, type?: string): this {
        if (typeof body === 'string') {
            this.#body = Buffer.from(body, 'utf8');
            this.#type_if_missing(type ? with_charset(type) : 'text/plain; charset=utf-8');
        } else if (body instanceof ArrayBuffer) {
            this.#body = Buffer.from(body.slice(0));
            this.#type_if_missing(type ?? 'application/octet-stream');
        } else if (body instanceof Uint8Array) {
            this.#body = Buffer.from(body);
            this.#type_if_missing(type ?? 'application/octet-stream');
        } else {
            throw new TypeError('res.send(body): the body must be a string, a Buffer or a Uint8Array');
        }
        return this;
    }
    text(body: string): this {
        return this.send(String(body), 'text/plain');
    }
    html(body: string): this {
        return this.send(String(body), 'text/html');
    }
    // A file shown by the browser (an image, a PDF...)
    file(body: Uint8Array | ArrayBuffer | string, type = 'application/octet-stream'): this {
        return this.send(body, type);
    }
    // A file the browser saves under this name
    download(body: Uint8Array | ArrayBuffer | string, filename: string, type = 'application/octet-stream'): this {
        this.headers['content-disposition'] = `attachment; filename="${String(filename).replace(/["\\\r\n]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(String(filename))}`;
        return this.send(body, type);
    }
    // Sends the caller somewhere else (302 unless another status is given)
    redirect(url: string, status = 302): this {
        this.status = status;
        this.headers.location = String(url);
        this.#body = Buffer.alloc(0);
        return this;
    }

    // What the handler sent with the methods above, null when it did not (read by the registry)
    get raw(): Buffer | null {
        return this.#body;
    }

    #type_if_missing(type: string): void {
        if (!Object.keys(this.headers).some((name) => name.toLowerCase() === 'content-type')) this.headers['content-type'] = type;
    }
}

function with_charset(type: string): string {
    return /^text\//i.test(type) && !/charset=/i.test(type) ? `${type}; charset=utf-8` : type;
}

export type Api_Handler = (arg: any, req: Api_Request, res: Api_Reply) => unknown;

export interface Api_Response {
    status: number;
    // Names in lower case
    headers: Record<string, string>;
    body: Buffer;
}

// What the registry needs to know about the script (run) that owns an API
export interface Api_Owner {
    script_id: string;
    script_name(): string;
    // Runs a handler as part of the run of the script, so errors and timers are traced back to it
    run<T>(task: () => T): T;
    // A handler threw
    report(error: unknown): void;
    // The script closed the API itself
    closed(api: Api): void;
}

// What a caller gets when the API answered with an error status (400 and up)
export class Api_Error extends Error {
    readonly status: number;
    readonly body: unknown;

    constructor(status: number, body: unknown) {
        super(typeof (body as { error?: unknown } | null)?.error === 'string' ? (body as { error: string }).error : `API answered ${status}`);
        this.name = 'Api_Error';
        this.status = status;
        this.body = body;
    }
}

interface Route {
    method: Api_Method;
    segments: string[];
    handler: Api_Handler;
}

const timed_out = Symbol('timed out');

function split_path(path: string): string[] {
    return path.split('/').filter((segment) => segment !== '');
}

function lower_names(headers: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value)]));
}

function json_response(status: number, body: unknown, headers: Record<string, string> = {}): Api_Response {
    const json = body === undefined ? '' : (JSON.stringify(body) ?? '');
    return { status, headers: json ? { 'content-type': 'application/json; charset=utf-8', ...lower_names(headers) } : lower_names(headers), body: Buffer.from(json, 'utf8') };
}

// What a caller in a script gets of an answer: JSON is parsed, text is a string, anything else a Buffer
function decode_body(response: Api_Response): unknown {
    if (response.body.length === 0) return undefined;
    const type = (response.headers['content-type'] ?? '').toLowerCase();
    if (type.includes('json')) return JSON.parse(response.body.toString('utf8'));
    if (type.startsWith('text/') || type.includes('xml') || type.includes('javascript')) return response.body.toString('utf8');
    return Buffer.from(response.body);
}

// The routes of one API: every Api_Scope of it registers here
class Api_Core {
    readonly routes: Route[] = [];

    add(method: Api_Method, segments: string[], handler: Api_Handler): void {
        // The same method and path again replaces the handler
        const same = this.routes.findIndex((route) => route.method === method && route.segments.join('/') === segments.join('/'));
        if (same >= 0) this.routes.splice(same, 1);
        this.routes.push({ method, segments, handler });
        // A fixed path wins over one with :parameters
        this.routes.sort((a, b) => a.segments.filter((s) => s.startsWith(':')).length - b.segments.filter((s) => s.startsWith(':')).length);
    }

    // The route for a request, or the methods the path does know when the method is the problem
    match(method: string, path: string[]): { route: Route | null; params: Record<string, string>; allowed: string[] } {
        const allowed = new Set<string>();
        for (const route of this.routes) {
            if (route.segments.length !== path.length) continue;
            const params: Record<string, string> = {};
            const fits = route.segments.every((segment, index) => {
                if (segment.startsWith(':')) {
                    params[segment.slice(1)] = path[index];
                    return true;
                }
                return segment === path[index];
            });
            if (!fits) continue;
            if (route.method === method) return { route, params, allowed: [] };
            allowed.add(route.method);
        }
        return { route: null, params: {}, allowed: [...allowed] };
    }
}

function parse_path(path: unknown, what: string): string[] {
    if (typeof path !== 'string') throw new TypeError(`${what}: the path must be a string ('' is the root)`);
    if (/\/\/|\/:(\/|$)|^:(\/|$)/.test(path)) throw new Error(`Invalid API path "${path}"`);
    return split_path(path);
}

// A level of an API: the API itself, or the sub API that a route gives back. Every method that adds a route
// returns the sub API at that route, so an API can be written as a tree instead of a flat list of endpoints:
//   let customers = api.get('customer', () => list);
//   customers.get(':id', (arg) => list[arg.id]);     // GET /customer/:id
//   api.get('customer', () => list).for((sub) => sub.get(':id', (arg) => list[arg.id]));
export class Api_Scope {
    protected readonly core: Api_Core;
    protected readonly prefix: string[];

    constructor(core: Api_Core, prefix: string[]) {
        this.core = core;
        this.prefix = prefix;
    }

    // The path of this level, relative to the API ('' for the API itself)
    get path(): string {
        return this.prefix.join('/');
    }

    get(path: string, handler: Api_Handler): Api_Scope {
        return this.#add('get', path, handler);
    }
    post(path: string, handler: Api_Handler): Api_Scope {
        return this.#add('post', path, handler);
    }
    put(path: string, handler: Api_Handler): Api_Scope {
        return this.#add('put', path, handler);
    }
    patch(path: string, handler: Api_Handler): Api_Scope {
        return this.#add('patch', path, handler);
    }
    delete(path: string, handler: Api_Handler): Api_Scope {
        return this.#add('delete', path, handler);
    }

    // The sub API at a path, without a route of its own: api.at('customer').get(':id', ...)
    at(path: string): Api_Scope {
        return new Api_Scope(this.core, [...this.prefix, ...parse_path(path, 'api.at(path)')]);
    }

    // Hands this level to a function, to write what is under it in one place, and gives it back
    for(callback: (scope: Api_Scope) => unknown): this {
        if (typeof callback !== 'function') throw new TypeError('api.for(callback): the callback must be a function');
        callback(this);
        return this;
    }

    #add(method: Api_Method, path: unknown, handler: unknown): Api_Scope {
        const segments = [...this.prefix, ...parse_path(path, `api.${method}(path, handler)`)];
        if (typeof handler !== 'function') throw new TypeError(`api.${method}(path, handler): the handler must be a function`);
        this.core.add(method, segments, handler as Api_Handler);
        return new Api_Scope(this.core, segments);
    }
}

// One published API, the object a script gets from `new API(name)`
export class Api extends Api_Scope {
    readonly name: string;
    readonly is_public: boolean;
    readonly owner: Api_Owner;
    readonly #registry: Api_Registry;

    constructor(name: string, is_public: boolean, owner: Api_Owner, registry: Api_Registry) {
        super(new Api_Core(), []);
        this.name = name;
        this.is_public = is_public;
        this.owner = owner;
        this.#registry = registry;
    }

    // Takes the API down before the script ends
    close(): void {
        if (this.#registry.remove(this)) this.owner.closed(this);
    }

    match(method: string, path: string[]): { route: Route | null; params: Record<string, string>; allowed: string[] } {
        return this.core.match(method, path);
    }
}

// What a caller in a script may say about its request: what a handler reads in `req` that a script has a say in
// (method, path and params come from the call itself, and `via` is always 'script')
export interface Api_Client_Request {
    headers?: Record<string, string>;
    query?: Record<string, string | string[]>;
    ip?: string;
}

function client_request(req: unknown): Pick<Api_Request, 'headers' | 'query' | 'ip'> {
    if (req === undefined) return { headers: {}, query: {}, ip: '' };
    if (req === null || typeof req !== 'object' || Array.isArray(req)) throw new TypeError('The request (third argument) must be an object');
    for (const key of Object.keys(req)) {
        if (key !== 'headers' && key !== 'query' && key !== 'ip') throw new TypeError(`Unknown field "${key}" in the request: headers, query and ip can be given`);
    }
    const { headers = {}, query = {}, ip = '' } = req as Api_Client_Request;
    const is_record = (value: unknown) => value !== null && typeof value === 'object' && !Array.isArray(value);
    if (!is_record(headers)) throw new TypeError('req.headers must be an object');
    if (!is_record(query)) throw new TypeError('req.query must be an object');
    if (typeof ip !== 'string') throw new TypeError('req.ip must be a string');
    return {
        // As over HTTP: header names are in lower case, and everything is text
        headers: Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value)])),
        query: Object.fromEntries(Object.entries(query).map(([name, value]) => [name, Array.isArray(value) ? value.map(String) : String(value)])),
        ip,
    };
}

// What a script gets from `API(name)`: calls the API of another script (or its own) directly. The calls are
// `get(endpoint, args?, req?)`: `args` is the `arg` of the handler, `req` what the handler may read about the request
// (headers, query, ip). A call that is answered with an error status rejects with an Api_Error, anything else
// resolves with what the handler answered (parsed JSON, a string for text, a Buffer for anything else)
export class Api_Client {
    readonly name: string;
    readonly #registry: Api_Registry;

    constructor(name: string, registry: Api_Registry) {
        this.name = name;
        this.#registry = registry;
    }

    get is_running(): boolean {
        return this.#registry.info(this.name) !== undefined;
    }

    get(endpoint = '', args: object = {}, req?: Api_Client_Request): Promise<any> {
        return this.#call('get', endpoint, args, req);
    }
    post(endpoint = '', args: object = {}, req?: Api_Client_Request): Promise<any> {
        return this.#call('post', endpoint, args, req);
    }
    put(endpoint = '', args: object = {}, req?: Api_Client_Request): Promise<any> {
        return this.#call('put', endpoint, args, req);
    }
    patch(endpoint = '', args: object = {}, req?: Api_Client_Request): Promise<any> {
        return this.#call('patch', endpoint, args, req);
    }
    delete(endpoint = '', args: object = {}, req?: Api_Client_Request): Promise<any> {
        return this.#call('delete', endpoint, args, req);
    }

    async #call(method: Api_Method, endpoint: string, args: object | undefined, req: Api_Client_Request | undefined): Promise<any> {
        if (typeof endpoint !== 'string') throw new TypeError('The endpoint must be a string');
        if (args !== undefined && (args === null || typeof args !== 'object' || Array.isArray(args))) throw new TypeError('The arguments (second argument) must be an object');
        const info = client_request(req);
        // As over HTTP, both sides only share data: nothing of the caller's objects reaches the handler, or the other way round
        const copy = JSON.parse(JSON.stringify(args ?? {})) as Record<string, unknown>;
        const response = await this.#registry.call(this.name, method, endpoint, copy, { via: 'script', ...info });
        const body = decode_body(response);
        if (response.status >= 400) throw new Api_Error(response.status, body);
        return body;
    }
}

// Every API of every running script
export class Api_Registry {
    readonly #apis = new Map<string, Api>();
    // Called after an API appeared or went away
    on_change: () => void = () => {};

    list(): Api_Info[] {
        return [...this.#apis.values()].map((api) => ({ name: api.name, public: api.is_public })).sort((a, b) => a.name.localeCompare(b.name));
    }

    create(owner: Api_Owner, name: unknown, options: Api_Options = {}): Api {
        if (typeof name !== 'string' || !name_pattern.test(name)) {
            throw new Error('An API name is made of letters, digits, "-" and "_" (for example new API("sample"))');
        }
        if (reserved_names.has(name.toLowerCase())) throw new Error(`"${name}" is a name of the site itself`);
        const taken = this.#apis.get(name);
        if (taken) throw new Error(`The API "${name}" is already provided by the script "${taken.owner.script_name()}"`);
        const api = new Api(name, options?.public === true, owner, this);
        this.#apis.set(name, api);
        this.on_change();
        return api;
    }

    // True when the API was registered
    remove(api: Api): boolean {
        if (this.#apis.get(api.name) !== api) return false;
        this.#apis.delete(api.name);
        this.on_change();
        return true;
    }

    // Takes every API of a script down, when it stops: one change notice for all of them
    remove_all(apis: Iterable<Api>): void {
        let removed = false;
        for (const api of apis) {
            if (this.#apis.get(api.name) !== api) continue;
            this.#apis.delete(api.name);
            removed = true;
        }
        if (removed) this.on_change();
    }

    client(name: unknown): Api_Client {
        if (typeof name !== 'string') throw new TypeError('API(name): the name must be a string');
        return new Api_Client(name, this);
    }

    info(name: string): { is_public: boolean } | undefined {
        const api = this.#apis.get(name);
        return api ? { is_public: api.is_public } : undefined;
    }

    // Answers one request. Never rejects: a problem is an answer with an error status
    async call(
        name: string,
        method: string,
        path: string | string[],
        arg: Record<string, unknown>,
        meta: Pick<Api_Request, 'via' | 'ip' | 'headers' | 'query'>,
    ): Promise<Api_Response> {
        const api = this.#apis.get(name);
        if (!api) return json_response(404, { error: `The API "${name}" is not running` });
        const segments = typeof path === 'string' ? split_path(path) : path;
        const { route, params, allowed } = api.match(method.toLowerCase(), segments);
        if (!route) {
            if (allowed.length === 0) return json_response(404, { error: 'Not found' });
            return json_response(405, { error: 'Method not allowed' }, { allow: allowed.map((item) => item.toUpperCase()).sort().join(', ') });
        }

        const req: Api_Request = {
            method: route.method.toUpperCase(),
            path: segments.join('/'),
            params,
            query: meta.query,
            headers: meta.headers,
            ip: meta.ip,
            via: meta.via,
        };
        const res = new Api_Reply();
        let timer: NodeJS.Timeout | undefined;
        try {
            const timeout = new Promise<typeof timed_out>((resolve) => (timer = setTimeout(() => resolve(timed_out), handler_timeout_ms)));
            const result = await Promise.race([Promise.resolve(api.owner.run(() => route.handler({ ...arg, ...params }, req, res))), timeout]);
            if (result === timed_out) return json_response(504, { error: 'The API did not answer in time' });
            const status = Number.isInteger(res.status) && res.status >= 200 && res.status <= 599 ? res.status : 500;
            const headers = typeof res.headers === 'object' && res.headers ? lower_names(res.headers) : {};
            // Something sent with res.send() (or a redirect) is the answer, whatever the handler returned
            if (res.raw) return { status, headers, body: res.raw };
            // Bytes that were returned are a file
            if (result instanceof Uint8Array) return { status, headers: { 'content-type': 'application/octet-stream', ...headers }, body: Buffer.from(result) };
            // Nothing to say is "no content", unless the handler picked a status itself
            return json_response(result === undefined && status === 200 ? 204 : status, result, headers);
        } catch (error) {
            api.owner.report(error);
            return json_response(500, { error: 'Internal error' });
        } finally {
            if (timer) clearTimeout(timer);
        }
    }
}

function query_pairs(params: URLSearchParams): Record<string, string | string[]> {
    const query: Record<string, string | string[]> = {};
    for (const [name, value] of params) {
        const known = query[name];
        query[name] = known === undefined ? value : Array.isArray(known) ? [...known, value] : [known, value];
    }
    return query;
}

const json_error = (status: number, error: string): Api_Answer => ({ id: 0, status, headers: { 'content-type': 'application/json; charset=utf-8' }, body: Buffer.from(JSON.stringify({ error })).toString('base64') });

// The argument of a handler: the query of a GET or DELETE, the body (JSON or a form) of the others
function request_argument(call: Api_Call): Record<string, unknown> | Api_Answer {
    const method = call.method.toLowerCase();
    if (method === 'get' || method === 'delete') return call.query;
    const bytes = Buffer.from(call.body, 'base64');
    if (bytes.length > api_body_limit) return json_error(413, 'Body too large');
    const text = bytes.toString('utf8');
    if (text.trim() === '') return {};
    if ((call.headers['content-type'] ?? '').includes('application/x-www-form-urlencoded')) return query_pairs(new URLSearchParams(text));
    let body: unknown;
    try {
        body = JSON.parse(text);
    } catch {
        return json_error(400, 'The body is not valid JSON');
    }
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : json_error(400, 'The body must be a JSON object');
}

// Never rejects: a problem is an answer with an error status. Request and answer bodies are base64
export async function serve_http(registry: Api_Registry, call: Api_Call): Promise<Api_Answer> {
    const method = call.method.toLowerCase();
    if (!(api_methods as readonly string[]).includes(method)) return { ...json_error(405, 'Method not allowed'), id: call.id, headers: { 'content-type': 'application/json; charset=utf-8', allow: 'GET, POST, PUT, PATCH, DELETE' } };
    const argument = request_argument(call);
    if ('status' in argument && 'headers' in argument && typeof argument.status === 'number') return { ...(argument as Api_Answer), id: call.id };
    const result = await registry.call(call.name, method, call.path, argument, { via: 'http', ip: call.ip, headers: call.headers, query: call.query });
    // An answer travels in one frame like a request does: a bigger one would be dropped by the hub and leave the caller waiting
    if (result.body.length > api_body_limit) return { ...json_error(502, 'The answer is too large'), id: call.id };
    return { id: call.id, status: result.status, headers: result.headers, body: result.body.toString('base64') };
}
