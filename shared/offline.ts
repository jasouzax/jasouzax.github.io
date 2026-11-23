/* Online-only route matching shared by snapshot generation and the installed service worker. */
export function online_route(path: string, prefixes: string[]): boolean {
    return prefixes.some(prefix => path === prefix || path.startsWith(`${prefix}/`) || path === `${prefix}.html`)
}
