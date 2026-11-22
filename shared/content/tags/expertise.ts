/* Authoring vocabulary for <expertise>. */
import type { Tag_Rule } from "../rule.ts"

export const expertise_rule: Tag_Rule = {
    attrs: ["tab","icon","name","info","featured_chips"],
    required: [],
    children: ["skill","stack"],
}
