/* Authoring vocabulary for <theme>. */
import type { Tag_Rule } from "../rule.ts"

export const theme_rule: Tag_Rule = {
    attrs: ["name","label","icon","color","js","background","preload"],
    required: [],
    children: ["font","style"],
}
