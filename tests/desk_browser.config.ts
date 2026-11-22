import { defineConfig } from "@playwright/test"
import { fileURLToPath } from "node:url"
export default defineConfig({
    testDir: ".", testMatch: ["desk_save.spec.ts", "desk_map.spec.ts", "desk_split.spec.ts", "desk_browser.spec.ts", "desk_folder_interactions.spec.ts", "desk_shortcuts.spec.ts", "desk_programs.spec.ts", "desk_fsa.spec.ts", "server_desk.spec.ts"], timeout: 60000,
    use: { baseURL: "http://127.0.0.1:8124", viewport: { width: 1440, height: 1000 }, channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL },
    webServer: { command: "node src/main.ts serve --port 8124", cwd: fileURLToPath(new URL("../", import.meta.url)), url: "http://127.0.0.1:8124/desk", reuseExistingServer: !process.env.CI, timeout: 120000 },
    outputDir: "../.cache/desk-browser-results",
    reporter: "line",
})
