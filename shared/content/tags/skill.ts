/* Authoring vocabulary for <skill>. */
import type { Tag_Rule } from "../rule.ts"

export const skill_rule: Tag_Rule = {
    attrs: ["id","name","icon","group"],
    required: ["name"],
    children: [],
}
