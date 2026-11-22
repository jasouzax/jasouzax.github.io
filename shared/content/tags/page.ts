/* Authoring vocabulary for <page>. */
import type { Tag_Rule } from "../rule.ts"

export const page_rule: Tag_Rule = {
    attrs: ["path","lang","name","info","rank","featured","date","icon","skill","image","noindex","menu","short","note","role","sub","media","poster","alt","stack","tags","featured_stack","website","paper","event","source","keywords","canonical","robots","lastmod","cover","print"],
    required: ["path","name"],
    children: ["hero","expertise","desk","style"],
    bools: ["featured","noindex","menu"],
}
