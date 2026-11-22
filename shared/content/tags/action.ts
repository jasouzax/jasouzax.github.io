/* Authoring vocabulary for <action>. */
import type { Tag_Rule } from "../rule.ts"

export const action_rule: Tag_Rule = {
    attrs: ["icon","text","link","primary"],
    required: ["text","link"],
    children: [],
    bools: ["primary"],
}
