import { defineConfig } from "@playwright/test"
import { fileURLToPath } from "node:url"
const cwd = fileURLToPath(new URL("../", import.meta.url))
export default defineConfig({
    testDir: ".", testMatch: ["work_browser.spec.ts", "auth_browser.spec.ts"], timeout: 180000, workers: 1,
    use: { baseURL: "http://localhost:8787", viewport: { width: 1280, height: 900 }, actionTimeout: 10000, navigationTimeout: 30000 },
    webServer: [
        { command: "node --import tsx -e \"import { serve } from './src/node/serve.ts'; import { resolve } from 'node:path'; serve(resolve('dist'), 8080)\"", cwd, url: "http://127.0.0.1:8080/work", reuseExistingServer: !process.env.CI, timeout: 30000 },
        { command: "node node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --local --config wrangler.local.jsonc --persist-to .cache/work-browser-guest-state && node node_modules/wrangler/bin/wrangler.js dev --local --config wrangler.local.jsonc --persist-to .cache/work-browser-guest-state --ip 127.0.0.1 --port 8787 --var GOOGLE_CLIENT_ID:browser-test.apps.googleusercontent.com --var GOOGLE_CLIENT_SECRET:browser-test-secret --var GOOGLE_ADMIN_EMAIL:jason@jasouza.com --var WORK_FALLBACK_KEY:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", cwd, url: "http://127.0.0.1:8787/api/v1/health", reuseExistingServer: false, timeout: 240000 },
    ],
    outputDir: "../.cache/work-browser-results", reporter: "line",
})
