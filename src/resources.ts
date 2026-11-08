import { existsSync, realpathSync, statSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type { site_model } from "./model.ts"
import { inside } from "./paths.ts"

// Leading slashes address the content root; other XML paths address the declaring file.
export function content_file(content_dir: string, reference: string, origin?: string): string | null {
    if (!reference || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) return null
    const file = resolve(reference.startsWith("/") || !origin ? content_dir : dirname(origin), reference.replace(/^\/+/, ""))
    if (!inside(content_dir, file) || !existsSync(file) || !statSync(file).isFile()) return null
    if (!inside(realpathSync(content_dir), realpathSync(file))) return null
    return file
}

export function configured_resource(model: site_model, name: keyof site_model["config"]["resources"]): string | null {
    return content_file(model.content_dir, model.config.resources[name])
}

export function published_resource(model: site_model, reference: string): string | null {
    return model.resources.get(reference.replace(/^file:\/\//, "")) ?? null
}
