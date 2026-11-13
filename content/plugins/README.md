# Desk plugins

Each `<plugin>` is an XML root with an `id` and `version`; its ordered `<case>`
children choose a built-in window host. Put multiple plugin roots in one file,
use separate files, or place them in any folder under `content`. Discovery is
recursive, and script/WASM paths resolve relative to the declaring XML file.
The default plugins all live together in `plugins.xml`, without a wrapper.
No script is needed for the default plugins.

```xml
<plugin id="code" name="Code" version="1.0.0">
    <case file edit mime="text/markdown" host="text" />
    <case file view edit mime="text/*,application/json" host="text" />
</plugin>
<plugin id="media" name="Media" version="1.0.0">
    <case file view mime="image/*,audio/*,video/*" host="media" />
</plugin>
```

Bare attributes mean `="true"` throughout content XML: `<window full save/>`
is equivalent to `<window full="true" save="true"/>`. Write `save="false"` to
turn a boolean off. Quoted values, text, comments and CDATA are preserved.

Case matching:

- `mime` and `url` accept comma-separated patterns with `*` wildcards. Both
  default to `*`. `url` matches the resource URI shown in the window head.
- `file` requires loaded file data; `file="false"` requires no file. Omit it to
  accept either. This lets Shell handle a process without a file Blob.
- `error` permits error windows only; `error="false"` (also the default) requires
  a window without an error. Add a separate error case when appropriate.
- `view` and `edit` are allowed modes. Neither specified means either mode;
  both specified means both. A flag explicitly set to false does not allow that
  mode. Only `view` means view only; only `edit` means edit only.
- Cases run in document order. The first fully matching case wins. An exact
  matching MIME or URL (a matching list entry without `*`) reserves that resource:
  if its file/error/mode checks fail, this plugin declines the resource, and later
  wildcard cases in the same plugin cannot override it. Other plugins can still
  match it. Thus the first Markdown case above excludes Markdown from Code in
  view mode, even though the second case allows `text/*` in view mode.
- Plugin order breaks ties across plugins; `default` remains the final fallback.
  Code handles recognized text first; Hex handles other files. Visitor text opens in Edit. Authored `/srv` Markdown documents keep their explicit viewer case.

Available hosts:

| Host | Window body |
|---|---|
| `text` | Line numbers, syntax colors and a hex toggle; editable in edit mode |
| `hex` | The same text editor with its hex toggle initially open |
| `folder` | Large icon folder contents, with local image, video and code previews |
| `media` | Image viewer or audio/video player |
| `shell` | Terminal for the selected process |
| `markdown` | Rendered Markdown document |
| `html` | Sandboxed live HTML preview |
| `pdf` | Lazy local PDF.js canvas viewer |
| `image_pdf` | Image to JPEG normalization, img2pdf WASM, PDF |
| `mirror` | Ordinary viewer selection over a shared parent document |
| `default` | Upload area, resource error or unsupported-resource message |

Double-click a sidebar folder, or enter a folder URI such as
`file:///home/user` in a window source, to open the Folder body. Clicking a file
tile opens a separate window; folder tiles and Up navigate inside the folder
window. A declarative window can use `type="inode/directory"` and `mode="view"`.

Previews are generated locally and stored as PNGs under
`/home/user/.cache/previews`. Images, video frames and code have visual previews;
other formats receive a file-type card. Tiles load lazily, source changes
invalidate cached previews, and the cache is periodically limited to 256 entries.
Browsing the cache never caches previews of its own PNGs. If browser storage is
unavailable, previews remain usable for the current view without persistence.

Legacy plugin-level `mime`, `path` and `mode` filters remain supported and apply
before cases. Legacy script-only plugins remain supported too.

## Optional scripts

Use `script="custom.js"` on a plugin or an individual case for custom behavior.
A case script takes precedence over its plugin's script. Paths resolve relative
to the XML file. Scripts are bundled as browser ES modules and loaded only for
selected cases. Local imports and installed browser packages are supported.
Script and WASM entry files must stay inside `content`.

```xml
<plugin id="custom" version="1.0.0">
    <case file view mime="application/json" host="text" script="custom.js" />
</plugin>
```

Scripts may export `matches(context)` to refine a trigger, `render(context)` to
supply their own body, and `setup(context)` to add actions or other contributions.
If `render` is omitted, the selected case's `host` supplies the body. `setup` can
return a cleanup function, called when the body is replaced or the window closes.

The context has `item` (window), `plugin` (full declaration), `case` (selected
case, when present), `host` (runtime API), `signal` (body lifetime), and
`load_wasm`. Asynchronous work must check `signal.aborted` before updating a body.
`host` exposes `state`, `text`, `render_window`, `save_window`, and the built-in
`code(item, hex_mode)`, `media(item)`, `terminal(item)`, `markdown(item, signal)`
and `fallback(item)` body factories. Use `host.state.desk` and
`host.state.windows` to contribute menu tabs, foot/head controls or maps.
Editors set `item.commit` to an async Blob provider, set `item.problem` when
invalid, and dispatch bubbling input events to mark edits.

`wasm` and `sha256` declare an optional module. `await load_wasm()` loads and
compiles it after checking SHA-256. The build verifies the hash too. `from`, `to`,
`flow` and `options` remain available in the manifest and script context;
conversion behavior and any options/menu/map UI belong to that script.

## Split windows

See [the shipped flow declarations and limits](../../docs/content/plugin.md#shipped-split-behavior). A `mirror` case delegates to ordinary cases with the child's mode. It shares the parent's current bytes, not its DOM, so navigation and scrolling remain independent. `text` renders line comparison annotations for independent text resources. `image_pdf` executes the existing registered WASM tool; a plugin script must use the injected host factories rather than bundling another copy of the page kernel or document registry.
