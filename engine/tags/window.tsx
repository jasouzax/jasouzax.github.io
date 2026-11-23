/* Render window chrome and initial document bodies as virtual nodes. */
import { markdown_nodes } from "../../shared/markdown.ts"
import { parse_notebook, notebook_mime } from "../../shared/notebook.ts"
import { notebook_cell_content } from "../../shared/notebook/render.tsx"
import { window_video } from "./window/video.tsx"
import { window_svg_edit } from "./window/svg_edit.tsx"
import { jsx, fragment, type child, type attributes } from "../../shared/vnode/vnode.tsx"
import { resource_text } from "../load/resources.ts"
import type { xml_node } from "../../shared/content/xml.ts"
import { child_nodes } from "../../shared/content/xml.ts"
import type { html } from "../../shared/util.ts"
import type { render_ctx } from "./page/context.tsx"
import { t, glyph, text_of, icon } from "./page/context.tsx"
import { is_true } from "../../shared/content/schema.ts"
import { mime_from_name, mime_info_of, mime_siblings } from "../../shared/mime.ts"

export type window_info = { index: number; label: string; icon: string; node: xml_node }

export function read_source(ctx: render_ctx, path: string): string | null {
    return resource_text(ctx.model, path)
}

export function base_name(path: string): string {
    return (
        path
            .split("/")
            .filter((part) => part.length > 0)
            .pop() ?? path
    )
}

export function window_infos(ctx: render_ctx, desk: xml_node): window_info[] {
    const nodes: xml_node[] = []
    const visit = (parent: xml_node): void => {
        for (const child of parent.children) {
            if (child.tag === "window") nodes.push(child)
            else if (child.tag === "scene") visit(child)
        }
    }
    visit(desk)
    return nodes.map((original, index) => {
        const target = original.attrs.split ? original.parent?.children.filter(child => child.tag === "window")[Number(original.attrs.split) - 1] : undefined
        const node = target ? { ...original, attrs: { ...original.attrs, split: String(nodes.indexOf(target) + 1) } } : original
        const mime = node.attrs.type ?? (node.attrs.path ? mime_from_name(node.attrs.path) : "")
        const label =
            node.attrs.path && !/^(window|shell|pid):/.test(node.attrs.path)
                ? base_name(node.attrs.path)
                : mime || t(ctx, "new_window")
        const icon = node.attrs.icon ?? mime_info_of(mime)?.icon ?? "[file]"
        return { index, label, icon, node }
    })
}

export function list_item(
    ctx: render_ctx,
    icon_value: string,
    label: string,
    current = false,
    data: attributes = {}
): child {
    return (
        <li class="list_drop_li">
            <button type="button" aria-current={current ? "true" : undefined} {...data}>
                {glyph(ctx, icon_value, "list_drop_icon")}
                {label}
            </button>
        </li>
    )
}

// `end` makes it a `list end`: the drop is anchored on the summary's right edge and grows to the left (for the lists at the right of the head)
export function head_list(
    ctx: render_ctx,
    class_name: string,
    title: string,
    summary: string,
    items: html[],
    search_label?: string,
    end: boolean = false
): html {
    const search = search_label ? (
        <>
            <li class={"list_drop_search"} role={"search"}>
                <label>
                    {glyph(ctx, "[search]")}
                    <input
                        type={"search"}
                        placeholder={search_label}
                        aria-label={search_label}
                        autocomplete={"off"}
                        spellcheck={"false"}
                    />
                </label>
            </li>
        </>
    ) : (
        ""
    )
    return (
        <>
            <details class={`list${end ? " end" : ""} ${class_name}`} name={"droplist"}>
                <summary class={"list_summ"} title={title}>
                    {summary}
                </summary>
                <ul class={"list_drop"}>
                    {search}
                    {items}
                </ul>
            </details>
        </>
    )
}

export function tool_list(
    ctx: render_ctx,
    class_name: string,
    title: string,
    icon_value: string,
    items: html[]
): html {
    return (
        <>
            <details class={`list end ${class_name}`} name={"droplist"}>
                <summary class={"list_summ desk_wbox_head_tool"} title={title} aria-label={title}>
                    {text_of(ctx, icon_value)}
                </summary>
                <ul class={"list_drop"}>{items}</ul>
            </details>
        </>
    )
}

// a plain button of the head (save, split); the save one starts disabled, the viewer enables it while the window has a change to keep
export function head_button(
    ctx: render_ctx,
    class_name: string,
    title: string,
    icon_value: string,
    disabled: boolean
): html {
    return (
        <>
            <button
                class={`desk_wbox_head_tool ${class_name}`}
                type={"button"}
                title={title}
                aria-label={title}
                disabled={disabled}
            >
                {glyph(ctx, icon_value)}
            </button>
        </>
    )
}

export function render_window_head(ctx: render_ctx, info: window_info): html {
    const attrs = info.node.attrs
    const mime = attrs.type ?? (attrs.path ? mime_from_name(attrs.path) : "")
    const mode = attrs.edit === "true" ? "edit" : "view"
    const mimes = mime_siblings(mime).map((item) =>
        list_item(ctx, item.icon, item.mime, item.mime === mime, { "data-mime": item.mime })
    )
    const modes = [
        ["view", "[view]", "mode_view"],
        ["edit", "[edit]", "mode_edit"]
    ].map(([value, icon_value, key]) =>
        <button class="desk_wbox_head_tool" type="button" role="radio"
            data-mode={value} aria-checked={String(value === mode)}
            tabindex={value === mode ? 0 : -1} title={t(ctx, key)} aria-label={t(ctx, key)}>
            {glyph(ctx, icon_value)}
        </button>
    )
    const moves = [
        ["[move_right]", "move_right"],
        ["[move_bottom]", "move_bottom"],
        ["[move_left]", "move_left"],
        ["[move_top]", "move_top"]
    ].map(([icon_value, key]) =>
        list_item(ctx, icon_value, t(ctx, key), false, { "data-move": key.slice(5) })
    )
    const parts = [
        <span class="desk_wbox_head_icon" aria-hidden="true">
            {icon(ctx, info.icon)}
        </span>,
        <div class="desk_wbox_head_navigation" role="group" aria-label={t(ctx, "folder_navigation")}>
            {[["previous", "previous", "[arrow_left]"], ["refresh", "folder_refresh", "[refresh]"], ["forward", "forward", "[arrow_right]"]].map(([action, key, mark]) =>
                <button type="button" class={`desk_wbox_head_tool desk_wbox_head_${action}`} data-navigation={action}
                    title={t(ctx, key)} aria-label={t(ctx, key)} disabled={action !== "refresh"}>{glyph(ctx, mark)}</button>
            )}
        </div>,
        <div class="desk_wbox_head_source">
            {head_list(
                ctx,
                "desk_wbox_head_mime",
                t(ctx, "mime_type"),
                mime || t(ctx, "no_mime"),
                mimes,
                t(ctx, "filter_mimes")
            )}
            <div class="desk_wbox_head_address">
                <input
                    class={"desk_wbox_head_path"}
                    type={"text"}
                    aria-label={t(ctx, "window_source")}
                    autocomplete={"off"}
                    spellcheck={"false"}
                    value={attrs.path ?? ""}
                />
                <nav class="desk_wbox_head_breadcrumbs" aria-label={t(ctx, "window_source")}></nav>
            </div>
            <div class="desk_wbox_head_mode" role="radiogroup" aria-label={t(ctx, "view_mode")}>{modes}</div>
        </div>,
        <div class="desk_wbox_head_actions" role="group" aria-label={t(ctx, "window_actions")}>
            {head_button(ctx, "desk_wbox_head_audio", t(ctx, "window_audio"), "[audio]", false)}
            {attrs.save !== "false" && head_button(ctx, "desk_wbox_head_save", t(ctx, "save"), "[save]", true)}
        </div>,
        attrs.flow !== "false" &&
            head_button(ctx, "desk_wbox_head_split", t(ctx, "split_window"), "[split]", false),
        head_button(ctx, "desk_wbox_head_fullscreen", t(ctx, "window_fullscreen"), "[fullscreen]", false),
        tool_list(ctx, "desk_wbox_head_drop", t(ctx, "move_window"), "[move]", moves)
    ]
    return (
        <>
            <header class={"desk_wbox_head"}>{parts}</header>
        </>
    )
}

export function render_text_body(text: string): child {
    return <pre class="desk_wbox_body_text">{text}</pre>
}

export function note(ctx: render_ctx, key: string, extra: string = ""): html {
    return (
        <>
            <div class={"desk_wbox_body_none"} role={"status"}>
                <p>
                    {t(ctx, key)}
                    {extra ? " " + extra : ""}
                </p>
            </div>
        </>
    )
}

export function partial(_ctx: render_ctx, _name: string): child {
    return window_svg_edit()
}

export function render_video(ctx: render_ctx, src: string, mime: string): child {
    return window_video(src, mime, t(ctx, "view"))
}

export function render_window_body(ctx: render_ctx, info: window_info): html {
    const attrs = info.node.attrs
    const path = attrs.path ?? ""
    const mime = attrs.type ?? (path ? mime_from_name(path) : "")
    const mode = attrs.edit === "true" ? "edit" : "view"
    if (path === "server:fastfetch") return <div class="server_public_render" data-server-render=""><p>{t(ctx, "server_offline")}</p></div>
    if (!mime && !path)
        return (
            <>
                <div class={"desk_wbox_body_empty"}>
                    <div class="desk_wbox_body_empty_actions">
                        <button type="button" class="desk_wbox_body_empty_folder" title="/home/user">{t(ctx, "open_folder")}</button>
                        <button type="button" class="desk_wbox_body_empty_terminal">{t(ctx, "open_terminal")}</button>
                    </div>
                    <label class={"desk_wbox_body_empty_upload"}>
                        <span class={"desk_wbox_body_empty_text"}>{t(ctx, "drop_file_or_upload")}</span>
                        <input
                            class={"desk_wbox_body_empty_input"}
                            type={"file"}
                            multiple={""}
                            aria-label={t(ctx, "choose_file")}
                        />
                    </label>
                </div>
            </>
        )
    if (/^(window|shell|pid):/.test(path)) return note(ctx, "needs_js", path)
    const source = attrs.data ?? read_source(ctx, path)
    if (mime === notebook_mime && source !== null) {
        try {
            const notebook = parse_notebook(source)
            return <div class="desk_notebook">{notebook.cells.map(cell => <section class="notebook_cell">{notebook_cell_content(cell)}</section>)}</div>
        } catch { return <div class="desk_notebook"><p>{t(ctx, "note_invalid")}</p><pre class="notebook_source">{source}</pre></div> }
    }
    const is_text = mime.startsWith("text/") || mime === "application/json"
    if (mode === "edit" && is_text && source !== null) return render_text_body(source)
    if (mode === "view" && mime === "text/markdown" && source !== null)
        return (
            <>
                <div class={"desk_wbox_body_doc"}>{markdown_nodes(source)}</div>
            </>
        )
    if (mode === "view" && is_text && source !== null)
        return (
            <>
                <pre class={"desk_wbox_body_text"}>{source}</pre>
                {note(ctx, "run_needs_js")}
            </>
        )
    const public_path = path.replace(/^file:\/\//, "")
    if (mode === "view" && mime.startsWith("video/")) return render_video(ctx, public_path, mime)
    if (mode === "view" && mime.startsWith("image/"))
        return (
            <>
                <div class={"desk_wbox_body_media"}>
                    <img class={"desk_wbox_body_media_image"} src={public_path} alt={""} loading={"lazy"} />
                </div>
            </>
        )
    if (mode === "edit" && mime === "image/svg+xml") return partial(ctx, "window_svg_edit.html")
    return note(ctx, `unsupported_${mode}`, mime)
}

export function render_window(ctx: render_ctx, info: window_info, columns: number, count: number): html {
    const row = Math.floor(info.index / columns)
    const column = info.index % columns
    const span = info.index === count - 1 ? columns - column : 1
    const from = 3 + 2 * column
    return (
        <>
            <section
                class={"desk_wbox"}
                id={`window-${info.index}`}
                style={`grid-area: ${1 + 2 * row} / ${from} / ${2 + 2 * row} / ${from + 2 * span - 1}`}
                data-full={is_true(info.node.attrs.full) ? "" : undefined}
                data-path={info.node.attrs.path ?? ""}
                data-source={info.node.attrs.data}
                data-mode={info.node.attrs.edit === "true" ? "edit" : "view"}
                data-mime={info.node.attrs.type ?? ""}
                data-split={info.node.attrs.split}
            >
                {is_true(info.node.attrs.full) ? "" : render_window_head(ctx, info)}
                {render_window_body(ctx, info)}
            </section>
        </>
    )
}
