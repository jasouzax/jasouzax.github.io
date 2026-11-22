/* Authoring vocabulary for <project>. */
import type { Tag_Rule } from "../rule.ts"

export const project_rule: Tag_Rule = {
    attrs: ["id", "name", "date", "short", "sub", "note", "role", "rank", "icon", "featured", "collaborators", "private", "confidental", "repo", "website", "source", "paper", "event", "lang", "image", "cover", "keywords", "canonical", "robots", "lastmod", "noindex", "print"],
    required: ["id","name","date"],
    children: ["slide","menu","window","action","research","pipeline"],
    bools: ["featured", "private", "confidental", "noindex"],
}
