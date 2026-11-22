/* Authoring vocabulary for <project>. */
import type { Tag_Rule } from "../rule.ts"

export const project_rule: Tag_Rule = {
    attrs: ["path","lang","name","rank","featured","date","icon","image","noindex","menu","short","note","role","sub","media","poster","alt","tags","website","paper","event","source","keywords","canonical","robots","lastmod","cover","print","id","repo","private","lang"],
    required: ["id","name","date"],
    children: ["slide","menu","window","action","research","pipeline"],
    bools: ["featured","private"],
}
