/* Authoring vocabulary for <desk>. */
import type { Tag_Rule } from "../rule.ts"

export const desk_rule: Tag_Rule = {
    attrs: ["icon","name","date","info","auto"],
    required: [],
    children: ["menu","window"],
    bools: ["auto","server"],
}
