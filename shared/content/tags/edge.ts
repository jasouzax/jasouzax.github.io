/* Authoring vocabulary for <edge>. */
import type { Tag_Rule } from "../rule.ts"

export const edge_rule: Tag_Rule = {
    attrs: ["from","to","text"],
    required: ["from","to"],
    children: [],
}
