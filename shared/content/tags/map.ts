/* Authoring vocabulary for <map>. */
import type { Tag_Rule } from "../rule.ts"

export const map_rule: Tag_Rule = {
    attrs: ["layout"],
    required: [],
    children: ["node","edge"],
}

export function map_image_icon(value: string | undefined): boolean {
    return Boolean(value && (/^https?:\/\//i.test(value) || (!value.includes(":") && /\.(?:svg|png|jpe?g|webp|gif|avif)(?:[?#]|$)/i.test(value))))
}
