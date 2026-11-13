import { execFileSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import type { BrowserContext } from "@playwright/test"
export const persist = ".cache/work-browser-guest-state"
export const drive_files = new Map<string, Map<string, any>>()
const accounts = new WeakMap<BrowserContext, string>()
const installed = new WeakSet<BrowserContext>()
export function sql(command: string): void {
    execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config", "wrangler.local.jsonc", "--persist-to", persist, "--command", command], { windowsHide: true, stdio: "pipe" })
}
export function reset(): void {
    sql("DELETE FROM work_messages; DELETE FROM work_rooms; DELETE FROM work_owner_keys; DELETE FROM work_key_files; DELETE FROM auth_google_grants; DELETE FROM auth_sessions; DELETE FROM auth_owner; DELETE FROM auth_users; DELETE FROM work_guests;")
    drive_files.clear()
}
export async function account(context: BrowserContext, email: string, owner = false): Promise<void> {
    const token = randomBytes(32).toString("base64url"), subject = "browser-" + createHash("sha256").update(email).digest("hex").slice(0, 24)
    const hash = createHash("sha256").update(token).digest("hex"), now = Date.now()
    sql(`INSERT OR IGNORE INTO auth_users VALUES ('${subject}', '${email}', 'Browser test', ${now}); INSERT INTO auth_sessions VALUES ('${hash}', '${subject}', ${now}, ${now}); ${owner ? `INSERT OR IGNORE INTO auth_owner VALUES (1, '${subject}');` : ""}`)
    await context.addCookies([{ name: "__Host-jazu_session", value: token, url: "https://localhost:8787/", secure: true, httpOnly: true, sameSite: "Lax" }])
    accounts.set(context, email)
    if (!drive_files.has(email)) drive_files.set(email, new Map())
    if (installed.has(context)) return
    installed.add(context)
    await context.route("**/api/v1/auth/drive", route => route.fulfill({ json: { access_token: "synthetic-drive-" + accounts.get(context) } }))
    await context.route("https://www.googleapis.com/**", async route => {
        const email = accounts.get(context)!, files = drive_files.get(email)!
        if (route.request().headers().authorization !== "Bearer synthetic-drive-" + email) throw new Error("Wrong Drive account")
        const url = new URL(route.request().url())
        if (url.pathname === "/drive/v3/files/generateIds") { await route.fulfill({ json: { ids: ["file_" + randomBytes(16).toString("hex")] } }); return }
        if (url.pathname === "/drive/v3/files") { await route.fulfill({ json: { files: [...files.keys()].map(id => ({ id })) } }); return }
        if (url.pathname.startsWith("/drive/v3/files/")) {
            const value = files.get(url.pathname.split("/").pop()!)
            await route.fulfill(value ? { json: value } : { status: 404, json: { error: { code: 404 } } }); return
        }
        if (url.pathname === "/upload/drive/v3/files") {
            const parts = route.request().postData()!.split("\r\n\r\n")
            const metadata = JSON.parse(parts[1].split("\r\n--")[0])
            const value = JSON.parse(parts[2].split("\r\n--")[0])
            if (files.has(metadata.id)) { await route.fulfill({ status: 409, json: { error: { code: 409 } } }); return }
            if (metadata.parents[0] !== "appDataFolder") throw new Error("Keys must use the hidden app data folder")
            files.set(metadata.id, value)
            await route.fulfill({ json: { id: metadata.id } }); return
        }
        throw new Error("Unexpected Google API request: " + url.pathname)
    })
}
