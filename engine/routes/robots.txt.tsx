/* Generate crawler policy from configured site and indexing rules. */
import { jsx, fragment } from "../../shared/vnode/vnode.tsx"
import type { site_model } from "../load/model.ts"

export function robots_txt(model: site_model): string {
    const robots = model.config.seo.robots
    const rules = ["User-agent: *", "Allow: /", ...robots.disallow.map((path) => `Disallow: ${path}`)]
    const groups = [rules.join("\n")]
    if (robots.ai_bots === "disallow") groups.push(...ai_bots.map((bot) => `User-agent: ${bot}\nDisallow: /`))
    groups.push(`Sitemap: ${model.config.base_url}/sitemap.xml`)
    return groups.join("\n\n") + "\n"
}

const ai_bots = [
    "GPTBot",
    "ChatGPT-User",
    "OAI-SearchBot",
    "ClaudeBot",
    "Claude-Web",
    "anthropic-ai",
    "Google-Extended",
    "Applebot-Extended",
    "PerplexityBot",
    "CCBot",
    "Bytespider",
    "Amazonbot",
    "cohere-ai",
    "Meta-ExternalAgent",
    "FacebookBot",
    "Diffbot",
    "ImagesiftBot",
    "omgili",
    "Timpibot"
]
