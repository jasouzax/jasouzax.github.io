/* A scene owns a sequential media segment and a nested section of a readable blog. */
import type { Tag_Rule } from "../rule.ts"

export const scene_rule: Tag_Rule = {
    attrs: ["name", "duration", "script", "image", "audio", "background", "color"],
    required: ["name"], children: ["scene", "window"],
}
