/* Authoring vocabulary for <blog>. */
import type { Tag_Rule } from "../rule.ts"

export const blog_rule: Tag_Rule = {
    attrs: ["id","name","date","icon","info","lang"],
    required: ["id","name"],
    children: ["menu","window"],
}
