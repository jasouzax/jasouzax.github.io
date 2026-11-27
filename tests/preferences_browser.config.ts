import { defineConfig } from "@playwright/test"
import { fileURLToPath } from "node:url"
export default defineConfig({
    testDir: ".", testMatch: "media_preferences.spec.ts", timeout: 60000, workers: 1,
    use: { baseURL: "http://127.0.0.1:8126", viewport: { width: 1200, height: 900 } },
    webServer: {
        command: 'node --import tsx --input-type=module -e "import {serve} from \'./src/step/serve_http.ts\'; serve(\'dist\',8126)"',
        cwd: fileURLToPath(new URL("../", import.meta.url)), url: "http://127.0.0.1:8126/desk", reuseExistingServer: !process.env.CI,
    },
    outputDir: "../.cache/preferences-browser-results", reporter: "line",
})
