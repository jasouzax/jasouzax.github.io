# `<desk>`, `<menu>`, `<entry>`, `<foot>`, `<window>`, `<map>`

A desktop-like workspace: a side navigation panel plus tiled windows. One primitive serves `/desk`, `/projects`, `/blogs`, `/work` and any page. Back to [content guide](README.md).

```xml
<desk name="Desktop" icon="[desk]" info="Files and tools" auto="true">
    <menu name="Files" icon="[folder]" path="file:///">
        <entry type="Folder" id="fs_home" name="home" open="true">
            <entry type="Folder" id="fs_home_user" name="user"/>
        </entry>
    </menu>
    <window path="/srv/blogs/example/intro.md" type="text/markdown" view="true"/>
</desk>
```

**What you write is the starting condition**, like a desktop that restores the same open windows. Visitors change it at runtime.

- **Static menus** (a list of blogs): entries are hard-coded, rendered as real HTML links, indexable and working without JavaScript.
- **Live menus** (`path` is a URI source such as `file:///`): filled at runtime; need JavaScript.

## `<desk>`

| Attribute | Meaning |
|---|---|
| `icon`, `name`, `info`, `date` | Shown in the menu head |
| `auto` | `bool`; grow with content and share the page scrollbar (blogs) instead of filling the viewport |
| `fixed` | `bool`; preserve the initial window setup. Open requests reuse the focused window and retain its navigation history. Closing, splitting, minimizing, maximizing, moving and resizing windows are disabled. |

Children: `<menu>`, `<window>`.

## `<menu>`

One tab of the side panel.

The head grows with its description so tabs remain below the text. Its top-right button switches between the active tab's map and windows, preserving layout and focus. It appears only when the tab declares `<map>`; selecting a tab without one restores windows. In portrait the button also dismisses the menu overlay.

| Attribute | Meaning |
|---|---|
| `name`, `icon` | Tab label |
| `path` | Optional `uri` source: `file:///`, `window:N:/options`, or a plugin source |

Children: `<entry>`, `<foot>`, `<map>`.

### `<entry>`

A navigable item: file, folder, message, post, editor entity, sub-event. Entries nest without limit; nesting is sticky (the chain of parents is the breadcrumb).

| Attribute | Meaning |
|---|---|
| `id` | Unique id for references |
| `type` | Free keyword; known: `File`, `Folder`, `Post`, `Message`, `Note`, `Commit`, `Branch`, `Share`. Never translated |
| `name`, `info`, `icon`, `date`, `image` | Display |
| `data` | The entry's content (text or media reference) |
| `link` | Where activating it goes (page or window) |
| `from` | Origin (author, sender, source) |
| `acts` | Actions available |
| `open` | `bool`; initially expanded |

### `<foot>`

Tool strip at the bottom of a menu tab (create file, upload, compose). Children: `<action icon text link>`.

### `<map>`

A zoomable node-and-arrow diagram belonging to a menu tab. Drag the background or use arrow keys to pan; use the wheel or buttons to zoom, and Reset view to restore the initial position. Keyboard `+`, `-` and `0` work with the surface focused. Window nodes restore/focus windows; file/process nodes open resources. Authored links work without JavaScript. A desk with maps and no authored windows starts in map mode.

- `<map/>` with no children is **automatic** (derived from menu content and live resources).
- Automatic maps include files, windows, split flows and processes. Dashed borders indicate minimized windows or processes without windows.
- Drag a node's background to place it, or focus it and use Shift+arrow keys. Positions stay in this browser per page/menu; changing the viewport or switching tabs preserves them. Moving nodes updates their arrows. Authored icons support glyphs and HTTP/relative image URLs.
- With children it is **manual**:

| Element | Attributes |
|---|---|
| `<map>` | `layout` = `tree`, `flow` or `graph` |
| `<node>` | `id` (**required**), `name`, `icon`, `info`, `link`, `x`, `y`; nests for containment |
| `<edge>` | `from`, `to` (**both required**), `text` |

## `<window>`

Non-fixed desks add a live **Windows** menu. It shows each window and its split children. Expand an entry for Show, Hide/Unhide and Close controls. Hidden windows disappear from the desktop and header tabs, while retaining drafts, process attachments and map nodes; Ctrl+Tab skips their hidden tabs. Show or activate their map node to restore focus. In portrait, Show also dismisses the menu overlay.

Drag one file window's menu entry onto another to make it a comparison child. Parent cycles and operations in fixed desks are rejected. Available comparisons still depend on plugins. Named/persistent desktop groups remain planned; ordinary windows remain volatile across page navigation/reload.

Shows or edits one resource in a tile. Windows declared in content are the desk's starting windows. Window ids: `window:N` is 1-based in document order. Processes are `pid://name` or `pid:N`.

| Attribute | Meaning |
|---|---|
| `icon` | Window icon |
| `type` | `mime` of the content; empty means undetermined. Change the mime to treat a file differently (an image as `text/plain` shows as text) |
| `view`, `edit` | Mutually exclusive booleans; View is the default. |
| `split` | Earlier parent window ID, starting at 1 in authored window order. |
| `path` | `uri` of the resource. Relative paths resolve from the declaring XML. Empty shows an upload area |
| `data` | Inline content; becomes a local runtime document as well as the static fallback. `path` takes precedence when both are supplied. |
| `flow` | `bool`; show the split control |
| `save` | `bool`; show the save control |
| `full` | `bool`; hide the head and fill the tile |

The body is chosen by the [plugin](plugin.md) whose case matches (mime, url, mode). If none match, the window says viewing/editing is unsupported for that mime.

Windows whose source is known at build time (markdown, text, images, code) are pre-rendered into the HTML so search engines and no-JavaScript readers get the content.

Save writes to an existing writable source. New/read-only documents open a VFS destination picker at `/home/user`; choose a folder and filename. Replacing files requires selecting the overwrite checkbox. Cancel preserves the dirty draft. Later saves reuse the chosen path.

Volume: click to mute/unmute; right-click, touch, or press ArrowDown on the button to open the slider. Nonaudio windows disable it. Mute/level survive viewer changes, and a badge identifies muted playback, including remote browser audio. Escape closes the slider.

Fullscreen removes the frame. During video playback, idle tools fade after 2.5 seconds; the fullscreen head overlays the video and fades too. Pointer/touch/keyboard interaction restores controls. Keyboard focus or open menus keeps them visible.

## Related

[Contract](../feat/desk.md) · [plugins](plugin.md) · [site developer guide](../src/desk.md)
