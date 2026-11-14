import { defineConfig } from "@playwright/test"
import { fileURLToPath } from "node:url"
export default defineConfig({
    testDir: ".", testMatch: "pwa_browser.spec.ts", timeout: 180000, workers: 1,
    use: { baseURL: "http://127.0.0.1:8126", viewport: { width: 1280, height: 900 } },
    webServer: { command: "node --import tsx --input-type=module -e \"import {serve} from './src/node/serve.ts'; serve('dist',8126)\"", cwd: fileURLToPath(new URL("../", import.meta.url)), url: "http://127.0.0.1:8126/", reuseExistingServer: !process.env.CI },
    outputDir: "../.cache/pwa-browser-results", reporter: "line"
})
