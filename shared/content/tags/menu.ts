/* Authoring vocabulary for <menu>. */
import type { Tag_Rule } from "../rule.ts"

export const menu_rule: Tag_Rule = {
    attrs: ["name","icon","path"],
    required: [],
    children: ["entry","foot","map"],
}
