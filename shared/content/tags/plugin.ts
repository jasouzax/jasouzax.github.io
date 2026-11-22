/* Authoring vocabulary for <plugin>. */
import type { Tag_Rule } from "../rule.ts"

export const plugin_rule: Tag_Rule = {
    attrs: ["id","name","icon","version","mime","path","mode","from","to","flow","wasm","sha256","script","options"],
    required: ["id","version"],
    children: ["case"],
}
