/* Authoring vocabulary for <palette>. */
import type { Tag_Rule } from "../rule.ts"

export const palette_rule: Tag_Rule = {
    attrs: ["mode","colors"],
    required: ["mode","colors"],
    children: [],
}
