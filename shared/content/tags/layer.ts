/* Authoring vocabulary for <layer>. */
import type { Tag_Rule } from "../rule.ts"

export const layer_rule: Tag_Rule = {
    attrs: ["path","color","paint"],
    required: ["path"],
    children: [],
}
