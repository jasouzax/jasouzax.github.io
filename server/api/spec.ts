/* Public schemas only: credentials and implementation source never enter generated artifacts. */
import type { Api_Config, Route_Config } from "../../shared/api/types.ts"
type Spec_Route = { method: string, path: string, options: Route_Config, transport?: string }
export function api_openapi(config: Api_Config, routes: Spec_Route[]): Record<string, unknown> {
    const paths: Record<string, Record<string, unknown>> = Object.create(null)
    routes.forEach((route, index) => {
        const path = route.path.split("/").map(segment => /^[:*][a-zA-Z][a-zA-Z0-9_]*$/.test(segment) ? `{${segment.slice(1)}}` : segment).join("/")
        const parameters: unknown[] = []
        for (const match of route.path.matchAll(/(?:^|\/)([:*])([a-zA-Z][a-zA-Z0-9_]*)/g)) parameters.push({ name: match[2], in: "path", required: true, schema: (route.options.params?.properties as any)?.[match[2]] ?? { type: "string" }, ...(match[1] === "*" ? { "x-jazu-wildcard": true } : {}) })
        for (const [name, schema] of Object.entries((route.options.query?.properties ?? {}) as Record<string, unknown>)) parameters.push({ name, in: "query", required: Array.isArray(route.options.query?.required) && route.options.query.required.includes(name), schema })
        const operation = {
            operationId: `${config.id}_${config.version}_${index}`,
            parameters,
            ...(route.options.body ? { requestBody: { required: true, content: { "application/json": { schema: route.options.body } } } } : {}),
            responses: { "200": { description: "Successful response", content: { [route.transport === "sse" ? "text/event-stream" : "application/json"]: { schema: route.transport === "sse" ? { type: "string" } : { type: "object", properties: { data: route.options.response ?? {}, meta: { type: "object", properties: { request_id: { type: "string" } } } }, required: ["data", "meta"] } } } }, default: { description: "API error envelope" } },
            ...(config.access === "public" && !route.options.scopes?.length ? { security: [] } : { security: [{ ownerSession: [] }, ...(config.access === undefined || config.access === "owner" ? [] : [{ serviceToken: [] }])], "x-jazu-owner-session": true }),
            ...(route.options.scopes?.length ? { "x-jazu-scopes": route.options.scopes } : {}),
            ...(route.transport ? { "x-jazu-transport": route.transport } : {}),
            ...(config.deprecated ? { deprecated: true } : {})
        }
        const item = paths[path] ??= Object.create(null)
        item[route.method === "QUERY" ? "x-jazu-query" : route.method.toLowerCase()] = operation
    })
    return { openapi: "3.1.0", jsonSchemaDialect: "http://json-schema.org/draft-07/schema#", info: { title: config.id, version: String(config.version) }, servers: [{ url: `/api/${config.id}/v${config.version}` }], paths, components: { securitySchemes: { serviceToken: { type: "http", scheme: "bearer" }, ownerSession: { type: "apiKey", in: "cookie", name: "__Host-jazu_session", description: "Current owner session; mutations also require same-origin x-jazu-work: 1 and x-jazu-csrf" } } } }
}
function schema_type(schema: any, depth = 0): string {
    if (schema === false) return "never"
    if (!schema || typeof schema !== "object" || depth > 12 || schema.$ref) return "unknown"
    if (schema === true) return "unknown"
    if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum.map((value: unknown) => JSON.stringify(value)).join(" | ")
    if (schema.const !== undefined) return JSON.stringify(schema.const)
    for (const key of ["oneOf", "anyOf", "allOf"]) if (Array.isArray(schema[key])) return schema[key].map((part: unknown) => `(${schema_type(part, depth + 1)})`).join(key === "allOf" ? " & " : " | ") || "unknown"
    if (Array.isArray(schema.type)) return schema.type.map((type: string) => schema_type({ ...schema, type }, depth + 1)).join(" | ")
    if (schema.type === "string") return "string"
    if (["number", "integer"].includes(schema.type)) return "number"
    if (schema.type === "boolean") return "boolean"
    if (schema.type === "null") return "null"
    if (schema.type === "array") return `Array<${schema_type(schema.items, depth + 1)}>`
    if (schema.type === "object" || schema.properties) {
        const properties = Object.entries(schema.properties ?? {}).map(([name, value]) => `${JSON.stringify(name)}${schema.required?.includes(name) ? "" : "?"}: ${schema_type(value, depth + 1)}`)
        if (schema.additionalProperties !== false) properties.push(`[key: string]: unknown`)
        return `{ ${properties.join("; ")} }`
    }
    return "unknown"
}
export function api_typed_client(config: Api_Config, routes: Spec_Route[]): string {
    const entries = routes.filter(route => !route.transport || route.transport === "ticket").map(route => {
        const params = route.path.split("/").filter(segment => /^[:*][a-zA-Z][a-zA-Z0-9_]*$/.test(segment)).map(name => `${JSON.stringify(name.slice(1))}: string`).join("; ")
        return `  ${JSON.stringify(`${route.method} ${route.path}`)}: { params: ${params ? `{ ${params} }` : "Record<string, never>"}; query: ${route.options.query ? schema_type(route.options.query) : "Record<string, string | string[]>"}; body: ${schema_type(route.options.body)}; response: ${schema_type(route.options.response)} }`
    })
    return `// Generated from ${config.id} v${config.version}. No credentials are embedded.
export interface ApiRoutes {
${entries.join("\n")}
}
export class ApiClient {
  constructor(readonly origin: string, readonly token?: string) {}
  async request<K extends keyof ApiRoutes>(route: K, input: Pick<ApiRoutes[K], 'params' | 'query' | 'body'>, signal?: AbortSignal): Promise<ApiRoutes[K]['response']> {
    const split = route.indexOf(' '), method = route.slice(0, split);
    const path = route.slice(split + 1).split('/').map(segment => {
      const parameter = /^([:*])([a-zA-Z][a-zA-Z0-9_]*)$/.exec(segment);
      if (!parameter) return segment;
      const [, kind, name] = parameter;
      const value = (input.params as Record<string, string>)[name];
      if (typeof value !== 'string' || !value) throw new Error('Missing path parameter');
      const parts = kind === '*' ? value.split('/') : [value];
      if (parts.some(part => !part || part === '.' || part === '..' || /[\\\\/\\0]/.test(part))) throw new Error('Invalid path parameter');
      return parts.map(part => encodeURIComponent(part)).join('/');
    }).join('/');
    const url = new URL(${JSON.stringify(`/api/${config.id}/v${config.version}`)} + path, this.origin);
    for (const [key, value] of Object.entries(input.query as Record<string, unknown>)) for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) url.searchParams.append(key, String(item));
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.token) headers.authorization = 'Bearer ' + this.token;
    const body = ['GET', 'HEAD'].includes(method) || input.body === undefined ? undefined : JSON.stringify(input.body);
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(url, { method, headers, body, signal, redirect: 'error' });
    if (method === 'HEAD' || response.status === 204) { if (!response.ok) throw new Error('API request failed: ' + response.status); return undefined as ApiRoutes[K]['response']; }
    const result = await response.json() as { data?: unknown; error?: { message: string } };
    if (!response.ok || result.error) throw new Error(result.error?.message ?? 'API request failed: ' + response.status);
    return result.data as ApiRoutes[K]['response'];
  }
}
`
}
