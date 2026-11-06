import { jsx, fragment, type child } from "./vnode.tsx"
import { raw } from "./markup.tsx"
import type { xml_node } from "../xml.ts"
import type { html } from "../util.ts"
import { esc_html, esc_attr } from "../util.ts"
import type { render_ctx } from "./html_common.tsx"
import { t, glyph, text_of, link_attrs } from "./html_common.tsx"
import { ui_text, localize } from "../model.ts"
import { unique } from "../util.ts"
import type { expertise_model, entry, bar } from "../expertise.ts"
import { default_state } from "../expertise.ts"
import { resume_format_of, render_rirekisho_body } from "./html_rirekisho.tsx"

type state_ctx = { ctx: render_ctx; data: expertise_model }

function view_id(state: string): string {
    return state
}

function timeline_id(state: string): string {
    return state === default_state ? "timeline" : `${state}/timeline`
}

function th_image(bar: bar): html {
    if (!bar.image) return ""
    return (
        <>
            <img class={"th_icon"} src={bar.image} alt={""} loading={"lazy"} width={"24"} height={"24"} />
        </>
    )
}

function render_anchors(data: expertise_model): html {
    const states = data.state_ids.filter((state) => state !== default_state)
    const items = states.map((state) => (
        <>
            <i id={state}></i>
            <i id={`${state}/timeline`}></i>
        </>
    ))
    return (
        <>
            <div class={"expertise_anchors"} aria-hidden={"true"}>
                {items}
                <i id={"timeline"}></i>
            </div>
        </>
    )
}

function tab_links(ctx: render_ctx, id: string, icon_value: string, name: string): html {
    const inner = (
        <>
            {glyph(ctx, icon_value, "tab_i")}
            {name}
        </>
    )
    return (
        <>
            <a class={"tab_view"} href={`#${view_id(id)}`}>
                {inner}
            </a>
            <a class={"tab_tl"} href={`#${timeline_id(id)}`}>
                {inner}
            </a>
        </>
    )
}

function render_tabs(ctx: render_ctx, data: expertise_model): html {
    const featured = (
        <>
            <li class={`tab tab_${default_state}`}>
                {tab_links(ctx, default_state, "[featured]", t(ctx, "featured"))}
            </li>
        </>
    )
    const groups = data.groups.map((group) => {
        const tabs = group.skills.map((skill) => (
            <>
                <li class={`tab tab_${skill.id}`}>{tab_links(ctx, skill.id, skill.icon, skill.name)}</li>
            </>
        ))
        if (!group.name) return tabs
        return (
            <>
                <li class={"tabgroup"}>
                    <span class={"tabgroup_name"}>{group.name}</span>
                    <ul class={"tabgroup_ul"}>{tabs}</ul>
                </li>
            </>
        )
    })
    return (
        <>
            <nav class={"expertise_tabs"} aria-label={t(ctx, "skills")}>
                <ul class={"expertise_tabs_ul"}>
                    {featured}
                    {groups}
                </ul>
            </nav>
        </>
    )
}

function render_heads(data: expertise_model): html {
    const rows = data.bars.flatMap((bar) =>
        ["link_view", "link_tl"].map((kind) => {
            return (
                <>
                    <div class={`th ${kind} st st_${bar.id}`}>
                        {th_image(bar)}
                        <span class={"th_name"}>{bar.name}</span>
                        <span class={"th_sub"}>{bar.sub}</span>
                    </div>
                </>
            )
        })
    )
    return (
        <>
            <div class={"expertise_heads"}>{rows}</div>
        </>
    )
}

function render_search(ctx: render_ctx): html {
    return (
        <>
            <form class={"expertise_search"} role={"search"} method={"get"}>
                <input
                    class={"expertise_search_tog"}
                    id={"expertise_search_tog"}
                    type={"checkbox"}
                    aria-label={t(ctx, "show_search")}
                />
                <input
                    class={"expertise_search_input"}
                    type={"search"}
                    name={"search"}
                    placeholder={t(ctx, "search_expertise")}
                    aria-label={t(ctx, "search_expertise")}
                    autocomplete={"off"}
                />
                <button
                    class={"expertise_search_go"}
                    type={"submit"}
                    aria-label={t(ctx, "search")}
                    title={t(ctx, "search")}
                >
                    {text_of(ctx, "[search]")}
                </button>
                <label
                    class={"expertise_search_btn"}
                    for={"expertise_search_tog"}
                    title={t(ctx, "search_toggle")}
                >
                    {glyph(ctx, "[search]", "expertise_search_o")}
                    {glyph(ctx, "[close]", "expertise_search_x")}
                </label>
            </form>
        </>
    )
}

function render_tl_buttons(ctx: render_ctx, data: expertise_model): html {
    const buttons = data.state_ids.map((state) => {
        const enter = (
            <>
                <a
                    class={`btn vt st st_${state}`}
                    href={`#${timeline_id(state)}`}
                    aria-label={t(ctx, "tl_full")}
                    title={t(ctx, "tl_full")}
                >
                    {glyph(ctx, "[expand]")}
                </a>
            </>
        )
        const leave = (
            <>
                <a
                    class={`btn gb st st_${state}`}
                    href={`#${view_id(state)}`}
                    aria-label={t(ctx, "tl_exit")}
                    title={t(ctx, "tl_exit")}
                >
                    {glyph(ctx, "[collapse]")}
                </a>
            </>
        )
        return [enter, leave]
    })
    return (
        <>
            <div class={"expertise_tlhead"}>
                <h3 class={"panel_title"}>{t(ctx, "timeline")}</h3>
                <div class={"tlhead_btns"}>{buttons}</div>
            </div>
        </>
    )
}

function tl_card(ctx: render_ctx, kind: string, href: string, bar: bar): child {
    return (
        <a class={`tl_card ${kind}`} href={href}>
            {bar.image && <img class="tl_icon" src={bar.image} alt="" loading="lazy" />}
            <b class="tl_name">{bar.name}</b>
            <span class="tl_sub">{bar.sub}</span>
            <span class="tl_desc">{bar.info}</span>
        </a>
    )
}

function render_bar(ctx: render_ctx, bar: bar): html {
    const classes = bar.states.map((state) => `in_${state}`)
    const style = `--start:${bar.start};--end:${bar.end};--lane:${bar.lane};--ord:${bar.ord}`
    const cards = [
        tl_card(ctx, "link_view", `#${bar.id}`, bar),
        tl_card(ctx, "link_tl", `#${bar.id}/timeline`, bar)
    ]
    return (
        <>
            <li class={`tl_i tl_bar in_any ${classes.join(" ")}`} style={style}>
                <span class={"tl_date"}>{bar.date_label}</span>
                {cards}
            </li>
        </>
    )
}

function render_pin(entry: entry): html {
    const classes = entry.states.map((state) => `in_${state}`)
    const style = `--at:${entry.at};--lane:${entry.lane};--ord:${entry.ord}`
    const gos = entry.states.map((state) => (
        <>
            <a class={`tl_go st st_${state}`} href={`#${state}/${entry.id}`} aria-label={entry.short}></a>
        </>
    ))
    const card = (
        <>
            <span class={"tl_card"}>
                <b class={"tl_name"}>{entry.short}</b>
                <span class={"tl_sub"}>{entry.note}</span>
                {gos}
            </span>
        </>
    )
    return (
        <>
            <li class={`tl_i tl_pin in_any ${classes.join(" ")} p_${entry.id}${entry.variant ? ` p_${entry.variant}` : ""}`} style={style}>
                <span class={"tl_date"}>{entry.date_label}</span>
                {card}
            </li>
        </>
    )
}

function render_timeline(ctx: render_ctx, data: expertise_model): html {
    const ticks = data.years.map((year) => (
        <>
            <li class={"tl_tick"} style={`--at:${year}`}>
                <span>{year}</span>
            </li>
        </>
    ))
    ticks.push(
        <>
            <li class={"tl_now"} style={`--at:${data.now_mark}`}>
                <span>{t(ctx, "now")}</span>
            </li>
        </>
    )
    const items = [
        ...data.bars.map((bar) => render_bar(ctx, bar)),
        ...data.entries.filter((entry) => entry.states.length > 0).map(render_pin)
    ]
    return (
        <>
            <section class={"expertise_tl"} aria-label={t(ctx, "timeline")}>
                <div class={"expertise_tl_in"}>
                    <ol class={"tl_ticks"} aria-hidden={"true"}>
                        {ticks}
                    </ol>
                    <ul class={"tl_items"}>{items}</ul>
                </div>
            </section>
        </>
    )
}

function render_stackset(ctx: render_ctx, data: expertise_model, state: string): html {
    const ids = data.chips[state]
    if (ids.length === 0) return ""
    const chips = ids.map((id) => {
        const name = data.chip_labels[state]?.[id] ?? data.stack_defs.get(id)?.name ?? id
        return (
            <>
                <input class={"chk"} type={"checkbox"} id={`${state}/${id}`} checked={""} />
                <label class={"chip"} for={`${state}/${id}`}>
                    {name}
                </label>
            </>
        )
    })
    const row = (
        <>
            <div class={"stackset_row"}>
                {glyph(ctx, "[filter]", "stackset_icon")}
                <button
                    class={"chip chip_all"}
                    type={"button"}
                    aria-pressed={"true"}
                    title={t(ctx, "filter_all_title")}
                >
                    {t(ctx, "all")}
                </button>
                {chips}
            </div>
        </>
    )
    const toggle = (
        <>
            <input
                class={"more_tog"}
                type={"checkbox"}
                id={`${state}/more`}
                aria-label={t(ctx, "show_filters")}
            />
        </>
    )
    const label = (
        <>
            <label class={"more"} for={`${state}/more`}>
                <span class={"more_a"}>
                    {t(ctx, "more")} {glyph(ctx, "[chevron_down]")}
                </span>
                <span class={"more_b"}>
                    {t(ctx, "less")} {glyph(ctx, "[chevron_up]")}
                </span>
            </label>
        </>
    )
    return (
        <>
            <fieldset class={`stackset st st_${state} has_more`}>
                <legend class={"sr"}>{t(ctx, "filter_tech")}</legend>
                {toggle}
                {row}
                {label}
            </fieldset>
        </>
    )
}

function gate_classes(entry: entry): string {
    const keys = entry.states.flatMap((state) =>
        (entry.stacks[state] ?? []).map((stack) => `k_${state}_${stack}`)
    )
    return ["gate", ...keys].join(" ")
}

function render_dot(entry: entry): html {
    const links = entry.states.map((state) => (
        <>
            <a class={`dot_a st st_${state}`} href={`#${state}/${entry.id}`} aria-label={entry.name}></a>
        </>
    ))
    return (
        <>
            <li class={`dot ${gate_classes(entry)} d_${entry.id}${entry.variant ? ` d_${entry.variant}` : ""}`}>{links}</li>
        </>
    )
}

function render_media(ctx: render_ctx, entry: entry): html {
    if (!entry.media) return ""
    const alt = entry.alt
    if (/\.(mp4|webm)$/.test(entry.media)) {
        const type = entry.media.endsWith(".webm") ? "video/webm" : "video/mp4"
        const poster = { poster: entry.poster || undefined }
        const link = (
            <>
                <a href={entry.media}>{t(ctx, "download_video")}</a>
            </>
        )
        return (
            <>
                <video
                    class={"slide_img"}
                    controls={""}
                    playsinline={""}
                    preload={"metadata"}
                    loading={"lazy"}
                    width={"640"}
                    height={"360"}
                    {...poster}
                    aria-label={alt}
                >
                    <source src={entry.media} type={type} />
                    {link}
                </video>
            </>
        )
    }
    return (
        <>
            <img
                class={"slide_img"}
                src={entry.media}
                alt={alt}
                loading={"lazy"}
                decoding={"async"}
                width={"640"}
                height={"360"}
            />
        </>
    )
}

function render_tags(ctx: render_ctx, data: expertise_model, entry: entry): html {
    const items = entry.tags.map((id) => {
        const def = data.stack_defs.get(id)
        const tag = `#${def?.tag ?? id}`
        if (!def?.link)
            return (
                <>
                    <li>{tag}</li>
                </>
            )
        return (
            <>
                <li>
                    <a href={def.link} target={"_blank"} rel={"noopener noreferrer"}>
                        {tag}
                    </a>
                </li>
            </>
        )
    })
    return (
        <>
            <ul class={"slide_tags"}>{items}</ul>
        </>
    )
}

// Slide buttons point at external destinations only (the slide's own page is already the title link).
// Priority 1 is the most important and sits left-most; the left-most button is the highlighted one.
function render_actions(ctx: render_ctx, entry: entry): html {
    const wanted: [string, string, string][] = [
        [entry.website, "view_website", "website"],
        [entry.paper, "view_paper", "paper"],
        [entry.event, "view_event", "event"],
        [entry.source, "view_source", "source"]
    ]
    const buttons = wanted
        .filter(([href]) => href)
        .map(([href, key, kind], index) => {
            return (
                <>
                    <a class={`btn btn_${kind}${index === 0 ? " primary" : ""}`} {...link_attrs(ctx, href)}>
                        {t(ctx, key)}
                    </a>
                </>
            )
        })
    if (buttons.length === 0) return ""
    return (
        <>
            <p class={"slide_actions"}>{buttons}</p>
        </>
    )
}

function render_slide_skills(ctx: render_ctx, data: expertise_model, entry: entry): child {
    if (!entry.href?.includes("/projects/")) return ""
    const variants = data.entries.filter(item => item.id === entry.id && item.href === entry.href)
    const ids = unique(variants.flatMap(item => item.states)).filter(id => data.skills.some(skill => skill.id === id))
    const fallback = ids.find(id => entry.states.includes(id))
    if (!ids.length) return ""
    return (
        <nav class="slide_skills" aria-label={t(ctx, "skills")} data-default-skill={fallback}>
            {ids.map(id => (
                <a class={`slide_skill skill_${id}${id === fallback ? " is_default" : ""}`}
                    href={`#${id}/${entry.id}`} data-skill={id} aria-current={id === fallback ? "true" : undefined}>
                    {data.skills.find(skill => skill.id === id)!.name}
                </a>
            ))}
        </nav>
    )
}

function render_slide(ctx: render_ctx, data: expertise_model, entry: entry): html {
    const pins = entry.states.map((state) => (
        <>
            <i class={`pin st st_${state}`} id={`${state}/${entry.id}`}></i>
        </>
    ))
    const arrows = entry.states.map((state) => {
        const href = `#${state}/${entry.id}`
        const next = (
            <>
                <a
                    class={`arrow arrow_next st st_${state}`}
                    href={href}
                    aria-label={`${t(ctx, "next")}: ${entry.name}`}
                >
                    {t(ctx, "next")} {glyph(ctx, "[chevron_right]")}
                </a>
            </>
        )
        const prev = (
            <>
                <a
                    class={`arrow arrow_prev st st_${state}`}
                    href={href}
                    aria-label={`${t(ctx, "previous")}: ${entry.name}`}
                >
                    {glyph(ctx, "[chevron_left]")} {t(ctx, "previous")}
                </a>
            </>
        )
        return [next, prev]
    })
    const open = entry.href ? (
        <>
            <a
                class={"slide_page"}
                {...link_attrs(ctx, entry.href)}
                aria-label={`${t(ctx, "open_page_for")} ${entry.name}`}
                title={t(ctx, "open_page")}
            >
                {text_of(ctx, "[external]")}
            </a>
        </>
    ) : (
        ""
    )
    const top = (
        <>
            <div class={"slide_top"}>
                <h3 class={"slide_name"}>{entry.name}</h3>
                {open}
            </div>
        </>
    )
    const role = (
        <>
            <p class={"slide_role"}>
                <span>
                    {entry.role}
                    {t(ctx, "colon")}
                </span>{" "}
                <span class={"slide_role_sub"}>{entry.sub}</span>
                <time class={"slide_date"}>{entry.date_label}</time>
            </p>
        </>
    )
    const foot = (
        <>
            <div class={"slide_foot"}>
                {render_tags(ctx, data, entry)}
                {render_slide_skills(ctx, data, entry)}
                {render_actions(ctx, entry)}
            </div>
        </>
    )
    const card = (
        <>
            <div class={"slide_card"}>
                {top}
                {role}
                {render_media(ctx, entry)}
                <p class={"slide_desc"}>{entry.desc}</p>
                {foot}
            </div>
        </>
    )
    return (
        <>
            <article class={`slide ${gate_classes(entry)}`} data-search-id={entry.variant}>
                {pins}
                {arrows}
                {card}
            </article>
        </>
    )
}

// Previous / Next that stay where they are while the slides move (client_expertise.ts points them at the neighbours of the slide in view and
// shows or hides them). Without JS they stay hidden and the arrows inside each slide do the same job.
function render_nav(ctx: render_ctx): html {
    const previous = t(ctx, "previous")
    const next = t(ctx, "next")
    return (
        <>
            <div class={"expertise_nav"}>
                <a class={"arrow arrow_prev nav_prev"} data-label={previous} hidden={""}>
                    {glyph(ctx, "[chevron_left]")} {previous}
                </a>
                <a class={"arrow arrow_next nav_next"} data-label={next} hidden={""}>
                    {next} {glyph(ctx, "[chevron_right]")}
                </a>
            </div>
        </>
    )
}

function render_empty(ctx: render_ctx, data: expertise_model): html {
    const empty = data.state_ids.filter(
        (state) =>
            state !== default_state &&
            !data.entries.some((entry) => entry.states.includes(state)) &&
            !data.bars.some((bar) => bar.id === state)
    )
    const classes = empty.map((state) => `st_${state}`).join(" ")
    const none =
        empty.length === 0 ? (
            ""
        ) : (
            <>
                <div class={`expertise_empty st ${classes}`} role={"status"}>
                    <p class={"empty_title"}>{t(ctx, "empty_title")}</p>
                    <p>{t(ctx, "empty_text")}</p>
                    <a class={"btn"} href={`#${default_state}`}>
                        {glyph(ctx, "[featured]")} {t(ctx, "view_featured")}
                    </a>
                </div>
            </>
        )
    const search = (
        <>
            <div class={"expertise_empty expertise_empty_search"} role={"status"} hidden={""}>
                <p class={"empty_title"}>
                    {t(ctx, "no_results_for")}
                    {" “"}
                    <span class={"empty_q"}></span>
                    {"”"}
                </p>
                <p>{t(ctx, "no_results_text")}</p>
            </div>
        </>
    )
    return [none, search]
}

function t_text(ctx: render_ctx, key: string): string {
    return ui_text(ctx.model, ctx.lang, key)
}

function sentences(text: string): string[] {
    // after . ! ? when a capital or digit follows, and after the full-width 。！？ (Japanese has no space between sentences)
    return text
        .split(/(?<=[.!?])\s+(?=[A-Z0-9])|(?<=[\u3002\uff01\uff1f])\s*/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
}

function resume_item(title: string, aside: string, sub: string, sub_aside: string, body: html): html {
    const head = (
        <>
            <div class={"resume_item_head"}>
                <span class={"resume_item_title"}>{title}</span>
                <span class={"resume_item_aside"}>{aside}</span>
            </div>
        </>
    )
    const second =
        sub || sub_aside ? (
            <>
                <div class={"resume_item_sub"}>
                    <span>{sub}</span>
                    <span>{sub_aside}</span>
                </div>
            </>
        ) : (
            ""
        )
    return (
        <>
            <div class={"resume_item"}>
                {head}
                {second}
                {body}
            </div>
        </>
    )
}

function resume_bullets(text: string): html {
    return (
        <>
            <ul class={"resume_points"}>
                {sentences(text).map((line) => (
                    <>
                        <li>{line}</li>
                    </>
                ))}
            </ul>
        </>
    )
}

function resume_section(title: string, body: html[]): html {
    if (body.length === 0) return ""
    return (
        <>
            <section class={"resume_section"}>
                <h2 class={"resume_title"}>{title}</h2>
                {body}
            </section>
        </>
    )
}

// Print only: education, experience, featured projects and skills, in that order. Hidden on screen; the print stylesheet shows it and hides the rest.
function render_resume(ctx: render_ctx, data: expertise_model): html {
    const form = resume_format_of(ctx)
    if (form.format === "rirekisho" && form.node) return render_rirekisho_body(ctx, data, form.node)
    const by_start = (a: bar, b: bar): number => b.start - a.start || b.end - a.end
    const education = data.bars
        .filter((bar) => bar.resume === "education")
        .sort(by_start)
        .map((bar) =>
            resume_item(
                bar.name,
                bar.period,
                bar.sub,
                "",
                bar.info ? (
                    <>
                        <p class={"resume_text"}>{bar.info}</p>
                    </>
                ) : (
                    ""
                )
            )
        )
    const experience = data.bars
        .filter((bar) => bar.resume === "experience")
        .sort(by_start)
        .map((bar) =>
            resume_item(bar.name, bar.period, bar.sub, "", bar.info ? resume_bullets(bar.info) : "")
        )
    const featured = data.entries.filter(
        (entry) => entry.href?.startsWith("/projects/") && entry.states.includes(default_state)
    )
    const projects = featured.map((entry) => {
        const tools = unique([...(entry.stacks[default_state] ?? []), ...Object.values(entry.stacks).flat()])
            .slice(0, 5)
            .map((id) => data.stack_defs.get(id)?.name ?? id)
            .join(", ")
        const role = [entry.role, entry.sub].filter(Boolean).join(": ")
        return resume_item(entry.name, tools, role, entry.date_label, resume_bullets(entry.desc))
    })
    // Each tool is listed once, under the first skill that uses it, and a line holds at most 10 so the section stays short.
    const seen = new Set<string>()
    const skills = data.skills
        .map((skill) => {
            const ids = (data.chips[skill.id] ?? []).filter((id) => !seen.has(id)).slice(0, 10)
            for (const id of ids) seen.add(id)
            return { skill, names: ids.map((id) => data.stack_defs.get(id)?.name ?? id) }
        })
        .filter((item) => item.names.length > 0)
        .map((item) => (
            <>
                <p class={"resume_skill"}>
                    <span class={"resume_skill_name"}>
                        {item.skill.name}
                        {":"}
                    </span>{" "}
                    {item.names.join(", ")}
                </p>
            </>
        ))
    const sections = [
        resume_section(t_text(ctx, "education"), education),
        resume_section(t_text(ctx, "experience"), experience),
        resume_section(t_text(ctx, "projects"), projects),
        resume_section(t_text(ctx, "skills"), skills)
    ]
    return (
        <>
            <div class={"expertise_resume"} hidden={""}>
                {sections.filter((section) => section !== "")}
            </div>
        </>
    )
}

export function render_expertise(ctx: render_ctx, node: xml_node, data: expertise_model): html {
    const head = (
        <>
            <header class={"expertise_head"}>
                <h2 id={"expertise_title"} class={"expertise_title"}>
                    {node.attrs.name ?? "Expertise"}
                </h2>
                {render_tabs(ctx, data)}
                {render_heads(data)}
                {render_search(ctx)}
            </header>
        </>
    )
    const stacks = data.state_ids
        .map((state) => render_stackset(ctx, data, state))
        .filter((set) => set !== "")
    const dots = data.entries.filter((entry) => entry.states.length > 0).map(render_dot)
    const slides = data.entries
        .filter((entry) => entry.states.length > 0)
        .map((entry) => render_slide(ctx, data, entry))
    const all_link = (
        <>
            <a class={"btn expertise_all"} href={localize(ctx.model, ctx.lang, "/projects")}>
                {t(ctx, "all_projects")} {glyph(ctx, "[external]")}
            </a>
        </>
    )
    const slider = (
        <>
            <div class={"expertise_slider"}>
                <ol class={"expertise_dots"} aria-label={t(ctx, "slides")}>
                    {dots}
                </ol>
                <div class={"expertise_track"} tabindex={"-1"}>
                    {slides}
                </div>
                {render_nav(ctx)}
                {render_empty(ctx, data)}
            </div>
        </>
    )
    const box = (
        <>
            <div class={"expertise_box"}>
                {render_tl_buttons(ctx, data)}
                {render_timeline(ctx, data)}
                <div class={"expertise_prjhead"}>
                    <h3 class={"panel_title"}>{t(ctx, "events_projects")}</h3>
                    {all_link}
                </div>
                <div class={"expertise_stacks"}>{stacks}</div>
                {slider}
            </div>
        </>
    )
    return (
        <>
            <article
                class={"expertise article js"}
                id={"expertise"}
                aria-labelledby={"expertise_title"}
                data-slide_number={t(ctx, "slide_number")}
            >
                {render_anchors(data)}
                {head}
                {box}
                {render_resume(ctx, data)}
            </article>
        </>
    )
}
