/* Generate canonical static-host redirects. */
import { jsx, fragment } from "../../shared/vnode/vnode.tsx"

export function redirects_file(): string {
    return [
        "/work/*   /work/index.html   200",
        "/blog     /blogs             301",
        "/blog/*   /blogs/:splat      301",
        "/ja/blog     /ja/blogs             301",
        "/ja/blog/*   /ja/blogs/:splat      301",
        ""
    ].join("\n")
}
