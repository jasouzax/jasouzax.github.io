import { defineConfig } from "@playwright/test"
import { fileURLToPath } from "node:url"

export default defineConfig({
    testDir: ".", testMatch: "loading_browser.spec.ts", timeout: 30000,
    workers: 1,
    use: { baseURL: "http://127.0.0.1:8125", viewport: { width: 1440, height: 1000 } },
    webServer: {
        command: 'node --import tsx --input-type=module -e "import {serve} from \'./src/node/serve.ts\'; serve(\'dist\',8125)"',
        cwd: fileURLToPath(new URL("../", import.meta.url)), url: "http://127.0.0.1:8125/", reuseExistingServer: !process.env.CI
    },
    outputDir: "../.cache/loading-browser-results", reporter: "line"
})
