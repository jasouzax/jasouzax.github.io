# Desk, menus, windows, maps and desk runtime

> Status checklist and technical contract. Overview of all features: [README.md](README.md). Developer entry: [../README.md](../README.md).

- **Code:** `src/web/html_desk.tsx`, `src/web/client/desk*.ts`, `src/web/client/kernel.ts`, `src/web/client/wasm_*.ts`, `src/desk/`
- **Related guides:** [docs/content/desk.md](../content/desk.md), [docs/src/desk.md](../src/desk.md), [docs/src/client.md](../src/client.md)
- **Component numbers** such as `1.4` are stable ids used across the docs (index in [README.md](README.md#component-number-index)).

## Status

`[x]` implemented and verified, `[ ]` still to do, `~~struck~~` cancelled or superseded. A checked parent needs all its children checked.

- [x] Preserve static menu entries/windows and pre-render Markdown and code (1.4)
- [x] Render menu foot actions and static map fallback links
- [x] Preserve desk windows, layout, resizing, syntax colouring, processes and the visitor OPFS home (3.5, 3.7)
- [x] Replace the JavaScript shell with compiled BusyBox ash and applets: Worker processes, shared byte filesystem calls, inherited descriptors, pipes, fork/exec/wait and local xterm.js (build recipes: `src/desk/README.md`)
- [x] Keep uploads strictly in memory (`/tmp`); remove inherited OPFS `/tmp` behaviour
- [ ] Map/window toggling, pan and zoom (1.4.3, 3.6)
- [ ] Offer a destination picker on Save for new/read-only windows
- [ ] Complete the plugin flow graph, MIME conversions, map resources and hidden processes (3.5–3.6)
- [ ] Bundle further programs (htop/fastfetch/tcc artifacts exist; ffmpeg and ImageMagick are not bundled)
- [ ] Shell session restoration and persistent Unix permission metadata
- [ ] Real `/proc` CPU/memory accounting (currently placeholders)

## Contract

*This is the target contract; a described capability is not a claim that it has shipped. The status list above is authoritative.*

## 1.4 Desk `<desk>`

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

### 1.4.1 Menu `<menu>`

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

### 1.4.2 Window `<window>`

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

### 1.4.3 Map `<map>`

**Objective.** Give a graphical road map of what a menu represents, so structure and workflows are visible and navigable intuitively.

**Solution.** A zoomable, pannable node-and-arrow diagram (PlantUML-like) that belongs to a `<menu>`, so the map changes with the active menu tab. A map button in the menu head toggles it: with windows open, showing the map hides them, and toggling again hides the map and shows the windows back. A desk with no windows shows the map by default. A menu that does not need one (messages, posts) simply has no `<map>`, and then has no map button. Nodes are clickable and open their link or window; without JavaScript the map is a nested list of links.

A map is **automatic** or **manual**:

- **Automatic** (`<map/>` with no children, live): the graph is derived from the menu's content and from runtime **resources**. Every window is a resource but not every resource is a window. Converting a file with two windows (input and output) shows three nodes: input window, output window, and the converting process (for example `ffmpeg`); clicking the process node shows its standard streams, as its plugin defines. Processes whose windows were closed but are still running appear as hidden nodes (`pid:3`). Plugins can contribute nodes and edges (an AI workflow, a virtual network whose nodes open `pid://pc0`, the status graph of the owner's server).
- **Manual** (children present, static): the owner writes the graph, for example a static map of the sub-projects of a mega project. It is not live.

**Interface.** `<map layout="tree|flow|graph">` (default chosen by the engine). Children, for manual maps:

- `<node id name icon info link x y>` - a node; `link` is a page or window to open; `x` and `y` are optional fixed positions. Nodes nest to show containment (a project containing sub-projects).
- `<edge from to text>` - an arrow between node ids.

## 3.5 Desk runtime

**Objective.** Execute everything a `<desk>` promises: tiling, windows, conversion, files, processes.

**Solution.** The following parts.

### 3.5.1 Layout

State is a binary tree of splits (horizontal or vertical, with a ratio) and leaves (windows). Separators are focusable `role="separator"` elements; arrow keys change the ratio by 2% (10% with Shift), minimum pane 12%. Moving a window removes its leaf and inserts a split around the target: the pointer's position within the outer 25% of a tile picks the edge, otherwise the windows swap. A flow child is inserted to the right (landscape) or as a new tab (portrait). Portrait ignores the tree: windows are tabs. The menu is outside the tree.

### 3.5.2 Window manager

Creates the starting windows from XML and new windows from the new-window control, runs the head controls (save, split, drag, mode), asks the plugin loader for the body and, for split windows, for the flow plugin, and persists layout and window state.

### 3.5.3 Mime detection, plugins and conversion graph

Detection order: declared mime; magic bytes (PNG, JPEG, GIF, WebP, PDF, ZIP, ELF, PE and others); file extension; valid UTF-8 means `text/plain`; otherwise `application/octet-stream`. Each plugin's `from` and `to` are edges (converter flows); conversion search is a lowest-cost path (cost per hop plus module size), multi-hop conversions run as a pipeline through temporary files. No path shows "No conversion from X to Y".

### 3.5.4 Plugin loader and WASM execution

Plugins are looked up by trigger. WASM modules are fetched on demand, verified with their `sha256`, cached by id and version, and run in a Web Worker with a WASI-style shim (arguments, environment, standard streams, the virtual filesystem as preopened directories). Progress is reported by messages and a run can be cancelled by terminating its worker. Only requested modules are loaded.

### 3.5.5 Kernel, processes and shell

A kernel without DOM: text streams, a process table, start, kill and interrupt. Every program except the shell's inline commands runs as a process with its own pid and its own stdin, stdout and stderr. The shell (bash-compatible: pipes, redirects, environment, `cd`, `pwd`, `export`, history, jobs, `PATH` lookup) is a program too, and a shell started inside a shell is a child process; `ps`, `kill` and `/proc` see them. A window with `path="pid://name"` (or `pid:N`) is a terminal for that process; `pid://name:/stdout`, `:/stderr`, `:/stdin` show a single stream, so two streams can be flowed side by side. Typing `pid:` in an empty window starts a shell. Closing the last window on a process ends it. Plugins can register named processes (a virtual network node `pid://pc0`). Sessions persist like tmux: transcript, working directory, environment and history are saved and restored, running processes are not.

### 3.5.6 Syntax coloring

Text windows color code by mime (C, C++, JavaScript, TypeScript, Python, shell, JSON, CSS, HTML, XML, Markdown, CSV). The edit mode uses a colored layer under a transparent textarea. Files over 300 KB stay plain.

## 3.6 Map runtime

**Objective.** Draw and navigate the map (1.4.3).

**Solution.** For an automatic map, builds the graph from the active menu's content and from the live resource table (windows, processes, plugin-provided intermediate nodes, hidden nodes for running processes without a window); for a manual map, reads the authored nodes and edges. Lays it out with the map's `layout`, renders pan, zoom and click, subscribes to window, split and process events so automatic maps stay live, and falls back to the static link list without JavaScript. The menu head's map button toggles between the map and the windows.
