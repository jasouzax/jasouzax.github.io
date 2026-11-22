/* Authoring vocabulary for <page>. */
import type { Tag_Rule } from "../rule.ts"

export const page_rule: Tag_Rule = {
    attrs: ["path", "name", "icon", "rank", "info", "lang", "noindex", "menu", "print", "image", "cover", "keywords", "canonical", "robots", "lastmod"],
    required: ["path","name"],
    children: ["hero","expertise","desk","style"],
    bools: ["noindex", "menu"],
}
