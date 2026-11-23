/* A public, script-free fallback for online-only desks. The requested URL stays intact so Retry can revisit it. */
export function offline_html(): string {
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Connection required | JAZU</title></head><body><main><h1>Connection required</h1><p role="status">This workspace needs an internet connection. Your files and account data have not been loaded.</p><nav aria-label="Offline navigation"><p><a href="">Try again</a></p><p><a href="/">Browse the offline website</a></p></nav></main></body></html>'
}
