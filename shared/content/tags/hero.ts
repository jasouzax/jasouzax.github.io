/* Authoring vocabulary for <hero>. */
import type { Tag_Rule } from "../rule.ts"

export const hero_rule: Tag_Rule = {
    attrs: ["status","name","tab","tags","info","profile"],
    required: [],
    children: ["item","action"],
}
