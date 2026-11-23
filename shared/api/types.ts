/* JSON-only contracts between the edge gateway, Node supervisor and one API child process. */
export type Api_Method = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "QUERY"
export type Api_Config = { id: string, version: number, access?: "public" | "owner" | "token", tokens?: { hash: string, scopes: string[], unlimited?: boolean }[], rate?: { requests: number, seconds: number }, response?: boolean | "log" | "strict", deprecated?: string, secrets?: string[], timeout_ms?: number }
export type Route_Config = { scopes?: string[], body?: Record<string, unknown>, query?: Record<string, unknown>, params?: Record<string, unknown>, response?: Record<string, unknown> }
export type Api_Manifest = { id: string, version: number, access: "public" | "owner" | "token", deprecated?: string, routes: { method: Api_Method, path: string }[] }
export type Api_Call = { method: string, path: string, query: Record<string, string | string[]>, headers: Record<string, string>, body?: unknown, actor: { owner: boolean, subject?: string }, ip: string, request_id: string }
export type Api_Result = { status: number, headers: Record<string, string>, body: unknown }
export const api_limit = 512 * 1024
export const api_methods: Api_Method[] = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "QUERY"]
export function api_failure(code: string, message: string, status: number, request_id = ""): Api_Result { return { status, headers: { "cache-control": "no-store" }, body: { error: { code, message }, meta: { request_id } } } }
