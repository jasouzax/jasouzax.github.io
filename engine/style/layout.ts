import postcss from "postcss"

// The legacy sheet contains both geometry and Default's paint. Split after Sass
// expands the content-dependent expertise selectors, so the inline layout stays
// in sync with the actual content rather than a second handwritten approximation.
const geometry = /^(?:display|position|inset(?:-.+)?|top|right|bottom|left|float|clear|z-index|isolation|box-sizing|(?:min-|max-)?(?:width|height|inline-size|block-size)|margin(?:-.+)?|padding(?:-.+)?|flex(?:-.+)?|grid(?:-.+)?|gap|row-gap|column-gap|align-.+|justify-.+|place-.+|order|overflow(?:-.+)?|overscroll-behavior(?:-.+)?|scroll-(?:snap-.+|padding(?:-.+)?|margin(?:-.+)?)|columns|column-(?:count|width|span|fill)|aspect-ratio|object-(?:fit|position)|contain|container(?:-.+)?|content-visibility|visibility|table-layout|border-collapse|border-spacing|font(?:-.+)?|line-height|letter-spacing|word-spacing|white-space|text-(?:align|indent|overflow|size-adjust|wrap)|word-break|overflow-wrap|hyphens|line-break|vertical-align|direction|writing-mode|list-style(?:-.+)?|content|transform(?:-origin)?|translate|rotate|scale|border(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?-(?:width|style))$/

function prune(root: postcss.Root): void {
    root.walkComments(comment => { comment.remove() })
    let changed = true
    while (changed) {
        changed = false
        root.walk(node => {
            if ((node.type === "rule" || node.type === "atrule") && node.nodes?.length === 0) {
                node.remove()
                changed = true
            }
        })
    }
}

export function split_layout_css(css: string): { layout: string; skin: string } {
    const layout = postcss.parse(css), skin = layout.clone()
    const needed = new Set<string>()
    const collect = (value: string): void => {
        for (const match of value.matchAll(/var\(\s*(--[\w-]+)/g)) needed.add(match[1])
    }
    layout.walkDecls(decl => {
        if (!decl.prop.startsWith("--") && geometry.test(decl.prop)) collect(decl.value)
    })
    // Resolve layout-variable dependencies, but leave the palette to each skin.
    let size = -1
    while (size !== needed.size) {
        size = needed.size
        layout.walkDecls(decl => { if (needed.has(decl.prop)) collect(decl.value) })
    }
    const keep = (decl: postcss.Declaration): boolean => geometry.test(decl.prop) || needed.has(decl.prop)
    layout.walkAtRules(rule => {
        if (/keyframes$/.test(rule.name) || ["font-face", "charset", "property"].includes(rule.name)) rule.remove()
    })
    skin.walkDecls(decl => {
        let parent = decl.parent
        while (parent && parent.type !== "root") {
            if (parent.type === "atrule" && (/keyframes$/.test(parent.name) || ["font-face", "property"].includes(parent.name))) return
            parent = parent.parent
        }
        if (keep(decl)) decl.remove()
    })
    layout.walkDecls(decl => {
        if (keep(decl)) return
        // A transparent border reserves the same space before the skin arrives.
        if (/^border(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?$/.test(decl.prop)) {
            const width = postcss.list.space(decl.value).find(part => /^(?:0|thin|medium|thick|[\d.]+(?:px|em|rem))$/.test(part))
            if (width) {
                decl.cloneBefore({ prop: `${decl.prop}-width`, value: width })
                decl.cloneBefore({ prop: `${decl.prop}-style`, value: "solid" })
                decl.cloneBefore({ prop: `${decl.prop}-color`, value: "transparent" })
            }
        }
        decl.remove()
    })
    prune(layout)
    prune(skin)
    return { layout: layout.toString(), skin: skin.toString() }
}
