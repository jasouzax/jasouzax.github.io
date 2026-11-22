/* Authoring vocabulary for <window>. */
import type { Tag_Rule } from "../rule.ts"

export const window_rule: Tag_Rule = {
    attrs: ["icon","type","mode","path","full","data","save","flow"],
    required: [],
    children: [],
    bools: ["full","save","flow"],
}
