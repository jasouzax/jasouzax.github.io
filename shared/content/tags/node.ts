/* Authoring vocabulary for <node>. */
import type { Tag_Rule } from "../rule.ts"

export const node_rule: Tag_Rule = {
    attrs: ["id","name","icon","info","link","x","y"],
    required: ["id"],
    children: ["node"],
}
