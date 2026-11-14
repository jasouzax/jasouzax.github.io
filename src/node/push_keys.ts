/* One-time local VAPID provisioning. Never emit private key material or replace an existing pair. */
import { generateKeyPairSync } from "node:crypto"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
export function provision_push_keys(path = resolve(".env"), email = ""): boolean {
    let text = existsSync(path) ? readFileSync(path, "utf8") : ""
    const configured = (name: string) => text.split(/\r?\n/).find(line => new RegExp(`^${name}\\s*=\\s*.+`).test(line))?.split("=").slice(1).join("=").trim()
    if (configured("VAPID_PUBLIC_KEY") && configured("VAPID_PRIVATE_KEY")) return false
    if (configured("VAPID_PUBLIC_KEY") || configured("VAPID_PRIVATE_KEY")) throw new Error("Incomplete VAPID pair; restore the matching key instead of replacing it")
    const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" }), public_key = pair.publicKey.export({ format: "jwk" }), private_key = pair.privateKey.export({ format: "jwk" })
    const values = { VAPID_PUBLIC_KEY: Buffer.concat([Buffer.from([4]), Buffer.from(public_key.x!, "base64url"), Buffer.from(public_key.y!, "base64url")]).toString("base64url"), VAPID_PRIVATE_KEY: private_key.d!, VAPID_SUBJECT: `mailto:${email}` }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Provide the website owner's contact email")
    for (const [key, value] of Object.entries(values)) {
        if (key === "VAPID_SUBJECT" && configured(key)) continue
        const pattern = new RegExp(`^${key}=.*$`, "m")
        text = pattern.test(text) ? text.replace(pattern, `${key}=${value}`) : text.replace(/\s*$/, "\n") + `${key}=${value}\n`
    }
    writeFileSync(path, text, { mode: 0o600 })
    return true
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    const config = JSON.parse(readFileSync(resolve("config.json"), "utf8"))
    console.log(provision_push_keys(resolve(".env"), config.owner.email) ? "Generated persistent Web Push signing keys in .env; no existing credentials changed." : "Existing Web Push signing pair preserved.")
}
