/* Authoring vocabulary for <window>. */
import type { Tag_Rule } from "../rule.ts"

export const window_rule: Tag_Rule = {
    attrs: ["icon","type","view","edit","split","path","full","data","save","flow"],
    required: [],
    children: [],
    bools: ["view","edit","full","save","flow"],
}
