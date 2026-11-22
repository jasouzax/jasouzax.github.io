/* Authoring vocabulary for <hero>. */
import type { Tag_Rule } from "../rule.ts"

export const hero_rule: Tag_Rule = {
    attrs: ["name","tab","tags","info"],
    required: [],
    children: ["item","action"],
}
