import { defineConfig } from "@playwright/test"
import { fileURLToPath } from "node:url"
import loading from "./loading_browser.config.ts"

export default defineConfig({
    ...loading,
    use: { ...loading.use, baseURL: "http://127.0.0.1:8127" },
    webServer: {
        command: 'node --import tsx --input-type=module -e "import {serve} from \'./src/node/serve.ts\'; serve(\'dist\',8127)"',
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        url: "http://127.0.0.1:8127/",
        reuseExistingServer: !process.env.CI,
    },
    testMatch: "rireki_browser.spec.ts",
    outputDir: "../.cache/rireki-browser-results",
})
