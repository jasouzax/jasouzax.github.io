# JAZU Components

**JAZU** *(JAsouZa User interface)* is a website system with three purposes:

- **Portfolio** - a central place where recruiters and the public browse the owner's work.
- **Workspace** - the interface where the owner does personal projects and client work.
- **Showcase** - the system itself implements real technical techniques of several fields, so its own behavior demonstrates the owner's capabilities live.

The whole system is a set of components interacting with other components. This file is the single reference for all of them.

---

## 0. How to read this document

**Component format.** Every component states only what it does and why:

| Part | Meaning |
|---|---|
| **Objective** | The problem the component exists to solve |
| **Solution** | The technical approach that solves it |
| **Interface** | The contract others use: XML tags and attributes, URIs, API routes, CLI commands or files |

Dependencies, build order, implementation status and verification are tracked in `TASKS.md`, not here. This document is the target contract; a described capability is not a claim that it has shipped. See README.md for the current runnable subset.

**Conventions**

- The **owner** is whoever controls the codebase and its content. Nothing here is specific to one person; owner-specific values (name, domain, email) live in `{codebase}/config.json` and in `content`.
- All identifiers are `snake_case`: files, folders, TypeScript names, CSS classes and custom properties, JSON keys, SQL names, CLI flags. XML tag and attribute names are single lowercase words.
- `{codebase}` is the repository root.
- Components marked as an XML tag (`<hero>`) are authored in `content`; all others are engine, runtime or cloud components.

**Value types used by XML attributes**

| Type | Rule |
|---|---|
| `bool` | `true` or `false` |
| `list` | Comma separated, whitespace trimmed |
| `date` | `2024`, `May 2024`, `May 23, 2024`, or a range `Aug 2022 - Jun 2026`; `present` as a range end means the build month |
| `uri` | `/path`, `https://...`, `mailto:...`, `file:///...`, `window:N[:/sub]`, `pid://name[:/stream]` |
| `mime` | RFC 6838 media type, wildcards allowed in triggers (`image/*`) |
| `icon` | One character: a registry token `[globe]`, a raw private-use character, an emoji or a letter |

Boolean attributes may omit their value: `<window full save/>` means `full="true" save="true"`. Use an explicit `="false"` to turn one off. This content XML extension applies only to start-tag attributes; quoted values, text, comments and CDATA retain normal XML behavior.

**Text tokens.** In `icon`, `text`, `name`, `info` and `data` values, `[name]` is replaced by the character registered for `name` in the icon registry (1.12). Unregistered tokens stay literal and raise a build warning. A literal bracket is written `&#91;`.

**Secrets.** Tokens and other vulnerable values are never in `content` or `config.json`; they live in `.env` (local) or Cloudflare secrets (cloud).

---

## 1. Content (`{codebase}/content`)

### 1.0 Content directory

**Objective.** Let the owner maintain a large website by editing plain files in a predictable content layout.

**Solution.** The engine scans every file under `content` and identifies how to interpret it from its type and root tag. Page roots live directly in `content`, blog roots/resources in `content/blogs`, shared media in `content/media`, and themes in `content/theme`. The page's address comes from its attributes. Putting all XML into one file produces the same website as splitting it, apart from relative resource paths. A large media file is only copied into the output if an XML file references it. Keep language variants of the same page or blog together in one XML file, with one root per language; the engine wraps it in a synthetic `<jazu>` element before parsing.

**Interface.**

| Root tag | Becomes |
|---|---|
| `<page>` | A page (1.1) |
| `<project>` | A project page and its workspace (1.5) |
| `<event>` | An event page and its timeline entry (1.6) |
| `<blog>` | A blog post page (1.7) |
| `<theme>` | A theme (1.9) |
| `<print>` | A print mode (1.13) |
| `<plugin>` | A desktop plugin (1.10) |

Skills and stacks are not roots: they are detected from what projects, slides and events reference, and declared only inside `<expertise>` (1.3).

Other files are interpreted by extension: `.md` (text windows and descriptions), `.scss` and `.css` (styles), `.js` (theme or plugin scripts), and media (`.svg`, `.png`, `.avif`, ...). TSX partials live under `src/web/partials`; interface strings live in `config.json.languages` (1.11). Object files are UTF-8 XML with the valueless boolean-attribute extension above; raw text such as SCSS goes in CDATA. Configuration that does not describe an object (pages, projects, ...) is not in `content`; it is in `config.json` (1.12).

- [x] Existing English/Japanese page and blog variants share XML files, retaining one root per language and stable URLs.

### 1.1 Page `<page>`

**Objective.** Define one navigable URL, its identity in navigation and search, and its content.

**Solution.** A page is a `<page>` element whose children are components (hero, expertise, desk) that become its sections or tabs. The same `path` may be defined several times with different `lang` values; they are alternates of one page. Pages for projects, events and blogs are generated (1.5-1.7) and need no `<page>`.

**Interface.**

| Attribute | Meaning |
|---|---|
| `path` | URL path, e.g. `/`, `/privacy` |
| `lang` | Language, default is the configured default language |
| `name` | Title; breadcrumb, dropdown and head navigation label |
| `icon` | Icon used in head navigation |
| `rank` | Integer; higher means earlier in navigation order |
| `info` | Description (meta description, tooltip) |
| `menu` | `false` hides the page from dropdowns, suggestions and search |
| `noindex` | `true` removes it from search engine files |
| `print` | Name of the print mode used when printing this page (1.13); empty means the browser default |
| `image`, `cover`, `keywords`, `canonical`, `robots`, `lastmod` | SEO overrides (2.7) |

Children: `<hero>`, `<expertise>`, `<desk>`.

### 1.2 Hero `<hero>`

**Objective.** Give quick, direct information. It serves landing pages, contact sections, sitemaps and error pages with a single component.

**Solution.** One element with a status, a name, rotating tags, a description, a list of links and a list of buttons. Wording such as a greeting ("Hi, I'm") belongs to the theme because it differs between themes. Tags are all rendered and cycled with CSS only; the first tag is the static state. The first hero of the website's landing page is also the only source of personal information for print modes (1.13).

**Interface.**

| Attribute | Meaning |
|---|---|
| `status` | Small status line (e.g. "Available for new projects") |
| `name` | The owner's name on a landing page, or a header for contact, error and sitemap heroes |
| `tab` | Optional header-tab label override; defaults to `name`. The landing hero uses `Home` (`ホーム` in Japanese) |
| `tags` | `list`; the owner's roles on a landing page |
| `info` | Description |
| `profile` | Profile image (also the photo of print modes that use one) |

Children:

- `<item icon name text link print>` - one entry of the link list (contact detail, page, location). `print` is a **label** (`email`, `phone`, `address`, `kana`, `birth`, ...) that print modes look up to find this value; it does not change how the item is shown on screen.
- `<action icon text link primary>` - a button. `primary="true"` highlights it.

- [x] Hero `tab` overrides only the header label; the visible name and published print name remain unchanged.

### 1.3 Expertise `<expertise>`

**Objective.** Let a visitor browse the owner's experience, education, projects, certifications and competitions graphically, and instantly see each project through the skill they care about.

**Solution.** The component has no attributes. Its **entries** are never hand-written: they are detected from every `<event>` (1.6) and every `<project>` and its `<slide>`s (1.5). Blogs are not part of it. Its **vocabulary** (which skills and stacks exist, how they look and group) is declared by its children. A skill or stack that entries reference but the expertise does not declare is not shown and has no alternate versions (a build warning is raised); a declared skill with no entries has an empty page. For example, without `<skill name="iot"/>` there is no IoT page and no slide has an IoT version.

Filtering uses radio inputs placed before the content so selectors such as `#skill_iot:checked ~ .expertise_body .slide:not(.skill_iot)` work without JavaScript and without `:has()`. All geometry is computed at build time (2.4.4).

Sub-components:

1. **Skill head** - tabs, one per declared skill, grouped by `group`. Exactly one skill or none is focused. Focusing a skill updates the whole component to it. A clear control returns to none. Beside the skills, the **stacks** are shown: the stacks of the focused skill, or the expertise's own stacks when no skill is focused. A stack filters in the same one-at-a-time way, within the current skill.
2. **Search** - text search over every entry regardless of the focused skill. It matches names, descriptions, media alternative text, tags and hashtags of every slide, so a result can be a slide of a skill that is not focused.
3. **Timeline** - vertical continuous time axis with dots for point events and rectangles for periods. Overlapping periods are placed in the next lane to the left. On portrait screens the axis becomes equal-spaced entries with no rectangles. Events and projects both appear; the focused skill and stack filter them.
4. **Slideshow** - the slide on the center, a filter strip above it, a button to view all projects (`/projects`), and slide navigation below. A slide is one **version of a project for one skill**.

**Slide selection.** A project (1.5) has one slide per skill. For each project the slideshow decides which version to show:

| Situation | Slides shown | Version of each project |
|---|---|---|
| No skill focused | Projects with `featured="true"` | Its slide marked `featured`, else its first slide |
| Skill focused | Every project that has a slide for that skill | That skill's slide (media, description, stack and tags change) |
| Search | Every project with a matching slide | The best matching slide, even if another is featured |

Example: an IoT traffic tracker has an IoT slide (the system diagram and an explanation of the IoT system) and an AI slide (image-recognition footage and an explanation of the model). With IoT focused the slide shows the diagram; with AI focused it shows the footage; a search for "recognition" shows the AI version without focusing the skill.

The slide's hashtags move to its head, and the filter strip holds **the skills that slide's project has versions for**. Clicking one switches the same project to that skill's version. The address reflects the choice as `#{skill}/{project_id}` (`#iot/traffic_tracker`, `#ai/traffic_tracker`; `#all/{project_id}` with no skill) so a version can be linked.

**Interface.**

- `<skill name icon group info>` - a skill. `name` is the identity (its slug is used in classes and addresses). May contain `<stack>`.
- `<stack name icon tag link>` - a tool or technology; `tag` is a short chip label. Inside `<skill>` it belongs to that skill; directly inside `<expertise>` it is shown when no skill is focused.
- Events and projects join the vocabulary through their `skill` and `stack` attributes (and slides through theirs); many to many.

### 1.4 Desk `<desk>`

**Objective.** Provide a desktop-like workspace that adapts to any content: a file manager, a blog post, a project, a client portal, a tool such as an image converter. One primitive serves `/desk`, `/projects`, `/blogs`, `/work` and any page.

**Solution.** A desk is a side navigation panel (menu) plus tiled windows. What a desk can do is supplied by plugins (1.10), not hard coded. Landscape: the menu is a resizable panel and windows tile with draggable dividers. Portrait: the menu overlays from the right and windows become tabs with a bottom bar. With `auto="true"` the desk grows with its content and shares the page scrollbar (used by blogs) while the menu stays sticky.

**The content is a starting condition, not the final state.** A desk is compiled, but it is still runtime. The `<menu>` and `<window>` elements in `content` describe the desktop the visitor *starts* with, like a normal desktop that restores the same open windows after a restart. This is how preconfigured setups work (convert one file into another, graph an equation, a coding environment) without the visitor configuring anything. Two kinds of menu result:

- **Static menus** (for example a list of blogs): the entries are hard-coded in the XML, rendered as real HTML with real links, so they work without JavaScript and are indexable.
- **Live menus** (file system, version history, messages): the entries come from a source at runtime and could be stale if compiled, so they do not work without JavaScript. Where the page benefits from it (a project's files), a hard-coded snapshot is rendered as a failsafe and replaced by live data once JavaScript runs (1.5).

**Interface.**

| Attribute | Meaning |
|---|---|
| `icon`, `name`, `info`, `date` | Shown in the menu head |
| `auto` | `bool`; grow with content instead of filling the viewport |
| `server` | `bool`; the desk state lives on the owner's backend (used by `/work`) |

Children: `<menu>`, `<window>`.

#### 1.4.1 Menu `<menu>`

**Objective.** Navigate the content of a desk through one consistent panel, whatever the content is: files, posts, messages, commits, editor layers.

**Solution.** A menu has a head (desk icon, name, date, info, and a **map button** when the active tab has a map), tabs (one per `<menu>`), and the content of the active tab. A menu whose `path` is a URI is filled at runtime from that source. Tabs can be added at runtime by plugins (for example a layers tab while a graphic editor window is focused). Foot actions and the map belong to the tab.

**Interface.**

| Attribute | Meaning |
|---|---|
| `name`, `icon` | Tab label |
| `path` | Optional `uri` source: `file:///`, `window:N:/options` (the options of window N as reported by its plugin), or a plugin-defined source |

Children: `<entry>`, `<foot>`, `<map>`.

**Entry `<entry>`** - one navigable item: a file or folder, a message or post, an editor entity, a sub-event.

| Attribute | Meaning |
|---|---|
| `id` | Unique id for references |
| `type` | Free keyword; known values: `File`, `Folder`, `Post`, `Message`, `Note`, `Commit`, `Branch`, `Share` |
| `name`, `info`, `icon`, `date` | Display |
| `data` | The entry's content (text or a media reference) |
| `link` | Where activating it goes (a page, or a window to open) |
| `from` | Origin (author, sender, source) |
| `acts` | Actions available on the entry |
| `open` | `bool`; initially expanded |

Entries nest without depth limit. Sticky nesting: an entry sticks to the top while its children scroll beneath it and the children stick to the bottom of the parent, using `position: sticky`. For a file system the chain of parents (`/`, `/srv`, ...) is the sticky stack, so no separate breadcrumb is needed.

**Foot `<foot>`** - the tool strip at the bottom of a menu tab (create file or folder, upload, compose a message). Children are `<action icon text link>`. A tab with a URI source contributes its own actions.

#### 1.4.2 Window `<window>`

**Objective.** Show or edit one resource in a tile, and let windows connect into workflows: conversion, comparison, mirroring.

**Solution.** A window is a head plus a body. The head, left to right: icon, mime, mode, path, save, split, drag. The body is chosen by the plugin whose trigger (mime, path, mode) matches. If no plugin matches, the body says viewing or editing is not supported for that mime; nothing breaks. An empty window shows an upload area; dropped content is placed in `/tmp` and its mime is detected (3.5.3). Windows declared in `content` are the desk's starting windows.

**Interface.**

| Attribute | Meaning |
|---|---|
| `icon` | Window icon (image or character) |
| `type` | `mime` of the content; empty means undetermined |
| `mode` | `view` (look at it without risking change) or `edit` (modify and preview). To treat a file differently, change its mime (an image as `application/octet-stream` is shown as bytes, as `text/plain` as text) |
| `path` | `uri` of the resource. Empty shows the upload area |
| `flow` | `bool`; show the split control |
| `save` | `bool`; show the save control |
| `full` | `bool`; hide the head and fill the tile |

Head controls:

- **Save** writes the window's data to the virtual filesystem (3.7), at its own path if writable, otherwise at a path the visitor picks (default in `/home/user`). Saving a file from `/tmp` into `/home/user` is how an upload becomes persistent.
- **Split** creates a child window tied to the parent (`path="window:N"`). What the pair does is decided by a **plugin**, from the mimes, paths, types and modes of both windows: for example a converter (child given a mime), a comparator (child given its own resource), or a mirror (child given a mode, such as a text editor beside its live preview). Even a mirror is a plugin, because updating one window must update the other live.
- **Drag** moves the window: choose left, right, top or bottom of another window, or drag the head.

Window ids: `window:N` is 1-based in document order. Processes are addressed by `pid://name` or `pid:N` (3.5.5).

Body kinds are provided by plugins, for example: text (lines or hex bytes, syntax colored), media (browse, content, timeline, tools), graphic editor (slides, layouts), table (sheets, databases), terminal, converter options.

#### 1.4.3 Map `<map>`

**Objective.** Give a graphical road map of what a menu represents, so structure and workflows are visible and navigable intuitively.

**Solution.** A zoomable, pannable node-and-arrow diagram (PlantUML-like) that belongs to a `<menu>`, so the map changes with the active menu tab. A map button in the menu head toggles it: with windows open, showing the map hides them, and toggling again hides the map and shows the windows back. A desk with no windows shows the map by default. A menu that does not need one (messages, posts) simply has no `<map>`, and then has no map button. Nodes are clickable and open their link or window; without JavaScript the map is a nested list of links.

A map is **automatic** or **manual**:

- **Automatic** (`<map/>` with no children, live): the graph is derived from the menu's content and from runtime **resources**. Every window is a resource but not every resource is a window. Converting a file with two windows (input and output) shows three nodes: input window, output window, and the converting process (for example `ffmpeg`); clicking the process node shows its standard streams, as its plugin defines. Processes whose windows were closed but are still running appear as hidden nodes (`pid:3`). Plugins can contribute nodes and edges (an AI workflow, a virtual network whose nodes open `pid://pc0`, the status graph of the owner's server).
- **Manual** (children present, static): the owner writes the graph, for example a static map of the sub-projects of a mega project. It is not live.

**Interface.** `<map layout="tree|flow|graph">` (default chosen by the engine). Children, for manual maps:

- `<node id name icon info link x y>` - a node; `link` is a page or window to open; `x` and `y` are optional fixed positions. Nodes nest to show containment (a project containing sub-projects).
- `<edge from to text>` - an arrow between node ids.

### 1.5 Project `<project>`

**Objective.** Make each project one place that holds its description, its files and history, and its workspace, and let it appear in the expertise automatically in as many skill versions as the owner wants.

**Solution.** A project is a **generator**: from one element the engine produces the project page at `/projects/{id}` (the path is fixed by the type, so only `id` is given), its desk, and its expertise entries. The desk acts as the project's workspace. `repo="~/repo/linux_remake"` assigns the project's repository on the owner's private server (the codebase itself lives there with many repositories); the engine also scans that repository for changes and applies them, unless the project is private. In the virtual filesystem the repository is `/srv/repo/{id}`.

Generated desk menu tabs:

- **Files** - the repository tree. A hard-coded snapshot is rendered as a failsafe if JavaScript fails; at runtime the tab reads the newest data from the server so it is never stale, and it fails (keeping the snapshot with a notice) when the server is down.
- **Version** - the commit and branch timeline; same snapshot and live behavior.
- **Agent** - the agents' conversation for the project; visible only to a signed-in contributor. Likewise, files are editable and programs executable only for a signed-in contributor; everyone else gets a read-only view with in-memory changes.
- the project's description and any windows it declares.

The engine also generates `/projects` (a desk listing every project, a map of them, featured projects as cards).

**Interface.** `<project id name date icon featured role sub short note repo private skill stack>`:

| Attribute | Meaning |
|---|---|
| `id` | Identity; the page is `/projects/{id}`, the repository `/srv/repo/{id}` |
| `name`, `date`, `icon`, `role`, `sub`, `short`, `note` | Display and timeline data |
| `featured` | `bool`; included in the expertise slideshow when no skill is focused |
| `repo` | Repository location on the private server, e.g. `~/repo/linux_remake` |
| `private` | `bool`; when `true` the project is excluded from rendering, watching and generation |
| `skill`, `stack` | `list`; extra skills and stacks for the timeline (slides add their own) |

Children:

- `<slide media alt description skill stack hashtags tags featured private>` - one version of the project for the expertise slideshow (1.3). `media` is the picture, video or diagram; `alt` its alternative text; `description` the explanation (an attribute, or the element's text); `skill` is a `list`, so one slide can serve several skills; `stack` its tools; `hashtags` and `tags` its labels; `featured` makes it the project's default version; `private="true"` excludes it. A slide may contain `<action icon text link primary>` children.
- `<menu>` and `<window>` extend the generated desk.

### 1.6 Event `<event>`

**Objective.** Represent a period or moment of experience, education, certification or competition with its own explanation and sub-events.

**Solution.** An event is a **generator**: one element produces its page at `/events/{id}`, a timeline entry for the expertise, and entries in print modes that list experience or education (1.13). Its desk has only a menu and a main window: the menu lists the event's sub-events as a tree; the main window explains the selected one. Its resources are `/srv/events/{id}` in the virtual filesystem.

**Interface.** `<event id name sub date icon type skill stack featured info note image>` with child `<event>` for sub-events. `type` is `education`, `experience`, `certification`, `competition` or `other`.

### 1.7 Blog `<blog>`

**Objective.** Let the owner publish technical writing that visitors can read and also run, edit and experiment with.

**Solution.** A blog is a **generator**: one element produces the page `/blogs/{id}` and its `<desk auto="true">`; its files are `/srv/blogs/{id}`. Windows whose source is known at build time are pre-rendered into the HTML (markdown as HTML, code as `<pre>`), so search engines and no-JavaScript readers get the article, while JavaScript turns them into live windows. Visitors may edit any window or run any program, but `/srv` is shared and read-only, so edits vanish on refresh; they can copy files to `/home/user`. `/blogs` is generated as a desk listing posts. Blogs are flat (no categories) and are not part of the expertise.

**Interface.** `<blog id name date icon info>` with children `<menu>` and `<window>` (the desk's starting condition). Relative paths in windows (`path="intro.md"`) are resolved from the blog's XML file and published as `/srv/blogs/{id}/intro.md`.

### 1.8 Work page

**Objective.** Give every client one URL for messages, shared files, dashboards, quotations and receipts, while the owner never compiles or stores any client data into the website.

**Solution.** One path, `/work` (or `/work?uuid={uuid}`), with no subpages. It is a static shell with `<desk server="true">`; everything about a client is client-side at runtime from the API (4.3), so nothing is compiled. On first use the client gets an empty work repository, which they see as `/home/user/{id}`; they may move it anywhere in their filesystem, because the virtual filesystem only remaps it and the real repository never changes directory. Menu tabs: **Files** (the repository), **Dashboard** (live project status), **Quotation** (receipts table). The main window is the message stream; files, dashboard segments and quotations can be embedded in messages and pinned as new `view` windows. The owner signs in and the same page shows a menu of all clients (no separate admin path); the owner's own desk state per client is restored.

Sessions: the owner prints a QR code containing `/work?uuid={uuid}` after pre-labelling the client; opening it creates a device session cookie; the client can later sign in with Google to bind the record to the account, after which the UUID alone only shows the name and a sign-in prompt. Merging rule when a Google sign-in meets a UUID session: if one record is empty keep the other; if both have content, refuse and let the owner merge manually. Runtime details are in 3.9 and 4.5.

### 1.9 Theme `<theme>`

**Objective.** Change the whole visual identity of the website (layout, colors, text and icon glyph shapes, motion) without changing any DOM, so themes can be compared and chosen by preference, and so a page is never blank while a theme loads.

**Solution.** A theme is CSS, fonts and an optional script. It may only style the fixed DOM, the empty slots and the shared canvas (2.4.2); it never creates DOM. Every theme provides light and dark modes. Switching swaps CSS, fonts and script only; because all themes share one canvas and the same slots, a transition between themes can animate through them continuously.

**The unnamed theme (skeleton).** A `<theme>` with an empty `name=""` or no `name` is not a selectable theme: its style is written **inline into the HTML of every page**. It supports light and dark mode and paints a **skeleton loading animation** over the real content (the engine knows what content exists and how it is laid out, so the placeholders match it). Visitors therefore never wait on an empty page, and a dark-mode visitor is never hit by a blank white one. It is deliberately tiny because it is in every HTML file. When the real theme has loaded (`html.theme_ready`), the skeleton slides off to reveal the content. Without JavaScript the real stylesheet is linked normally and no skeleton is needed.

**Interface.**

| Element | Attributes | Meaning |
|---|---|---|
| `<theme>` | `name` (empty = skeleton), `color` (browser chrome color, light/dark pair allowed), `js` (module path), `background` (a partial HTML file) | Root |
| `<font>` | `name`, `size` (`WxH`, e.g. `60x100`), `role` (`display`, `body`, `mono`, `icon`) | One generated font |
| `<palette>` | `mode` (`light` or `dark`), `colors` (hex list) | A color table for multi-color glyphs |
| `<sym>` | `char`, `path`, `img`, `width`, `name`, `variant` | One glyph. `char` is one character, a 4-6 digit hex codepoint, or a `[token]`. `path` alone is a single-color glyph; with `<layer>` children it is multi-color; `img` is a bitmap glyph. Repeating `char` with different `variant` defines alternates (ransom-note fonts) |
| `<layer>` | `path`, `color` (palette index or `#rrggbb`), `paint` (gradient) | One color layer of a glyph |
| `<style>` | `src`, `media`, `scope` | SCSS in CDATA or a file. Scoped under `:root[data-theme="name"]` unless `scope="global"` |

SCSS receives the compiler's virtual module `jazu:api` (palette variables, `mode_light`, `mode_dark`, `mode_auto` mixins, and the generated expertise state data). A theme script exports `mount(root, options)` receiving the shared canvas and slots and returning `fade_in`, `fade_out`, `pause`, `resume`, `dispose`; it draws and animates but never creates DOM. Every theme's CSS shows a CSS-only approximation of its background; the script replaces it.

Planned themes (the system is designed for any number): **Default** (sci-fi, clean, vectorized, dithering, contour map, rotating globe, glass), **Memory** (weirdcore/dreamcore, nostalgic operating-system look, ransom-note text), **Frutiger Aero**, **Punk**, and later vaporwave, inkblot and art nouveau. Themes use original assets only.

### 1.10 Plugin `<plugin>`

**Objective.** Make desk capabilities easy to add, replace and manage one at a time, without touching how content becomes the website.

**Solution.** Each `<plugin>` is a root element, normally authored in `content/plugins`. Plugins may share one XML file, occupy separate files, or live in any folder under `content`; the engine discovers them recursively by their root tag, without a wrapper. Relative script and WASM paths resolve from the XML file that declares the plugin. A plugin uses ordered `<case>` children to declare when it applies and which built-in host renders its body. Scripts are optional for custom behavior. Plugins affect only desk runtime features; they never change how the engine generates pages. A plugin may supply any of: a window body, a flow between windows (converter, comparator, mirror or any other relation of a parent and child window), a process, menu tabs and foot actions, and map nodes and edges.

**Interface.** `<plugin id name icon version mime path mode from to flow wasm sha256 script options>`:

| Attribute | Meaning |
|---|---|
| `mime`, `path`, `mode` | Trigger: accepted mimes, uri paths and modes; wildcards allowed |
| `from`, `to` | Conversion edges (mime to mime); they form the conversion graph (3.5.3) |
| `flow` | `list` of flow kinds the plugin provides (`convert`, `compare`, `mirror`, or its own) |
| `wasm`, `sha256` | WebAssembly module location and integrity hash, loaded on demand |
| `script` | Optional behavior script: refines the trigger with custom conditions, loads WASM, adds menu tabs, foot actions, head controls and map nodes, and optionally renders the window body |
| `options` | Schema of the options the plugin reports to a `window:N:/options` menu |

Children: `<case file error view edit mime url host script>`.

| Attribute | Meaning |
|---|---|
| `file` | `bool`; true requires loaded file data, false requires no file, omitted accepts either |
| `error` | `bool`; true matches error windows, default false excludes them |
| `view`, `edit` | `bool`; allowed modes. Omit both to accept either; a true flag allows that mode |
| `mime`, `url` | Comma-separated resource patterns with `*` wildcards; each defaults to `*`. `url` matches the window's resource URI |
| `host` | Built-in body: `text` (lines/colors/hex toggle), `hex` (same editor with hex open), `media`, `shell`, `markdown`, or `default` (upload/error/unsupported) |
| `script` | Optional case-specific script; overrides the plugin's script. Without a script renderer, `host` renders the body |

Cases are checked in document order. The first complete match wins. An exact matching MIME or URL (a matching pattern without `*`) reserves that resource: if its file/error/mode conditions fail, the whole plugin returns no match instead of trying later cases. Thus `<case file edit mime="text/markdown" host="text"/>` before `<case file view edit mime="text/*" host="text"/>` excludes Markdown in view mode. Other plugins can still handle it. Plugin-level triggers, when present, are checked before cases; script-only plugins remain supported.

Examples: text and hex viewer, markdown, media player, graphic editor, table editor, image converter (Magick), Python runtime, shell, archiver, virtual network editor, AI agent window.

### 1.11 Strings and languages

**Objective.** Support many languages without duplicating structure.

**Solution.** A page exists once per language: the same `path` with a different `lang`. The default language lives at the plain path; others at `/{lang}/{path}`. The engine emits `hreflang` alternates and one sitemap entry per language, and generates sitemap pages per language. Interface text (menus, errors) comes from `config.json.languages[lang][id]` string dictionaries with identical keys; a missing key falls back to the default language; a missing page falls back to the default-language page. State generated from the default-language content (ids, slugs, dates, skills) is identical in translations; only display text is translated. A keyword attribute such as an entry `type` is never translated. Print modes match languages the same way (1.13).

### 1.12 Configuration and icon registry

**Objective.** Keep everything that is not an object (pages, projects, ...) in one place, independent of the runtime, and let content refer to icons by stable names.

**Solution.** `{codebase}/config.json` holds all configuration of generation: site and owner metadata used in HTML meta tags, the PWA manifest and structured data; languages and the default; SEO defaults; the icon registry; slot groups and counts; navigation limits; theme order and default; deployment targets; the personal server's address. It is plain JSON, not `package.json`, so switching runtime (Node, Deno, Bun) never touches it. Tokens and other vulnerable values are in `.env`, never in `config.json`.

The **icon registry** (`icons` in `config.json`) maps `snake_case` names to private-use codepoints and is append-only, so a codepoint never changes meaning. An icon is just a character; the engine expands `[name]` to it. A theme missing a registered glyph falls back to the default theme's glyph through font fallback; the default theme must cover every registry entry.

### 1.13 Print `<print>`

**Objective.** Turn pages into useful paper or PDF (a resume, a Japanese resume form, a quotation, a research summary) without printing personal data the owner never published.

**Solution.** `<print>` is a root element like `<theme>`, but it applies only in print mode, and only for the languages it names. A page chooses which one to use with its `print` attribute (`print="resume"`). All print behavior is determined by this element: nothing else in content changes how a page prints. For a page in language L the engine picks the `<print>` named by the page whose `lang` matches best (exact, then prefix wildcard such as `en*`, then `*`).

The engine emits print-only markup (hidden on screen) for pages that name a print mode, using the print mode's layout, and the print mode's styles format it. **Only published information is used.** Personal details come from the website's first `<hero>` (name, `profile` image, and `<item>`s found by their `print` labels); history comes from `<expertise>` (events by `type`, featured projects, skills with their stacks). Any value that is missing is printed as a placeholder (an empty box or line); nothing is invented, and no other personal source exists. This protects the owner: a form such as the 履歴書, which asks for many personal details, can never expose more than the owner chose to publish.

Layouts whose data is not in content (the `quotation`, which prints a client's own receipts) are filled in the visitor's browser at print time from their own session (3.10).

**Interface.**

| Element | Attributes | Meaning |
|---|---|---|
| `<print>` | `name` (the mode: `resume`, `rirekisho`, `quotation`, `research`, ...), `lang` (`list`, wildcards allowed, default `*`), `size` (paper, e.g. `a4`), `layout` (built-in print layout; default is `name`) | Root |
| `<style>`, `<font>`, `<palette>`, `<sym>` | as in `<theme>` | Print appearance, scoped to print mode |

Labels a layout reads from hero items are listed with the layout (for example `rirekisho`: `name`, `kana`, `birth`, `gender`, `postal`, `address`, `phone`, `email`). Dates and age in a printed form are the build date until the browser replaces them with the day of printing (3.10).

### 1.14 Resource files and media

**Objective.** Let windows, slides and pages use the owner's documents and media without the owner maintaining a separate directory.

**Solution.** Any file referenced by an XML element is taken from `content`, published, and made available through the virtual filesystem (3.7) under the path of its owner: a blog's files at `/srv/blogs/{id}`, an event's at `/srv/events/{id}`; a project's code at `/srv/repo/{id}` comes from its repository. Relative references resolve from the XML file that contains them. Unreferenced files are not published.


---

## 2. Engine (`{codebase}/src`)

The engine turns `content` into the static website. Only `{codebase}/src/main.ts` touches runtime-specific APIs (Node.js file system, processes); everything else is plain TypeScript using web-standard APIs, so moving to another runtime (Deno, Bun) only changes `main.ts` and files in `src/node`.

### 2.1 Command wrapper `main.ts`

**Objective.** One entry point to run every engine task, independent of the runtime.

**Solution.** A thin CLI over the engine. Warnings never fail a command unless `--strict`.

**Interface.**

| Command | Purpose |
|---|---|
| `build [--out dist] [--dev] [--force] [--date YYYY-MM-DD] [--only glob]` | Generate the website; incremental by default. `--date` pins "present" and local-time placeholders for reproducible builds |
| `watch` | Rebuild on change |
| `serve [--port]` | Build, then serve `dist` mimicking the hosting rules (rewrites, headers) |
| `check [--strict] [--report tiers]` | Validate XML, links, media, icon tokens, SEO lint, glyph coverage; `--report tiers` writes the capability tier report |
| `graph [--format mermaid\|json]` | Print the dependency graph |
| `icons list\|add\|check` | Inspect and extend the icon registry |
| `theme build <name>`, `font build <theme>` | Build one theme or font |
| `deploy --target pages\|worker\|all [--dry_run]` | Publish to the cloud |
| `new page\|project\|event\|blog\|theme\|print <name>` | Scaffold content |
| `clean` | Remove output and caches |

On the personal server the same entry point also acts as the live build and repository hub (4.8).

### 2.2 Content model

**Objective.** Turn free-form files into one consistent, validated model of pages, languages and relations.

**Solution.** Pipeline: read the files that changed (the first build reads all), wrap multi-root files, parse strict XML keeping line numbers for errors, validate against the schema, resolve (paths, parents and children for breadcrumbs, languages, generators expanded into pages: projects, events, blogs, the listings and the sitemap; skills and stacks detected from references and checked against the expertise vocabulary), expand text tokens, then pass the model to the generators. Errors name the file and line.

**Interface.** The XML schema (this document's attribute tables are its source), and the model types shared by all generators.

### 2.3 Incremental regeneration

**Objective.** Keep rebuild time proportional to what changed, so a huge website stays fast to update, without re-reading or re-hashing every file.

**Solution.** After the first full generation the engine writes `{codebase}/.cache`, which holds:

- the **last compiled time** (one timestamp, instead of one modification time per file);
- the **manifest of source paths** (names only), so deleted and renamed files are noticed;
- the **dependency graph** (which outputs depend on which sources);
- small derived **fingerprints** (see below) and, per repository project, the last scanned repository revision.

Changes are found in two ways:

1. **While running (`watch`, personal server):** native operating-system file events. Events are debounced (editors save by writing temporary files and renaming). If the system reports an overflow or a burst (a branch switch touching thousands of files), the engine falls back to the stat sweep below.
2. **At start (no watcher was running):** a stat sweep of the source tree (no file is read): every file whose modification time is after the last compiled time is changed; every path in the manifest that no longer exists is deleted; every path not in the manifest is new. Only changed sources are read and parsed.

**Version control.** Restoring files through git (checkout, revert, reset, stash pop) rewrites them with the *current* time as modification time, so both mechanisms see them as changed. Operations that preserve old times (`cp -p`, `rsync -t`, `tar`, `unzip`, `mv`, restoring a backup) can be missed by the time comparison. Therefore, when `content` is inside a git repository the cache also stores the repository's `HEAD`; at start, if `HEAD` moved, the changed files are listed exactly with `git diff --name-only {old} {new}` (this also covers deletions and old-timestamp restores) and added to the time-based set. Project repositories named by `repo` are tracked the same way (their `HEAD` and refs), which is how the engine applies repository changes to the Files and Version tabs' snapshots.

**Propagation.** A changed source marks its outputs dirty through the graph. A page depends on its XML, its parents' names (breadcrumbs), its children's names (dropdown), the navigation candidate set, the icon registry, slot configuration, default theme and its language's strings. The portfolio depends on a *fingerprint* (id, name, date, icon, skill, featured and slide skills) of every project and event: it is recomputed from the changed project and compared with the stored one, so editing a project's body does not rebuild the portfolio. "Present" dates resolve to the build month; a scheduled monthly rebuild keeps them current.

**Hashes.** SHA-256 is not used to detect source changes. Output files still get a content hash in their names (so browsers cache them forever and never see stale files), and WASM modules carry a hash for integrity (3.5.4).

### 2.4 Web app generator (`{codebase}/src/web`)

**Objective.** Generate every page as HTML (and as data for client navigation) from the same model, and render dynamic runtime content (menus, messages, files) safely in the browser with the same components.

**Solution.** TSX with a custom JSX factory. The factory does not build strings: it returns small **virtual nodes** (`tag`, attributes, children). Each XML element has one render function (`hero`, `expertise`, `desk`, `window`, ...) that returns virtual nodes. Two renderers consume them:

| Renderer | Runs in | Output | Safety |
|---|---|---|---|
| `to_html` | Build (and on the personal server) | HTML string | Escapes all text and attribute values; raw HTML only through an explicit `raw()` marker used for trusted, first-party generated fragments |
| `to_dom` | Browser | Real DOM with `document.createElement`, `textContent` and `setAttribute` | Never uses `innerHTML`, so runtime data (messages, file names, file contents) cannot become markup |

The same TSX therefore runs on Node (strings) and in the browser (DOM) without a DOM implementation on the server. Static pages are rendered once at build; the browser receives them as HTML for the first load and as compact data (a serialized virtual-node tree, `[tag, attributes, ...children]`) for SPA navigation, and builds the DOM from that data with `to_dom`, so no HTML string is ever parsed at runtime. Dynamic parts (live menus, the message stream, map) run the same components in the browser with `to_dom`.

#### 2.4.1 Document skeleton

Every page has the same structure: head (SEO, color scheme, the **inline skeleton style** of the unnamed theme (1.9), theme link loaded without blocking, font preload, inline boot script), background layer (shared canvas plus slots), foreground layer (slots), header, main, footer, cookie notice, no-JS explanation. Names are fixed; themes style them.

#### 2.4.2 Slots and shared canvas

**Objective.** Let any theme decorate and animate without creating DOM, and let themes hand over to each other fluently.

**Solution.** The engine emits empty elements in configurable groups (default `background_entity` and `foreground_entity`, ten each, numbered `_00` upward) and one shared canvas in the background layer. Themes style the slots with CSS and pseudo-elements and draw on the same canvas, so a theme switch keeps the same elements and the new theme continues from where the old one is. Raising the count never breaks existing themes.

#### 2.4.3 Header

**Objective.** One navigation structure on every page that themes can lay out freely.

**Solution.** Seven flat sibling parts so any theme can grid-place them:

1. **Menu button** - visible when the page has a desk; toggles the menu.
2. **Skip link** - visible on focus; jumps to main content.
3. **Signature** - the owner's signature card, the only inline SVG, linking home, with a text fallback.
4. **Divider** - the `>` between breadcrumbs; opens the page dropdown.
5. **Breadcrumbs** - path from the root; the last crumb is the page `name`.
6. **Tabs** - the page's sections (hero, expertise, ...) or its windows; a bottom bar in portrait.
7. **Actions** - contextual actions of the focused window plus fixed controls: new window, account, language, theme.

**Dropdown rule.** The divider after crumb C lists C first (marked current when applicable, like `..` in a listing), then C's children (pages exactly one path segment deeper) in the current language. No-JS order: `rank` descending, then name; at most 10 items, then a link to the sitemap. With JavaScript the order is by recent visits (stored locally), and a search field appears when there are more than 10 candidates (3.3). Account, language and theme menus are `<details>` elements; language is plain links and works without JavaScript.

#### 2.4.4 Section generators

- **Hero**: renders tags as stacked spans cycled by a CSS keyframe animation; the first tag is static; an accessible label contains the full list.
- **Expertise**: detects entries from events, projects and slides; applies the declared vocabulary; computes at build time, per scenario (all, or each skill): date ranges, axis scale (min and max padded by three months, snapped to years, newest on top), lanes (greedy interval partitioning, lane 0 nearest the axis, extra lanes to the left), equal-spaced indices for portrait, year gridlines, the slideshow order and the version of each slide per skill, and the filter strips (skills of a slide's project, stacks per skill). Each entry carries inline custom properties per scenario (`--top_x`, `--span_x`, `--lane_x`, `--index_x`); CSS picks the scenario by the checked radio. A stack filter hides entries inside the current skill scenario without recomputing positions. All slide versions are in the HTML; the checked skill and the address hash decide which is visible.
- **Desk**: renders static menus and the starting windows as real HTML; pre-renders windows whose source is known at build time (markdown, text, images, code as `<pre>`); renders failsafe snapshots of live menus; emits manual maps as nested link lists.
- **Project, event, blog**: expand into the above.
- **Print**: emits hidden print markup for pages with a `print` attribute (1.13), from the first hero and the expertise only.

#### 2.4.5 Page data and output layout

Each page also emits `index.json` containing title, head tags marked for swapping, breadcrumbs, tabs, action context and the main content as a virtual-node tree, used by SPA navigation (3.2).

### 2.5 Theme compiler

**Objective.** Turn theme XML and SCSS into scoped, hashed, lazy-loadable CSS.

**Solution.** Compile SCSS with `sass`; inject the virtual `jazu:api` module; scope every rule under `:root:where([data-theme="name"])` (low specificity so themes coexist and a fading theme can overlap the next); lift at-rules (`@font-face`, `@keyframes`) out of the scope; hash asset references; emit light and dark logic through the `mode_*` mixins and the `data-mode` attribute (`auto`, `light`, `dark`). CSS follows a block-element-modifier naming scheme and is written so most selectors are O(1): state is held by input elements or by a class on a parent and by IDs. Compression and rule-by-rule comparison tools exist for development.

### 2.6 Font and icon pipeline

**Objective.** Render text and icons from generated fonts, so changing a theme's look is changing a font file, not generating SVG in JavaScript, with no language other than TypeScript in the toolchain.

**Solution.** A TypeScript font builder (`src/font`) that writes the font binary itself: a small OpenType table writer for the tables a font needs (`head`, `hhea`, `maxp`, `OS/2`, `hmtx`, `cmap`, `name`, `post`, outlines, plus the optional color and layout tables below), then WOFF2/WOFF packaging with the runtime's built-in compression. For each `<font>`:

1. Resolve glyphs (single character, hex codepoint, or registry token; duplicate codepoints are errors; multi-character strings are rejected so no accidental ligatures occur).
2. Convert SVG path data to outlines with y flipped and no auto-scaling; metrics from the cell size (`units_per_em` is the cell height, advance is `width` or the cell width).
3. Build monochrome base outlines (so every file is a valid plain font).
4. Build color layers: COLRv0 with CPAL (baseline), optionally COLRv1 with gradients, optionally OpenType-SVG.
5. Build palettes (palette 0 light, palette 1 dark, selected in CSS with `font-palette`).
6. Build contextual alternates (`calt` substitutions) for variant glyphs.
7. Serialize WOFF2, WOFF and optional TTF with hashed names; emit `@font-face` rules as cascading declarations (never unknown `tech()` syntax inside a shared `src`).

**Format ladder** (best first): COLRv1, OpenType-SVG, COLRv0 plus CPAL (baseline), monochrome WOFF2/WOFF, system font fallback. Every icon-only control also has a text label that stays available to assistive technology.

**Checks.** Every registry icon exists in the default theme; no duplicate codepoints; glyphs inside the cell; lookalike glyphs (I, l, 1, O, 0) are distinct; icon contrast in light and dark is at least 3:1.

### 2.7 SEO generator

**Objective.** Make every page discoverable and well presented by search engines, scrapers, browsers and language models, with no per-site SEO code.

**Solution.** Derived entirely from `base_url`, the owner config, the pages and the default theme:

- **Head**: description, keywords (legacy), author, robots, canonical, `hreflang` with `x-default`, Open Graph, Twitter card, JSON-LD (`WebPage`, `ProfilePage`, `BlogPosting`, `SoftwareApplication`, `WebSite`, `BreadcrumbList`, owner `Person` or `Organization`), browser chrome (theme color for light and dark, color scheme, viewport with `viewport-fit=cover`, mobile web app tags, format detection, tile color, manifest, icons). Page-specific tags are marked so SPA navigation swaps exactly those.
- **Icons**: from `content/icon.svg` (falling back to media icons or the signature): `icon.svg`, `favicon.ico`, Apple touch icon, 192, 512 and maskable 512 PNGs.
- **Cover images**: every page gets a 1200x630 image drawn with the default theme's own glyph paths; cached; the `og:image` URL carries a content hash.
- **Root files**: `sitemap.xml` (canonical pages, language alternates, `lastmod`), `robots.txt`, `manifest.json` (installable, shortcuts from top pages), `llms.txt` and `llms-full.txt`, `security.txt`, `_headers` (types, caching, CSP hashes), `_redirects`.
- **Lint**: `check` warns on title and description length, duplicates, missing icons or security contact, invalid `lastmod`.

### 2.8 Web app methods

Principles that every generated page follows. Each is a component with its own objective.

| Method | Objective | Solution |
|---|---|---|
| **Accessibility** | Usable on any device by anyone | WCAG 2.2 AA target; keyboard-, remote- and mouse-only operation; skip link; focus moved to the main heading on navigation with a polite live announcement; reduced motion and transparency respected; separators and tabs follow ARIA roles |
| **Compatibility** | Work on modern, legacy and restricted browsers | Three tiers (below); every modern CSS feature has a defined fallback; scripts are classic scripts, not modules, so a wrong MIME type on `.js` does not break them |
| **Multi-theme support** | Show interface designs and honor user preference | Same DOM, switch CSS and fonts only (1.9); no DOM exists for the sake of one theme |
| **Custom fonts for text and icons** | A theme controls glyph shapes, not just colors | Generated fonts (2.6) |
| **CSSOM optimization** | Fast style matching | BEM-like names, O(1) selectors, state on parents or IDs |
| **No-JS navigation** | Usable with JavaScript disabled (Tor Safest) | Radio and checkbox state, anchors as tabs, `<details>` menus, scroll-snap sliders; only truly dynamic features (desk actions, work) need JavaScript and show an explanation without it |
| **SEO** | Discoverability | 2.7 |
| **Single page app** | Instant navigation without losing normal links | The first load is fully rendered; plain left-click on a same-origin link is intercepted and the page's JSON is fetched and swapped in; modified clicks, `target`, `download`, and `/api` links are never intercepted (so open in new tab works) |
| **Progressive web app** | Installable, native-feeling | `manifest.json` and icons; offline support is a design goal of the desktop mode (the offline version of the site) |

**Capability tiers.**

| Tier | Needs | Works |
|---|---|---|
| 0 No JS, baseline CSS | HTML and basic CSS | All content, links, `<details>` menus, anchor tabs, expertise filtering, scroll-row slider, static timeline, print, light/dark from system, default theme |
| 1 CSS enhanced | Modern CSS | Timeline geometry, slider paging, container queries, `dvh`, color fonts and palettes, view transitions |
| 2 JavaScript | `fetch`, History API | SPA navigation, theme switching and canvas, dropdown search, desk, work, sound |

Thresholds are generated, not hand-written: `check --report tiers` scans the emitted CSS and JavaScript, uses browser-compatibility data, and writes each feature with its minimum browser versions, tier and fallback.

### 2.9 Output `{codebase}/dist`

**Objective.** A static website that can be uploaded to any static host unchanged.

**Solution.** Everything is static and `dist` is the host root: HTML and `index.json` per page, hashed CSS, fonts, theme and runtime scripts, WASM and large media prepared for object storage, manifest of the generated home mount, SEO files, `_headers`, `_redirects`. Referenced resources only.

### 2.10 Desk toolchain (`{codebase}/src/desk`)

**Objective.** Run real GNU/Linux or Windows programs in the browser without a virtual machine.

**Solution.** Scripts (Bash for Linux, Batch for Windows, otherwise TypeScript) that compile or package applications into WebAssembly modules, producing the `wasm` files that `<plugin>` entries reference. This is the only part of the codebase not restricted to TypeScript.

---

## 3. Client runtime (`{codebase}/src/web/client`)

Browser code shipped with the generated website. Plain scripts, no framework, lazy chunks.

### 3.1 Boot

**Objective.** Set first-paint state before styles apply, without a flash.

**Solution.** A tiny inline script (hash added to the content security policy) that adds the `js` class, marks the intro, restores `data-theme` and `data-mode` from local storage, and loads the real theme stylesheet without blocking so the skeleton (1.9) shows meanwhile; when the stylesheet is ready it sets `html.theme_ready`.

### 3.2 SPA navigation

**Objective.** Make page changes instant while keeping links real.

**Solution.** On an eligible click: fetch `{path}/index.json` with a 3 s timeout (on failure, navigate normally); swap title, SEO tags, breadcrumbs, tabs, action context and main (the content tree is turned into DOM with `to_dom`, never parsed from a string); update history; move focus to the main heading and announce the title; restore scroll (top for new pages, saved on back and forward); never replay the intro; hydrate the new DOM (desk, expertise); prefetch on hover or focus when the connection allows.

### 3.3 Header menus and search

**Objective.** Fast, learned navigation.

**Solution.** Dropdown ordering by recent visits (local only, at most 50), search over `nav_index.json` (path, name, info, rank, language) with a scored subsequence match (name prefix, word prefix, subsequence, info substring), keyboard operation (type, tab to results, Enter follows, Esc closes).

### 3.4 Theme switcher

**Objective.** Change theme and mode smoothly and safely.

**Solution.** Lazy load the theme's CSS, fonts and script; fade out the old theme on the shared canvas; set `data-theme`; update both browser-chrome color tags; save the choice locally; fade in the new theme from the same canvas and slots; announce the change. Mode `auto` follows the system.

### 3.5 Desk runtime

**Objective.** Execute everything a `<desk>` promises: tiling, windows, conversion, files, processes.

**Solution.** The following parts.

#### 3.5.1 Layout

State is a binary tree of splits (horizontal or vertical, with a ratio) and leaves (windows). Separators are focusable `role="separator"` elements; arrow keys change the ratio by 2% (10% with Shift), minimum pane 12%. Moving a window removes its leaf and inserts a split around the target: the pointer's position within the outer 25% of a tile picks the edge, otherwise the windows swap. A flow child is inserted to the right (landscape) or as a new tab (portrait). Portrait ignores the tree: windows are tabs. The menu is outside the tree.

#### 3.5.2 Window manager

Creates the starting windows from XML and new windows from the new-window control, runs the head controls (save, split, drag, mode), asks the plugin loader for the body and, for split windows, for the flow plugin, and persists layout and window state.

#### 3.5.3 Mime detection, plugins and conversion graph

Detection order: declared mime; magic bytes (PNG, JPEG, GIF, WebP, PDF, ZIP, ELF, PE and others); file extension; valid UTF-8 means `text/plain`; otherwise `application/octet-stream`. Each plugin's `from` and `to` are edges (converter flows); conversion search is a lowest-cost path (cost per hop plus module size), multi-hop conversions run as a pipeline through temporary files. No path shows "No conversion from X to Y".

#### 3.5.4 Plugin loader and WASM execution

Plugins are looked up by trigger. WASM modules are fetched on demand, verified with their `sha256`, cached by id and version, and run in a Web Worker with a WASI-style shim (arguments, environment, standard streams, the virtual filesystem as preopened directories). Progress is reported by messages and a run can be cancelled by terminating its worker. Only requested modules are loaded.

#### 3.5.5 Kernel, processes and shell

A kernel without DOM: text streams, a process table, start, kill and interrupt. Every program except the shell's inline commands runs as a process with its own pid and its own stdin, stdout and stderr. The shell (bash-compatible: pipes, redirects, environment, `cd`, `pwd`, `export`, history, jobs, `PATH` lookup) is a program too, and a shell started inside a shell is a child process; `ps`, `kill` and `/proc` see them. A window with `path="pid://name"` (or `pid:N`) is a terminal for that process; `pid://name:/stdout`, `:/stderr`, `:/stdin` show a single stream, so two streams can be flowed side by side. Typing `pid:` in an empty window starts a shell. Closing the last window on a process ends it. Plugins can register named processes (a virtual network node `pid://pc0`). Sessions persist like tmux: transcript, working directory, environment and history are saved and restored, running processes are not.

#### 3.5.6 Syntax coloring

Text windows color code by mime (C, C++, JavaScript, TypeScript, Python, shell, JSON, CSS, HTML, XML, Markdown, CSV). The edit mode uses a colored layer under a transparent textarea. Files over 300 KB stay plain.

### 3.6 Map runtime

**Objective.** Draw and navigate the map (1.4.3).

**Solution.** For an automatic map, builds the graph from the active menu's content and from the live resource table (windows, processes, plugin-provided intermediate nodes, hidden nodes for running processes without a window); for a manual map, reads the authored nodes and edges. Lays it out with the map's `layout`, renders pan, zoom and click, subscribes to window, split and process events so automatic maps stay live, and falls back to the static link list without JavaScript. The menu head's map button toggles between the map and the windows.

### 3.7 Shared virtual filesystem

**Objective.** One file tree that every desk, window, process and plugin sees, that looks like a single shared system, and that never stores a visitor's private data on the owner's servers.

**Solution.** The filesystem is an illusion built from several sources behind a mount table over a memory root: the root directory is mostly hard-coded and everything below it loads lazily, so what looks like one big shared filesystem is an accumulation of separate parts. Visitors can run `pid:` to start a shell, work with shared files such as `/srv/blogs/python/01`, and run `python sample.py`. The API is POSIX-like (`stat`, `readdir`, `read`, `write`, `mkdir`, `rm`, `rename`, `watch`) with POSIX-like errors (`ENOENT`, `EROFS`, `EACCES`). `file:///` URIs resolve into it, and menus read it with `readdir` and `watch`. This is the same tree on `/desk`, `/work`, `/projects` and every other desk.

| Mount | Backing | Writable | Persistence |
|---|---|---|---|
| `/home/user` | The visitor's own: browser file system, or a folder picked with the File System Access API, or mirrored to their Google Drive; the work repository is `/home/user/{id}` | yes | persistent, private to the visitor |
| `/srv/blogs/{id}` | Published blog files, read-only HTTP mount, lazy | in-memory overlay | vanishes on refresh |
| `/srv/events/{id}` | Published event files, same | in-memory overlay | vanishes on refresh |
| `/srv/repo/{id}` | The project's repository on the owner's server (through the API) | contributors only; others get an in-memory overlay | server for contributors |
| `/bin`, `/usr` | Stubs and data, one per plugin | persistent overlay | local |
| `/tmp` | Memory | yes | none |
| `/proc`, `/dev` | Kernel (`null`, `zero`, `random`, `tty`, process table) | | |

**Privacy rule.** New uploads and anything a window creates land in `/tmp`, so nothing private persists in the site; it is deleted when the page closes unless the visitor saves or drags it into `/home/user`. `/home/user` is accessible only to that visitor. Signed-in contributors (the owner, partners, clients on their repositories) may edit and execute inside the repositories they have rights to; everyone else has read-only views whose edits are overlays. `/desk` is strictly client side: no file bytes reach the owner's servers.

### 3.8 Accounts and persistence

**Objective.** Let visitors keep their desk and clients bind their sessions, without the owner holding visitors' files.

**Solution.** Not signed in: `/home/user` is in the browser (optionally a local folder). Signed in with Google: `/home/user` is in the user's own Drive (scopes `drive.file` for created files and `appdata` for desk state); on login, browser files can be transferred; conflicts resolve by newest modification and the loser is kept as `name (conflict DATE)`. The Drive token lives only in memory and is never sent to the owner's servers. **Save** writes into the virtual filesystem (1.4.2); downloading to the device is a file action in the menu. Preferences (theme, mode, language, recent pages, cookie notice) live in local storage; the cookie notice is a popup with JavaScript and a footer line without.

### 3.9 Work client

**Objective.** The client-side half of `/work` (1.8).

**Solution.** Claims a UUID, creates the empty work repository as `/home/user/{id}` (remappable anywhere in the virtual filesystem), shows the limited view until sign-in, runs the message window (WebSocket with a polling fallback of 5 s backing off to 30 s, idempotent sends, catch-up after reconnect), embeds and pins components as windows, renders the Quotation and Dashboard tabs from the API, and saves the client's or admin's desk state with optimistic concurrency.

### 3.10 Print runtime

On `beforeprint`, replaces the build-date placeholders (date and age) with the day of printing, and fills layouts whose data is not in content (the quotation prints the client's own receipts, read from their session). No other script is needed for printing.


---

## 4. Cloud and IoT (`{codebase}/src/node`)

The compiled scripts here run on cloud nodes: the Cloudflare Worker, Pages, and the owner's personal server. The domain is the owner's (for example `jasouza.com`); Cloudflare provides hosting, storage, database, mail and zero trust.

### 4.1 Static hosting

**Objective.** The website keeps working even if every owner-run server is offline.

**Solution.** `dist` is generated beforehand and hosted on Cloudflare Pages, a static host with no server to maintain. Heavy files (media, WASM, shared files) are in Cloudflare object storage (R2) and reached through the Worker.

### 4.2 Dynamic routing (central Worker)

**Objective.** Add capabilities beyond static files without disturbing existing routes, and make routing configurable.

**Solution.** One Worker bound to `{domain}/*` and `*.{domain}/*`. Static files are served by Pages; the Worker handles the rest in this order: subdomain rules, `/assets`, `/api`, `/work` shell, everything else to Pages. Pages that are dynamic yet need SEO and are not user specific can be routed to another server. Unassigned subdomains show the normal empty page.

| Match | Action |
|---|---|
| `{app}.{domain}` where `app` is a project | `301` to `/projects/{app}` (the same content is never served from two hosts, so search engines do not flag duplicates) |
| `{name}-demo.{domain}` | Proxy to the demo server registered for that name (configurable without redeploying) |
| `{name}-work.{domain}` | Proxy to the personal server hosting that client's website |
| other subdomain | Empty page, `404` |
| `/assets/*` | Object storage with long caching for hashed names, correct `Content-Type` (WASM needs `application/wasm`) and CORS |
| `/api/*` | API forwarding (4.3) |
| `/work` | The work shell (a single static page), `Referrer-Policy: no-referrer`, `noindex` |

Subdomains are capped at two levels because free Cloudflare certificates do not cover deeper ones, so a hyphen replaces the second dot (`*-demo`, `*-work`).

### 4.3 API forwarding

**Objective.** One uniform JSON API in front of many servers, so APIs can be added or moved without breaking clients.

**Solution.** Path `/api/{version}/{resource}/{id}/{subresource}?{query}`, for example `/api/v1/clients/123/receipts?status=pending&sort=desc`. Resource names are plural; the query never identifies a resource. The Worker keeps a table from resource to backend, checks authentication and rate limits, and calls the backend adapter (database, object storage, durable object, or the personal server). Errors are `{ "error": { "code", "message" } }` with the matching HTTP status. Responses are `no-store` except versioned public reads. When the personal server is unreachable the response is `503` with the latest cached snapshot and `stale_since`. Calls to the personal server carry an HMAC-signed header (timestamp, client id, body hash) so it trusts only the Worker.

| Resource | Backend | Access |
|---|---|---|
| `auth` | Worker (token verify, session cookie) | public, creates a session |
| `session` | Worker and database | session |
| `clients` | Database | admin |
| `messages` | Database and durable object | session or admin |
| `files` | Object storage and database index | session or admin |
| `receipts` | Database | session (own) or admin |
| `desk_state` | Database | session (own) or admin |
| `dashboards` | Personal server with cached snapshot | session (own) or admin |
| `git` | Personal server | public for public projects, admin for private |
| `health` | Worker | public |

Rate limits (adjustable): authentication 10/min per IP, claim 20/min per IP, messages 60/min per client, files 20/hour per client.

### 4.4 Data stores

| Store | Holds |
|---|---|
| Static `dist` | Pages, JSON, CSS, scripts, fonts, SEO files, home manifest |
| D1 (SQL) | `clients` (id, uuid hash, slug, name, icon, google subject, email), `device_sessions` (hashed token, label, last seen, revoked), `messages` (client, idempotency id, author, kind `text`/`file`/`dashboard`/`receipt`/`pin`, body, ref, soft delete), `files` (R2 key, name, mime, size, hash), `receipts` (code, provider, amount in minor units, currency, status `paid`/`pending`, note, dates), `pins` (message, window JSON, position), `dashboards` (name, source path, last snapshot), `desk_state` (per client and owner, JSON, version), `admin_audit` |
| R2 (objects) | `clients/{client_id}/files/{file_id}`, `wasm/{plugin_id}/{version}/...`, `media/{hash}.{ext}`, `srv/{blogs|events}/{id}/{path}`, `backups/d1/{date}.sql` |
| KV | Demo registry, feature flags, dashboard snapshots, rate-limit counters |
| Durable object | One chat room per client: sockets and last event id (state rebuildable from the database) |
| Personal server | Git repositories, custom services |
| Browser | File system, WASM cache, preferences; never uploaded |
| Google Drive | Signed-in visitors' desk files and state; owned by them |

IDs are sortable ULIDs; the client UUID (v4) is the QR secret. Timestamps are Unix seconds.

### 4.5 Authentication and authorization

**Objective.** Identify clients and the owner without passwords and without tenants seeing each other.

**Solution.** Google Identity Services in the browser; the Worker verifies the ID token (signature, audience, expiry) and finds or creates the client by Google subject, merging with a UUID session under the rule in 1.8 or answering `409`. The owner is a Google subject on an allow-list kept as a Worker secret. The session cookie is `__Host-`, `HttpOnly`, `Secure`, `SameSite=Lax`, holds an opaque id whose hash is stored, and expires after 30 idle days. Mutating requests need a custom header. Every query is filtered by the client id derived from the session, never from client input (except for the owner). The UUID is a bearer secret (122 random bits); the URL is rewritten to `/work` after the cookie is set and the owner can rotate it. The owner's actions are written to `admin_audit`.

### 4.6 Chat

**Objective.** Real-time messaging that keeps working when the personal server is down.

**Solution.** The database is the source of truth; the durable object only fans out and tracks presence. A client socket sends a message with a client-generated id (idempotency), the room inserts it, acknowledges, and broadcasts to every socket of that client including the owner's. Reconnecting fetches `after={last_id}`. Edits and deletes are soft. The owner is notified by email through a debounced send (at most one per client per ten minutes).

### 4.7 Security

| Area | Rule |
|---|---|
| Headers | HSTS, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (`no-referrer` on `/work`), minimal `Permissions-Policy`, `frame-ancestors 'none'` |
| CSP | `default-src 'self'`; scripts `'self'`, `'wasm-unsafe-eval'` and the hash of the boot script; styles `'self'` with inline style attributes only for generated custom properties; images `'self' data:`; fonts `'self'`; connections `'self'` plus Google domains; frames only for Google sign-in |
| Uploads | Size caps, mime sniffing, random storage keys, downloads as attachments except images |
| XSS | Messages are text; markdown renders with HTML disabled; only first-party scripts |
| Isolation | Cross-origin isolation is off; if threaded WASM is needed it is enabled for desk paths only |
| Secrets | Cloudflare secrets only; never in the repository |

### 4.8 Personal server

**Objective.** Own the development workflow: repositories, builds, agents and live dashboards, without making the public website depend on them.

**Solution.** The same `main.ts`, running on the owner's machine (using ElectronJS as a virtual browser where needed), reached through Cloudflare Tunnel and zero trust. It provides:

- **Live build and push** to Pages.
- **Repository hub** for `/projects` (public or private) and `/work` (client, private): anyone can `git clone {domain}/projects/calculator` unless the project is private; clients push to their own repository; partners collaborate on projects; ssh to the domain is possible. Public project content is in the static website; private content and pushes go through the Worker to the server.
- **Custom CI/CD** and **AI agents** for complete development capability.
- **Desk integration**: a project's repository (`repo`, e.g. `~/repo/linux_remake`) is `/srv/repo/{id}` and appears in the `Files` tab, its history in `Version`, the agents' conversation in `Agent` (contributors only), the server status in a map. The engine watches these repositories and applies their changes unless the project is `private`.
- **Origin contract** (all requests HMAC signed): `GET /git/{project}/refs`, `/tree/{ref}/{path}`, `/blob/{ref}/{path}`, `/log/{ref}`; `GET /dashboards/{client}/{name}` returning widgets `{title, kind, data, updated_at}`; `GET /health`.

If the server goes down, git pull and push stop and live dashboards show their last snapshot, but the website, messages and receipts keep working.

### 4.9 Mail, analytics and delivery

- **Email**: Cloudflare Email Routing forwards `{name}@{domain}` addresses to a private mailbox, protecting it from spam; notices to the owner use the Worker's send binding.
- **Analytics**: cookieless Cloudflare Web Analytics and zone analytics, plus Google Search Console. No analytics that needs a consent wall.
- **Delivery**: a push to the main branch runs check, build (cache restored), tests, then deploys Pages, the Worker and database migrations; a monthly schedule rebuilds so "present" dates stay current.

---

## 5. Codebase layout

```
{codebase}/
  config.json             site, owner, languages, icons, slots, themes, seo, deploy (no secrets)
  .env                    tokens and vulnerable values
  .cache/                 incremental build state (2.3)
  content/                page XML/resources; blogs/, media/, theme/ (see 1.0)
  src/
    main.ts               command wrapper (2.1)
    *.ts                  engine core: xml, schema, model, cache, graph, icons, check, seo
    web/                  page generators (TSX) (2.4) and
      client/             browser runtime (3)
    node/                 Worker, Pages functions, personal server (4)
    desk/                 WASM toolchain (2.10)
    font/                 TypeScript font generation (no Python helpers)
  dist/                   generated website (2.9)
```

---

## 6. Changes from the existing codebase

| Area | Existing | Target |
|---|---|---|
| Content structure | Folders such as `pages`, `themes`, `home_jason` carry meaning | No fixed structure (1.0) |
| Landing, contact, error | `<landing>`, root `<contact>`, separate error sections | One `<hero>` (1.2); the greeting belongs to the theme |
| Contact entries | nested `<contact>` | `<item>` |
| Expertise | `<skill>`, `<stack>`, `<event>` written inside `<expertise>` with `featured_chips` | Expertise generated from the whole website (1.3); vocabulary and events are top-level content |
| Projects and events | Ordinary `<page>` elements with many attributes | `<project>` and `<event>` generators (1.5, 1.6) |
| Desk side panel | `<side>` | `<menu>` |
| Desk map | none | `<map>` inside `<menu>` (1.4.3) |
| Window modes | `text`, `view`, `edit` | `view`, `edit` only; use mime to choose bytes or text. `keep` removed, `save` writes to the filesystem |
| Window paths | `shell:N`, `pid:N` | `pid://name` and `pid:N` |
| Desk tools | `wasm/registry.json` | `<plugin>` (1.10) |
| API path | `/api/{resource}/{version}` | `/api/{version}/{resource}/{id}/{subresource}` |
| Source layout | flat `src/`, `client_*.ts` | `src`, `src/web`, `src/web/client`, `src/node`, `src/desk` |
| Names | `jasouza` identifiers and files | `jazu` (synthetic root, virtual module, CLI) |
| Configuration | Scattered, in `package.json` and code | `config.json` (secrets in `.env`) |
| Cache | Per-file times and hashes | `.cache`: last compiled time, path manifest, graph, fingerprints, repository revisions (2.3) |
| Print | `<resume>`, per-page print styles | `<print>` root and a page's `print` attribute (1.13) |
| Blogs | Plain pages under `/blogs` | `<blog>` generator, files at `/srv/blogs/{id}` (1.7) |
| Skills and stacks | Root or expertise children with fixed lists | Detected from entries, declared and grouped only inside `<expertise>` (1.3) |
| Slides | Fields of the project | `<slide>` children of `<project>`, one per skill (1.5) |
| Filesystem | `/home/{owner}` and `home_jason` | `/srv/blogs`, `/srv/events`, `/srv/repo`, `/home/user`, `/tmp` (3.7) |
| Work | `/work/{client}` admin page, snapshots | One `/work` path, everything client-side (1.8) |
| Rendering | HTML strings in browser and build | Virtual nodes with `to_html` and `to_dom` (2.4) |
| Fonts | Python helper | TypeScript only (2.6) |
| Theme | First paint waits for default theme | Inline skeleton theme (1.9) |
| Page structure | Some theme-specific DOM | Theme-ambiguous DOM only; no DOM created for a theme (2.4.2) |

## 7. Migration decisions

- Existing public URL slugs, skill/stack ids and theme CSS classes are preserved during migration, including inherited hyphens. New internal TypeScript identifiers and new files use snake_case. Changing public slugs requires redirects, not silent renames.
- Font generation uses the TypeScript table writer in `src/font` and Node zlib/Brotli. Existing monochrome WOFF/WOFF2 and COLRv0/CPAL formats are migrated; COLRv1, SVG/bitmap glyphs and contextual alternates are unimplemented and outside finalization. Obsolete Python icon assemblers were removed; authored paths remain in theme XML.
- The engine currently uses Node filesystem/process APIs in multiple modules. Runtime portability remains explicit work. The TSX generators now share virtual nodes between build HTML and browser DOM rendering.
- Supplied media remains a local owner archive, as it was ignored by generation 11. Only signature.svg is source-controlled. Referenced assets are copied into the build; a clone without the archive reports missing assets.
- The old print form’s sample personal values are discarded. Missing fields stay empty, and the published hero is the only source of personal print details.

- Deployment staging splits oversized media into R2 uploads while small content-hashed media can remain on Pages. The Worker checks R2 first under `/assets/media` and `/assets/wasm`, then falls back to the distinct Pages origin. This preserves one URL regardless of storage tier and handles inherited videos above the Pages upload limit.
- The initial personal node exposes only explicitly allow-listed **public** repositories over signed read APIs. Native Git clone/push, contributor authentication and private repositories require the later authorization/transport work. No repository location is published into static content.
- Client UUID bearer values are represented as hashes in the initial SQL schema (`uuid_hash`), improving the original plan to store a UUID secret directly. The API that claims/rotates them remains planned.

- The migrated featured fragment remains `#expertise/{project_id}` while skill fragments remain `#{skill}/{project_id}`. The planned `#all/{project_id}` and radio-based filtering are part of the remaining expertise transition; existing bookmarked fragments stay usable.
