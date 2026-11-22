/* Authoring vocabulary for <map>. */
import type { Tag_Rule } from "../rule.ts"

export const map_rule: Tag_Rule = {
    attrs: ["layout"],
    required: [],
    children: ["node","edge"],
}
