/* Generate static-host response headers and the website content security policy. */
import { jsx, fragment } from "../../shared/vnode/vnode.tsx"

export function headers_file(inline_hashes: string[], style_hashes: string[] = [], base_url = ""): string {
    const script_hashes = inline_hashes.map((hash) => `'sha256-${hash}'`).join(" ")
    const repository = base_url ? `https://repo.${new URL(base_url).hostname}` : ""
    const websocket = base_url ? new URL(base_url).origin.replace(/^http/, "ws") : ""
    const csp = [
        "default-src 'self'",
        `script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' ${script_hashes}`.trim(),
        `style-src 'self' ${style_hashes.map(hash => `'sha256-${hash}'`).join(" ")}`.trim(),
        "style-src-attr 'unsafe-inline'",
        // Any page can enter the desktop through the SPA. xterm generates
        // dimension/theme style elements when a terminal is opened there.
        "style-src-elem 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https://*.googleusercontent.com",
        "font-src 'self'",
        "media-src 'self' blob:",
        `connect-src 'self' ${websocket} ${repository} https://*.googleapis.com https://accounts.google.com`.replace(/ +/g, " "),
        "frame-src 'self' blob: https://accounts.google.com",
        "frame-ancestors 'none'"
    ].join("; ")
    const text = (path: string, type: string, age: number): string[] => [
        path,
        `  Content-Type: ${type}`,
        `  Cache-Control: public, max-age=${age}`
    ]
    return [
        "/*",
        "  X-Content-Type-Options: nosniff",
        "  Referrer-Policy: strict-origin-when-cross-origin",
        "  Strict-Transport-Security: max-age=31536000; includeSubDomains",
        // Isolation belongs to the document, so enable it before an SPA visit
        // to the desktop instead of requiring a new document at /desk.
        "  Cross-Origin-Opener-Policy: same-origin",
        "  Cross-Origin-Embedder-Policy: require-corp",
        `  Content-Security-Policy: ${csp}`,
        "/work",
        "  Referrer-Policy: no-referrer",
        "  X-Robots-Tag: noindex",
        "  Cache-Control: no-store",
        "/work/*",
        "  Referrer-Policy: no-referrer",
        "  X-Robots-Tag: noindex",
        "  Cache-Control: no-store",
        "/assets/*",
        "  Cache-Control: public, max-age=31536000, immutable",
        "/assets/wasm/manifest.json",
        "  Cache-Control: no-cache",
        "/assets/pdfjs.json",
        "  Cache-Control: no-cache",
        "/assets/plugins.json",
        "  Cache-Control: no-cache",
        ...text("/manifest.json", "application/manifest+json; charset=utf-8", 3600),
        ...text("/service-worker.js", "text/javascript; charset=utf-8", 0),
        ...text("/offline.json", "application/json; charset=utf-8", 0),
        ...text("/robots.txt", "text/plain; charset=utf-8", 3600),
        ...text("/sitemap.xml", "application/xml; charset=utf-8", 3600),
        ...text("/llms.txt", "text/plain; charset=utf-8", 3600),
        ...text("/llms-full.txt", "text/plain; charset=utf-8", 3600),
        ...text("/security.txt", "text/plain; charset=utf-8", 86400),
        ...text("/.well-known/security.txt", "text/plain; charset=utf-8", 86400),
        // generated icons keep one URL, so they are cached for a day; covers carry ?v=<hash> in og:image, so a week is safe
        "/favicon.ico",
        "  Cache-Control: public, max-age=86400",
        "/icon.svg",
        "  Cache-Control: public, max-age=86400",
        "/apple-touch-icon.png",
        "  Cache-Control: public, max-age=86400",
        "/icons/*",
        "  Cache-Control: public, max-age=604800",
        "/og/*",
        "  Cache-Control: public, max-age=604800",
        ""
    ].join("\n")
}
