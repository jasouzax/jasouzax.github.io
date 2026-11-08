import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

export type seo_config = {
    description: string
    keywords: string[]
    twitter: string
    entity: "Person" | "Organization"
    short_name: string
    theme_color: string
    background_color: string
    brand: { background: string, foreground: string }
    status_bar: "default" | "black" | "black-translucent"
    lastmod: "attr" | "build" | "none"
    locales: Record<string, string>
    manifest: { display: string, orientation: string, categories: string[], shortcuts: number }
    robots: { default: string, disallow: string[], ai_bots: "allow" | "disallow" }
    security: { contact: string[], expires_months: number, policy: string, encryption: string, acknowledgments: string, hiring: string }
    llms: { summary: string, full: boolean }
}

export type site_config = {
    base_url: string
    resources: { signature: string, icon: string, favicon: string }
    pack: { exclude: string[] }
    languages: Record<string, Record<string, string>>
    default_language: string
    slots: Record<string, number>
    slot_digits: number
    default_theme: string
    themes: string[] | "all"
    font_formats: string[]
    render: { ssg: boolean, spa_json: boolean, incremental: boolean, isomorphic: boolean, ssr: boolean }
    dropdown_limit: number
    rebuild_present_monthly: boolean
    sfx: { enabled_default: boolean }
    site_name: string
    google_client_id: string
    owner: { name: string, email: string, location: string, github: string }
    deploy: { pages_project: string, worker_name: string }
    seo: seo_config
    icons: Record<string, string>
    personal_server: string
}

export const default_config: site_config = {
    base_url: "https://example.com",
    resources: { signature: "", icon: "", favicon: "" },
    pack: { exclude: [] },
    languages: { en: {}, ja: {} },
    default_language: "en",
    slots: { background_entity: 10, foreground_entity: 10 },
    slot_digits: 2,
    default_theme: "default",
    themes: "all",
    font_formats: ["colrv0", "woff2", "woff"],
    render: { ssg: true, spa_json: true, incremental: true, isomorphic: true, ssr: false },
    dropdown_limit: 10,
    rebuild_present_monthly: true,
    sfx: { enabled_default: false },
    site_name: "JAZU",
    google_client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    owner: { name: "", email: "", location: "", github: "" },
    deploy: { pages_project: "jazu", worker_name: "jazu_router" },
    icons: {},
    personal_server: "",
    seo: {
        description: "",
        keywords: [],
        twitter: "",
        entity: "Person",
        short_name: "",
        theme_color: "",
        background_color: "",
        brand: { background: "", foreground: "" },
        status_bar: "default",
        lastmod: "attr",
        locales: { en: "en_US", fr: "fr_FR", es: "es_ES", de: "de_DE", it: "it_IT", pt: "pt_BR", nl: "nl_NL", sv: "sv_SE", pl: "pl_PL", tr: "tr_TR", ru: "ru_RU", ar: "ar_AR", he: "he_IL", hi: "hi_IN", id: "id_ID", ms: "ms_MY", vi: "vi_VN", th: "th_TH", ja: "ja_JP", ko: "ko_KR", zh: "zh_CN", tl: "tl_PH", fil: "fil_PH", ceb: "ceb_PH" },
        manifest: { display: "standalone", orientation: "any", categories: [], shortcuts: 4 },
        robots: { default: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1", disallow: ["/work"], ai_bots: "allow" },
        security: { contact: [], expires_months: 11, policy: "", encryption: "", acknowledgments: "", hiring: "" },
        llms: { summary: "", full: true },
    },
}

export async function load_config(root: string): Promise<site_config> {
    const file = resolve(root, "config.json")
    if (!existsSync(file)) throw new Error("Missing config.json; see README.md")
    const given = JSON.parse(readFileSync(file, "utf8"))
    const merged: site_config = { ...default_config, ...given,
        resources: { ...default_config.resources, ...given.resources },
        pack: { ...default_config.pack, ...given.pack },
        owner: { ...default_config.owner, ...given.owner },
        deploy: { ...default_config.deploy, ...given.deploy },
        render: { ...default_config.render, ...given.render }, seo: merge_seo(given.seo) }
    if (!merged.languages || Array.isArray(merged.languages) || typeof merged.languages !== "object" || Object.values(merged.languages).some(strings => !strings || typeof strings !== "object" || Array.isArray(strings) || Object.values(strings).some(value => typeof value !== "string"))) throw new Error("languages must map language ids to string dictionaries")
    if (Object.values(merged.resources).some(value => typeof value !== "string")) throw new Error("resources must contain content-relative file paths")
    if (!Array.isArray(merged.pack.exclude) || merged.pack.exclude.some(value => typeof value !== "string" || !value)) throw new Error("pack.exclude must be an array of project-relative paths")
    merged.base_url = String(merged.base_url).trim().replace(/\/+$/, "")
    const origin = new URL(merged.base_url)
    if (origin.origin !== merged.base_url || !["https:", "http:"].includes(origin.protocol)) throw new Error("config.base_url must be an HTTP(S) origin")
    if (!Object.hasOwn(merged.languages, merged.default_language)) throw new Error("default_language must be in languages")
    if (!merged.default_theme || (merged.themes !== "all" && !merged.themes.includes(merged.default_theme))) throw new Error("default_theme must be selected in themes")
    return merged
}
// config.json may give a partial `seo` block: nested groups are merged one level deep so `seo: { robots: { disallow: [] } }` keeps the other defaults.
function merge_seo(given: Partial<seo_config> | undefined): seo_config {
    const base = default_config.seo
    if (!given) return base
    return {
        ...base, ...given,
        brand: { ...base.brand, ...given.brand },
        locales: { ...base.locales, ...given.locales },
        manifest: { ...base.manifest, ...given.manifest },
        robots: { ...base.robots, ...given.robots },
        security: { ...base.security, ...given.security },
        llms: { ...base.llms, ...given.llms },
    }
}
