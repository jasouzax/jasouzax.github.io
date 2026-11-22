/* Authoring vocabulary for <sym>. */
import type { Tag_Rule } from "../rule.ts"

export const sym_rule: Tag_Rule = {
    attrs: ["char","name","path","img","width","variant"],
    required: ["char"],
    children: ["layer"],
}
