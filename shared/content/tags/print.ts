/* Authoring vocabulary for <print>. */
import type { Tag_Rule } from "../rule.ts"

export const print_rule: Tag_Rule = {
    attrs: ["name","lang","size","layout"],
    required: ["name"],
    children: ["style","font"],
}
