/* Authoring vocabulary for <step>. */
import type { Tag_Rule } from "../rule.ts"

export const step_rule: Tag_Rule = {
    attrs: ["name","phase","command","args","timeout_seconds","credentials","continue"],
    required: ["name"],
    children: ["step"],
    bools: ["continue"],
}
