/* Authoring vocabulary for <slide>. */
import type { Tag_Rule } from "../rule.ts"

export const slide_rule: Tag_Rule = {
    attrs: ["media","poster","alt","info","skill","stack","featured_stack","hashtags","tags","featured"],
    required: ["skill"],
    children: [],
    bools: ["featured"],
}
