/* Authoring vocabulary for <pipeline>. */
import type { Tag_Rule } from "../rule.ts"

export const pipeline_rule: Tag_Rule = {
    attrs: ["branch","poll_seconds"],
    required: [],
    children: ["step"],
}
