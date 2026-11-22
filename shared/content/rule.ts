/* One tag vocabulary; shared validation does not depend on the engine. */
export type Tag_Rule = { attrs: string[], required: string[], children: string[], bools?: string[] }
