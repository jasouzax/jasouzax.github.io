/* Authoring vocabulary for <blog>. */
import type { Tag_Rule } from "../rule.ts"

export const blog_rule: Tag_Rule = {
    attrs: ["id","name","date","icon","info","lang","print","private","noindex"],
    required: ["id","name"],
    children: ["menu","window","blog"],
    bools: ["private", "noindex"],
}
