/* One DNS/path namespace for projects and Work hosts. Legacy registry stays reserved through operator cutover. */
export const reserved_ids = new Set(["www", "repo", "staging", "ppl", "api", "mail", "apt", "dnf", "npm", "pypi", "registry"])

export function valid_subdomain_id(value: unknown): value is string {
    return typeof value === "string" && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value) && !value.startsWith("xn--") && !/-demo$|-server$/.test(value) && !/^v\d+$/.test(value) && !reserved_ids.has(value)
}

export function valid_demo_host(value: string): boolean {
    return value.endsWith("-demo") && value.length <= 63 && valid_subdomain_id(value.slice(0, -5))
}
