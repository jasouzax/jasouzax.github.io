/* Authoring vocabulary for <research>. */
import type { Tag_Rule } from "../rule.ts"

export const research_rule: Tag_Rule = {
    attrs: [],
    required: [],
    children: ["terminology","problem","solution","significance","objectives","similar","frameworks","methodology","results"],
}
