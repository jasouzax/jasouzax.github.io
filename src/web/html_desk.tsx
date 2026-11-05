import { window_video } from "./partials/window_video.tsx"
import { window_svg_edit } from "./partials/window_svg_edit.tsx"
import { jsx, fragment, raw_text, type child, type attributes } from "./vnode.tsx"
import { raw } from "./markup.tsx"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import MarkdownIt from "markdown-it"
import type { xml_node } from "../xml.ts"
import { child_nodes } from "../xml.ts"
import type { html } from "../util.ts"
import { esc_html, esc_attr, json_ascii_pua } from "../util.ts"
import type { render_ctx } from "./html_common.tsx"
import { t, glyph, text_of, icon, link_attrs } from "./html_common.tsx"
import { ui_text } from "../model.ts"
import { is_true } from "../schema.ts"
import { mime_from_name, mime_info_of, mime_siblings, mime_table } from "../mime.ts"

const markdown = new MarkdownIt({ html: false, linkify: true })

export type window_info = { index: number; label: string; icon: string; node: xml_node }

export function read_source(ctx: render_ctx, path: string): string | null {
    const file = ctx.model.resources.get(path.replace(/^file:\/\//, ""))
    if (!file) return null
    return existsSync(file) ? readFileSync(file, "utf8") : null
}

function base_name(path: string): string {
    return (
        path
            .split("/")
            .filter((part) => part.length > 0)
            .pop() ?? path
    )
}

export function window_infos(ctx: render_ctx, desk: xml_node): window_info[] {
    return child_nodes(desk, "window").map((node, index) => {
        const mime = node.attrs.type ?? (node.attrs.path ? mime_from_name(node.attrs.path) : "")
        const label =
            node.attrs.path && !/^(window|shell|pid):/.test(node.attrs.path)
                ? base_name(node.attrs.path)
                : mime || t(ctx, "new_window")
        const icon = node.attrs.icon ?? mime_info_of(mime)?.icon ?? "[file]"
        return { index, label, icon, node }
    })
}

function list_item(
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
function head_list(
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

function tool_list(
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
function head_button(
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

function render_window_head(ctx: render_ctx, info: window_info): html {
    const attrs = info.node.attrs
    const mime = attrs.type ?? (attrs.path ? mime_from_name(attrs.path) : "")
    const mode = attrs.mode ?? "view"
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
        <div class="desk_wbox_head_source">
            {head_list(
                ctx,
                "desk_wbox_head_mime",
                t(ctx, "mime_type"),
                mime || t(ctx, "no_mime"),
                mimes,
                t(ctx, "filter_mimes")
            )}
            <input
                class={"desk_wbox_head_path"}
                type={"text"}
                aria-label={t(ctx, "window_source")}
                autocomplete={"off"}
                spellcheck={"false"}
                value={attrs.path ?? ""}
            />
            <div class="desk_wbox_head_mode" role="radiogroup" aria-label={t(ctx, "view_mode")}>{modes}</div>
        </div>,
        attrs.save !== "false" && head_button(ctx, "desk_wbox_head_save", t(ctx, "save"), "[save]", true),
        attrs.flow !== "false" &&
            head_button(ctx, "desk_wbox_head_split", t(ctx, "split_window"), "[split]", false),
        tool_list(ctx, "desk_wbox_head_drop", t(ctx, "move_window"), "[move]", moves)
    ]
    return (
        <>
            <header class={"desk_wbox_head"}>{parts}</header>
        </>
    )
}

function render_text_body(text: string): child {
    return <pre class="desk_wbox_body_text">{text}</pre>
}

function note(ctx: render_ctx, key: string, extra: string = ""): html {
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

function partial(_ctx: render_ctx, _name: string): child {
    return window_svg_edit()
}

function render_video(ctx: render_ctx, src: string, mime: string): child {
    return window_video(src, mime, t(ctx, "view"))
}

function render_window_body(ctx: render_ctx, info: window_info): html {
    const attrs = info.node.attrs
    const path = attrs.path ?? ""
    const mime = attrs.type ?? (path ? mime_from_name(path) : "")
    const mode = attrs.mode ?? "view"
    if (!mime && !path)
        return (
            <>
                <div class={"desk_wbox_body_empty"}>
                    <label class={"desk_wbox_body_empty_upload"}>
                        <span class={"desk_wbox_body_empty_text"}>{t(ctx, "drop_file_or_upload")}</span>
                        <input
                            class={"desk_wbox_body_empty_input"}
                            type={"file"}
                            multiple={""}
                            aria-label={t(ctx, "choose_file")}
                        />
                    </label>
                    <button type="button" class="desk_wbox_body_empty_terminal">{t(ctx, "open_terminal")}</button>
                </div>
            </>
        )
    if (/^(window|shell|pid):/.test(path)) return note(ctx, "needs_js", path)
    const source = attrs.data ?? read_source(ctx, path)
    const is_text = mime.startsWith("text/") || mime === "application/json"
    if (mode === "text" && is_text && source !== null) return render_text_body(source)
    if (mode === "view" && mime === "text/markdown" && source !== null)
        return (
            <>
                <div class={"desk_wbox_body_doc"}>{raw(markdown.render(source))}</div>
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

export function render_window(ctx: render_ctx, info: window_info, columns: number): html {
    const row = Math.floor(info.index / columns) + 1
    const column = (info.index % columns) + 2
    return (
        <>
            <section
                class={"desk_wbox"}
                id={`window-${info.index}`}
                style={`grid-area: ${row} / ${column}`}
                data-full={is_true(info.node.attrs.full) ? "" : undefined}
                data-path={info.node.attrs.path ?? ""}
                data-mode={info.node.attrs.mode ?? "view"}
                data-mime={info.node.attrs.type ?? ""}
            >
                {is_true(info.node.attrs.full) ? "" : render_window_head(ctx, info)}
                {render_window_body(ctx, info)}
            </section>
        </>
    )
}

function entry_kind(type: string): string {
    const key = type.toLowerCase()
    if (["folder", "dir", "directory"].includes(key)) return "dir"
    if (key === "file") return "file"
    if (["share", "boost"].includes(key)) return "share"
    return "post"
}

function render_entry(ctx: render_ctx, node: xml_node, side_index: number): html {
    const attrs = node.attrs
    const kind = entry_kind(attrs.type ?? "Post")
    const id = attrs.id ?? `${side_index}_${node.line}`
    const default_icon =
        kind === "dir"
            ? "[folder]"
            : kind === "file"
              ? (mime_info_of(mime_from_name(attrs.name ?? ""))?.icon ?? "[file]")
              : "[file]"
    const icon_html = attrs.image ? (
        <>
            <img class={"desk_side_item_icon"} src={attrs.image} alt={""} />
        </>
    ) : (
        glyph(ctx, attrs.icon ?? default_icon, "desk_side_item_icon")
    )
    const entry_name = attrs.link ? (
        <>
            <a {...link_attrs(ctx, attrs.link)}>{attrs.name ?? ""}</a>
        </>
    ) : (
        (attrs.name ?? "")
    )
    const head = (
        <>
            <summary class={"desk_side_item_head"}>
                {icon_html}
                <h3 class={"desk_side_item_name"}>{entry_name}</h3>
                {attrs.from ? (
                    <>
                        <span class={"desk_side_item_code"}>{attrs.from}</span>
                    </>
                ) : (
                    ""
                )}
                {attrs.date ? (
                    <>
                        <span class={"desk_side_item_date"}>{attrs.date}</span>
                    </>
                ) : (
                    ""
                )}
            </summary>
        </>
    )
    const body = attrs.data ? (
        <>
            <div class={"desk_side_item_body"}>{attrs.data}</div>
        </>
    ) : (
        ""
    )
    const info = attrs.info ? (
        <>
            <p class={"desk_side_item_info"}>{attrs.info}</p>
        </>
    ) : (
        ""
    )
    const acts = (attrs.acts ?? "")
        .split(",")
        .map((act) => act.trim())
        .filter((act) => act.length > 0)
    const tool =
        acts.length > 0 ? (
            <>
                <div class={"desk_side_item_tool"}>
                    {acts.map((act) => (
                        <>
                            <button type={"button"}>{act}</button>
                        </>
                    ))}
                </div>
            </>
        ) : (
            ""
        )
    const children = child_nodes(node, "entry")
    const sub =
        children.length > 0 ? (
            <>
                <ul id={`items-${id}`} class={"desk_side_item_sub"}>
                    {children.map((child) => (
                        <>
                            <li>{render_entry(ctx, child, side_index)}</li>
                        </>
                    ))}
                </ul>
            </>
        ) : (
            ""
        )
    const open = is_true(attrs.open) || (kind === "dir" && children.length > 0)
    return (
        <>
            <article class={"desk_side_item"} data-kind={kind}>
                <details class={"desk_side_item_box"} open={open}>
                    {head}
                    {body}
                    {info}
                    {tool}
                    {sub}
                </details>
            </article>
        </>
    )
}

function render_side_head(ctx: render_ctx, desk: xml_node): html {
    const sides = child_nodes(desk, "menu")
    const tabs = sides.map((side, index) => (
        <>
            <li>
                <details class={"desk_side_tabs_drop"} name={"desk_side_tab"} open={index === 0}>
                    <summary>
                        {glyph(ctx, side.attrs.icon ?? "[file]")}
                        {side.attrs.name ?? ""}
                    </summary>
                </details>
            </li>
        </>
    ))
    return (
        <>
            <header class={"desk_side_head"}>
                {glyph(ctx, desk.attrs.icon, "desk_side_icon")}
                <h2 class={"desk_side_name"}>{desk.attrs.name ?? ""}</h2>
                <p class={"desk_side_info"}>{desk.attrs.info ?? ""}</p>
                <nav class={"desk_side_tabs"}>
                    <ul class={"desk_side_tabs_ul"}>{tabs}</ul>
                </nav>
            </header>
        </>
    )
}

function render_map(ctx: render_ctx, node: xml_node): html {
    const nodes = (parent: xml_node): child =>
        child_nodes(parent, "node").map((item) => (
            <>
                <li>
                    {item.attrs.link ? (
                        <>
                            <a {...link_attrs(ctx, item.attrs.link)}>{item.attrs.name ?? item.attrs.id}</a>
                        </>
                    ) : (
                        (item.attrs.name ?? item.attrs.id)
                    )}
                    {item.children.length ? (
                        <>
                            <ul>{nodes(item)}</ul>
                        </>
                    ) : (
                        ""
                    )}
                </li>
            </>
        ))
    const edges = child_nodes(node, "edge").map((edge) => (
        <>
            <li>
                {edge.attrs.from}
                {" → "}
                {edge.attrs.to}
                {edge.attrs.text ? `: ${edge.attrs.text}` : ""}
            </li>
        </>
    ))
    return (
        <>
            <details class={"desk_map"} open={""}>
                <summary>{"Map"}</summary>
                <nav aria-label={"Map"}>
                    <ul>
                        {nodes(node)}
                        {edges}
                    </ul>
                </nav>
            </details>
        </>
    )
}

// Words the desk runtime needs in the browser (it builds windows, lists and messages itself). Keys are the strings in content/strings.
const runtime_keys = [
    "new_window",
    "no_mime",
    "filter_mimes",
    "no_pages",
    "drop_file",
    "drop_file_or_upload",
    "choose_file",
    "open_terminal",
    "mime_type",
    "view_mode",
    "process_gone",
    "process_exited",
    "process_input",
    "unsupported_view",
    "unsupported_edit",
    "unsupported_text",
    "unknown_file",
    "mode_text",
    "mode_view",
    "mode_edit",
    "no_mime_match",
    "use_mime",
    "guess_mime",
    "move_right",
    "move_bottom",
    "move_left",
    "move_top",
    "resize_windows",
    "close_window",
    "minimize",
    "maximize",
    "files_create",
    "files_upload",
    "files_rename",
    "files_delete",
    "files_copy",
    "files_paste",
    "files_cut",
    "files_cut_ready",
    "files_copied",
    "files_download",
    "files_open_folder",
    "files_empty",
    "files_name",
    "files_new_file",
    "files_new_folder",
    "files_confirm_delete",
    "files_no_selection",
    "files_failed",
    "files_unsupported",
    "files_username",
    "files_cannot_edit",
    "bytes",
    "text_saved",
    "text_kept",
    "save",
    "unsaved",
    "save_download",
    "edit_too_large",
    "hex_invalid",
    "files_toolbar",
    "files_name_label",
    "files_file",
    "files_folder",
    "files_ok",
    "files_cancel",
    "files_exists",
    "files_bad_name",
    "files_open_failed",
    "files_denied",
    "files_done_upload",
    "files_forgot",
    "files_no_save"
]

function json_script(id: string, data: unknown): html {
    return (
        <>
            <script type={"application/json"} id={id}>
                {raw_text(json_ascii_pua(JSON.stringify(data)).replace(/</g, "\\u003c"))}
            </script>
        </>
    )
}

// The window a new <window> starts as: no icon, no type, no source, view mode. The runtime clones it, so the file picker works without any markup of its own.
function render_window_template(ctx: render_ctx): child {
    const node: xml_node = {
        tag: "window",
        attrs: {},
        children: [],
        text: "",
        line: 0,
        file: ctx.page.file,
        parent: null
    }
    const info = { index: 0, label: "", icon: "", node }
    return (
        <template id="desk_window_template">
            <section class="desk_wbox">
                {render_window_head(ctx, info)}
                {render_window_body(ctx, info)}
            </section>
        </template>
    )
}

// Glyphs of the Files tools (the bar and the item tools), by name.
function action_icons(ctx: render_ctx): Record<string, string> {
    const names = ["file_new", "folder_new", "upload", "rename", "copy", "cut", "paste", "download", "delete"]
    return Object.fromEntries(names.map((name) => [name, icon(ctx, `[${name}]`)]))
}

function render_runtime_data(ctx: render_ctx): html {
    const text: Record<string, string> = {}
    for (const key of runtime_keys) text[key] = ui_text(ctx.model, ctx.lang, key)
    const mimes = mime_table.map((info) => ({
        mime: info.mime,
        label: info.label,
        icon: icon(ctx, info.icon),
        extensions: info.extensions
    }))
    return json_script("desk_data", {
        text,
        mimes,
        file_icon: icon(ctx, "[file]"),
        folder_icon: icon(ctx, "[folder]"),
        icons: action_icons(ctx)
    })
}

export function render_desk(ctx: render_ctx, desk: xml_node): html {
    const sides = child_nodes(desk, "menu")
    const pages = sides.map((side, index) => {
        const mount = { "data-path": side.attrs.path }
        const foot = child_nodes(side, "foot").map((foot) => (
            <>
                <nav class={"desk_menu_foot"}>
                    {child_nodes(foot, "action").map((action) => (
                        <>
                            <a {...link_attrs(ctx, action.attrs.link)}>
                                {glyph(ctx, action.attrs.icon)}
                                {action.attrs.text}
                            </a>
                        </>
                    ))}
                </nav>
            </>
        ))
        const maps = child_nodes(side, "map").map((map) => render_map(ctx, map))
        return (
            <>
                <div role={"feed"} class={"desk_side_page"} {...mount}>
                    {child_nodes(side, "entry").map((entry) => render_entry(ctx, entry, index))}
                    {maps}
                    {foot}
                </div>
            </>
        )
    })
    const windows = window_infos(ctx, desk)
    const columns = Math.max(1, Math.ceil(Math.sqrt(windows.length)))
    // A desk with a Files side is a file-system desk: the runtime owns its windows (it creates, moves and closes them).
    const runtime = true
    const flags = {
        "data-auto": is_true(desk.attrs.auto) ? "" : undefined,
        "data-server": is_true(desk.attrs.server) ? "" : undefined,
        "data-runtime": runtime ? "" : undefined
    }
    const side = (
        <>
            <aside class={"desk_side"} id={"desk_side"}>
                {render_side_head(ctx, desk)}
                {pages}
            </aside>
        </>
    )
    const extra = runtime ? [render_window_template(ctx), render_runtime_data(ctx)] : null
    return (
        <>
            <article class={"desk article"} id={"desk"} {...flags}>
                {side}
                {windows.map((info) => render_window(ctx, info, columns))}
                {extra}
            </article>
        </>
    )
}
