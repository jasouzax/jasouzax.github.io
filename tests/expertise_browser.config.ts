import { defineConfig } from "@playwright/test"
import loading from "./loading_browser.config.ts"

export default defineConfig({
    ...loading,
    testMatch: "expertise_browser.spec.ts",
    outputDir: "../.cache/expertise-browser-results",
})
