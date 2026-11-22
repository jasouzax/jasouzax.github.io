/* Authoring vocabulary for <event>. */
import type { Tag_Rule } from "../rule.ts"

export const event_rule: Tag_Rule = {
    attrs: ["path","lang","name","info","rank","featured","date","icon","skill","image","noindex","menu","short","note","role","sub","media","poster","alt","stack","tags","featured_stack","website","paper","event","source","keywords","canonical","robots","lastmod","cover","print","id","type","lang","resume"],
    required: ["id","name","date"],
    children: ["event"],
    bools: ["featured"],
}
