# `<desk>`, `<menu>`, `<entry>`, `<foot>`, `<window>`, `<map>`

A desktop-like workspace: a side navigation panel plus tiled windows. One primitive serves `/desk`, `/projects`, `/blogs`, `/work` and any page. Back to [content guide](README.md).

```xml
<desk name="Desktop" icon="[desk]" info="Files and tools" auto="true">
    <menu name="Files" icon="[folder]" path="file:///">
        <entry type="Folder" id="fs_home" name="home" open="true">
            <entry type="Folder" id="fs_home_user" name="user"/>
        </entry>
    </menu>
    <window path="/srv/blogs/example/intro.md" type="text/markdown" mode="view"/>
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
| `server` | `bool`; desk state lives on the owner's backend (used by `/work`) |

Children: `<menu>`, `<window>`.

## `<menu>`

One tab of the side panel.

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

A zoomable node-and-arrow diagram that belongs to a menu tab; a map button appears in the menu head when the active tab has one. *Pan/zoom and the window/map toggle are not implemented yet; today the static link-list fallback is rendered.*

- `<map/>` with no children is **automatic** (derived from menu content and live resources).
- With children it is **manual**:

| Element | Attributes |
|---|---|
| `<map>` | `layout` = `tree`, `flow` or `graph` |
| `<node>` | `id` (**required**), `name`, `icon`, `info`, `link`, `x`, `y`; nests for containment |
| `<edge>` | `from`, `to` (**both required**), `text` |

## `<window>`

Shows or edits one resource in a tile. Windows declared in content are the desk's starting windows. Window ids: `window:N` is 1-based in document order. Processes are `pid://name` or `pid:N`.

| Attribute | Meaning |
|---|---|
| `icon` | Window icon |
| `type` | `mime` of the content; empty means undetermined. Change the mime to treat a file differently (an image as `text/plain` shows as text) |
| `mode` | `view` or `edit` only (anything else is an error) |
| `path` | `uri` of the resource. Relative paths resolve from the declaring XML. Empty shows an upload area |
| `data` | Inline content |
| `flow` | `bool`; show the split control |
| `save` | `bool`; show the save control |
| `full` | `bool`; hide the head and fill the tile |

The body is chosen by the [plugin](plugin.md) whose case matches (mime, url, mode). If none match, the window says viewing/editing is unsupported for that mime.

Windows whose source is known at build time (markdown, text, images, code) are pre-rendered into the HTML so search engines and no-JavaScript readers get the content.

## Related

[Contract](../feat/desk.md) · [plugins](plugin.md) · [site developer guide](../src/desk.md)
