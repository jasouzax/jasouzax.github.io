/* Authoring vocabulary for <font>. */
import type { Tag_Rule } from "../rule.ts"

export const font_rule: Tag_Rule = {
    attrs: ["name","author","size","role","src","weight"],
    required: ["name"],
    children: ["palette","sym"],
}
