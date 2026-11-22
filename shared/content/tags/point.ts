/* Authoring vocabulary for <point>. */
import type { Tag_Rule } from "../rule.ts"

export const point_rule: Tag_Rule = {
    attrs: ["name"],
    required: ["name"],
    children: ["point"],
}
