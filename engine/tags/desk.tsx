import { window_info, window_infos, render_window_head, render_window_body, render_window } from "./window.tsx"
export { read_source, window_infos, render_window } from "./window.tsx"
export type { window_info } from "./window.tsx"
import { render_side_head, render_menu } from "./menu.tsx"
import { jsx, fragment, raw_text, type child } from "../../shared/vnode/vnode.tsx"
import { join } from "node:path"
import type { xml_node } from "../../shared/content/xml.ts"
import { child_nodes } from "../../shared/content/xml.ts"
import type { html } from "../../shared/util.ts"
import { json_ascii_pua } from "../../shared/util.ts"
import type { render_ctx } from "./page/context.tsx"
import { icon } from "./page/context.tsx"
import { ui_text } from "../load/model.ts"
import { is_true } from "../../shared/content/schema.ts"
import { mime_table } from "../../shared/mime.ts"
import { scene_heading, scene_player, scene_timeline } from "./scene.tsx"

// Words the desk runtime needs in the browser (it builds windows, lists and messages itself). Keys are supplied by the configured language dictionaries.
const runtime_keys = [
    "note_loading", "note_stored_outputs", "note_invalid", "note_undo", "note_redo", "note_add_code", "note_add_markdown", "note_add_raw", "note_kind_code", "note_kind_markdown", "note_kind_raw", "note_move_up", "note_move_down", "note_delete", "note_clear_outputs", "note_cell_source",
    "desk_map", "desk_windows", "map_zoom_in", "map_zoom_out", "map_reset",
    "desktop_name", "desktop_create", "desktop_save", "desktop_leave", "desktop_open", "desktop_delete", "desktop_refresh", "desktop_temporary", "desktop_saved", "desktop_saving", "desktop_invalid_name", "desktop_exists", "desktop_storage_error", "desktop_conflict", "desktop_unsupported", "desktop_replace_confirm", "desktop_delete_confirm",
    "save_destination", "save_overwrite",
    "audio", "mute",
    "version_ref", "version_parents", "version_loading", "version_empty", "version_unavailable", "version_commits",
    "window_hidden", "window_show", "window_hide", "window_unhide", "window_minimized", "windows_empty",
    "sign_out_google",
    "sign_out_google_title",
    "delete_account",
    "delete_account_confirm",
    "new_window",
    "no_mime",
    "filter_mimes",
    "no_pages",
    "drop_file",
    "drop_file_or_upload",
    "choose_file",
    "open_terminal",
    "host_missing",
    "server_offline",
    "server_unreachable",
    "server_last_snapshot",
    "server_script_start",
    "server_script_stop",
    "server_script_clear",
    "server_script_errors_only",
    "server_script_message",
    "server_script_messages",
    "server_script_empty",
    "server_script_empty_errors",
    "server_script_running",
    "server_script_stopped",
    "server_script_restarting",
    "server_script_new_window",
    "server_site_back",
    "server_site_forward",
    "server_site_reload",
    "server_site_address",
    "server_site_fit",
    "server_site_devtools",
    "server_site_keyboard",
    "server_site_connecting",
    "server_site_gone",
    "server_site_invalid",
    "server_site_sound",
    "open_folder",
    "open_new_window",
    "files_toggle_hidden",
    "window_source",
    "window_fullscreen",
    "window_exit_fullscreen",
    "window_audio",
    "window_actions",
    "server_sessions_empty",
    "server_api_title", "server_api_source", "server_api_deploy", "server_api_refresh", "server_api_rollback", "server_api_stop", "server_api_empty", "server_api_pending", "server_api_done", "server_api_error",
    "server_api_usage",
    "previous",
    "forward",
    "folder_navigation",
    "folder_context_menu",
    "folder_up",
    "folder_refresh",
    "folder_contents",
    "folder_loading",
    "folder_not_found",
    "folder_items",
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
    "compute_home", "compute_personal_home", "compute_browser_home", "compute_home_connected", "compute_home_disconnected",
    "files_cannot_edit",
    "bytes",
    "text_saved",
    "text_kept",
    "save",
    "unsaved",
    "save_download",
    "edit_too_large",
    "hex_invalid",
    "pdf_loading", "pdf_download", "pdf_previous", "pdf_next", "pdf_zoom_out", "pdf_zoom_in", "pdf_failed",
    "convert_pdf_loading", "convert_pdf_noedit", "conversion_failed", "conversion_unavailable",
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
function empty_window_info(ctx: render_ctx): window_info {
    const node: xml_node = {
        tag: "window",
        attrs: {},
        children: [],
        text: "",
        line: 0,
        file: ctx.page.file,
        parent: null
    }
    return { index: 0, label: "", icon: "", node }
}
function render_window_template(ctx: render_ctx): child {
    const info = empty_window_info(ctx)
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
    const names = ["save", "home", "compute", "disk", "file_new", "folder_new", "upload", "rename", "copy", "cut", "paste", "download", "delete", "view", "pause", "window", "refresh", "audio", "mute"]
    return Object.fromEntries(names.map((name) => [name, icon(ctx, `[${name}]`)]))
}

function render_runtime_data(ctx: render_ctx): html {
    const text: Record<string, string> = {}
    for (const key of runtime_keys) text[key] = ui_text(ctx.model, ctx.lang, key)
    for (const key of Object.keys(ctx.model.config.languages[ctx.model.config.default_language] ?? {}).filter(key => key.startsWith("work_"))) text[key] = ui_text(ctx.model, ctx.lang, key)
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
    const pages = sides.map((side, index) => render_menu(ctx, side, index))
    const windows = window_infos(ctx, desk)
    const scenes = desk.children.some(child => child.tag === "scene")
    const map_only = !windows.length && sides.some(side => child_nodes(side, "map").length)
    // Match init_desk's initial empty window before the boot skeleton is captured.
    if (!windows.length) windows.push(empty_window_info(ctx))
    const columns = Math.max(1, Math.ceil(Math.sqrt(windows.length)))
    const rows = Math.ceil(windows.length / columns)
    const initial_columns = ["1fr", ".25em", ...Array.from({ length: columns }, () => "minmax(0, 9999fr)").flatMap((track, index) => index ? [".5em", track] : [track]), ".25em"].join(" ")
    const initial_rows = Array.from({ length: rows }, () => "minmax(0, 1fr)").join(" .5em ")
    // A desk with a Files side is a file-system desk: the runtime owns its windows (it creates, moves and closes them).
    const runtime = true
    const flags = {
        "data-cwd": desk.attrs.cwd,
        "data-auto": is_true(desk.attrs.auto) ? "" : undefined,
        "data-fixed": is_true(desk.attrs.fixed) || scenes ? "" : undefined,
        "data-runtime": runtime ? "" : undefined,
        "data-map-initial": map_only ? "" : undefined
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
    let window_index = 0
    const reading = (node: xml_node, depth = 0): child => {
        if (node.tag === "window") return render_window(ctx, windows[window_index++], columns, windows.length)
        if (node.tag === "scene") return [scene_heading(node, depth), ...node.children.map(child => reading(child, depth + 1))]
        return null
    }
    return (
        <>
            <article class={"desk article"} id={"desk"} data-blog-scenes={scenes ? "" : undefined} style={`--desk-initial-columns: ${initial_columns}; --desk-initial-rows: ${initial_rows}`} {...flags}>
                {side}
                {scenes ? [scene_player(ctx, scene_timeline(ctx, desk)), ...desk.children.map(node => reading(node))] : windows.map((info) => render_window(ctx, info, columns, windows.length))}
                {extra}
            </article>
        </>
    )
}
