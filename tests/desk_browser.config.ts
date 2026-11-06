import { defineConfig } from "@playwright/test"
import { fileURLToPath } from "node:url"
export default defineConfig({
    testDir: ".", testMatch: ["desk_browser.spec.ts", "desk_folder_interactions.spec.ts", "desk_shortcuts.spec.ts", "desk_programs.spec.ts"], timeout: 60000,
    use: { baseURL: "http://127.0.0.1:8124", viewport: { width: 1440, height: 1000 } },
    webServer: { command: "node src/main.ts serve --port 8124", cwd: fileURLToPath(new URL("../", import.meta.url)), url: "http://127.0.0.1:8124/desk", reuseExistingServer: !process.env.CI, timeout: 120000 },
    outputDir: "../.cache/desk-browser-results",
    reporter: "line",
})
