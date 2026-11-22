/* Authoring vocabulary for <entry>. */
import type { Tag_Rule } from "../rule.ts"

export const entry_rule: Tag_Rule = {
    attrs: ["id","type","name","from","data","info","icon","date","acts","image","open","link"],
    required: [],
    children: ["entry"],
    bools: ["open"],
}
