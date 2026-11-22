/* Authoring vocabulary for <case>. */
import type { Tag_Rule } from "../rule.ts"

export const case_rule: Tag_Rule = {
    attrs: ["file","error","view","edit","mime","url","host","script","child_file","child_view","child_edit","child_mime","child_url"],
    required: [],
    children: [],
    bools: ["file","error","view","edit","child_file","child_view","child_edit"],
}
