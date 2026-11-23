/* Reuse the real desk server with a focused media-export suite. */
import { defineConfig } from "@playwright/test"
import desk from "./desk_browser.config.ts"
export default defineConfig({ ...desk, testMatch: ["blog_media.spec.ts"], timeout: 150000, workers: 1 })
