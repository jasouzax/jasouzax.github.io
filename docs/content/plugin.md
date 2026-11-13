# `<plugin>`, `<case>`

A desk capability: which window body handles which resource, optionally with a script or a WebAssembly module. Back to [content guide](README.md). The longer authoring reference lives next to the files: [`content/plugins/README.md`](../../content/plugins/README.md).

```xml
<plugin id="code" name="Code" version="1.0.0">
    <case file edit mime="text/markdown" host="text"/>
    <case file view edit mime="text/*,application/json" host="text"/>
</plugin>
```

Plugins may share one file, occupy separate files or live anywhere under `content/`; they are discovered by the root tag with no wrapper. Default plugins live in `content/plugins/plugins.xml`. Plugins only affect **desk runtime features**; they never change how pages are generated.

## `<plugin>` attributes

**Required:** `id` (unique; duplicates are errors) and `version`.

| Attribute | Meaning |
|---|---|
| `name`, `icon` | Display |
| `mime`, `path`, `mode` | Legacy plugin-level trigger, checked before cases |
| `from`, `to` | Conversion edges (mime → mime) for the conversion graph |
| `flow` | `list` of flow kinds provided (`convert`, `compare`, `mirror`, or your own) |
| `wasm`, `sha256` | WebAssembly module and integrity hash. **`sha256` (64 hex chars) is required whenever `wasm` is set**; the build and the browser both verify it |
| `script` | Behaviour script (refine trigger, add menu tabs/controls/map nodes, or render the body) |
| `options` | Schema of options reported to a `window:N:/options` menu |

Script and WASM files must stay inside `content/`; relative paths resolve from the declaring XML.

## `<case>`

Ordered children that declare when the plugin applies. **A case needs a `host` or a `script`** (its own or the plugin's).

| Attribute | Meaning |
|---|---|
| `file` | `bool`; `true` needs loaded file data, `false` needs none, omitted accepts either |
| `error` | `bool`; `true` matches error windows only; default excludes them |
| `view`, `edit` | `bool`; allowed modes. Omit both = either; only `view` = view-only; a flag set to `false` disallows |
| `mime`, `url` | Comma-separated patterns with `*`; each defaults to `*`. `url` matches the window's resource URI |
| `host` | Built-in body: `text`, `hex`, `folder`, `media`, `shell`, `markdown`, `html`, `pdf`, `image_pdf`, `mirror`, `messages`, `default` (anything else is an error). `messages` handles `message/cpim` at `im:*` on a server-enabled desk. |
| `script` | Case-specific script; overrides the plugin's |
| `child_file`, `child_view`, `child_edit`, `child_mime`, `child_url` | The same conditions, but for the **child** of a split window. A case with any of them is a *flow case*: it never applies to an ordinary window, and the plain attributes (`mime`, `url`, `view`, `edit`, `file`, `error`) then describe the **parent**. See [Split flows](#split-flows) |

### Matching rules

1. Plugin-level triggers (if present) are checked first.
2. Cases are checked **in document order; the first full match wins**.
3. An **exact** `mime` or `url` (no `*`) *reserves* that resource: if its file/error/mode conditions fail, the whole plugin declines it instead of trying later wildcard cases. So `<case file edit mime="text/markdown" …/>` before `<case file view edit mime="text/*" …/>` keeps Markdown out of view-mode Code, while another plugin can still take it.
4. Plugin order breaks ties between plugins; `default` is always the final fallback. Code precedes Hex, so recognized text opens in the text editor; other files can use Hex.

### Split flows

A flow case reads "when the parent is *this* and the child is *that*": `<case file mime="image/png" child_mime="image/jpeg" host="media"/>` applies to a child whose parent holds a PNG and whose picked type is JPEG. Which flow a case serves is inferred from what it says about the child, so it is never written down:

| The case names… | Flow | The child… |
|---|---|---|
| `child_file` (true) or `child_url` | `compare` | holds a resource of its own (picked a URL, uploaded or opened a file) |
| `child_mime` (and no own resource) | `convert` | picked a type and shows the parent's resource as that type |
| only `child_view` / `child_edit` | `mirror` | picked a mode and shows the parent's resource in that mode |

Flow cases are matched in document order with the same reservation rule as ordinary cases, applied **per side**: an exact parent `mime`/`url` reserves the parent only when the parent's file/error/mode conditions fail, and an exact `child_mime`/`child_url` reserves the child only when the child's conditions fail. A plugin's `flow` attribute (`flow="convert,compare"`) limits which flows it takes part in.

### Hosts

| Host | Body |
|---|---|
| `text` | Line numbers, syntax colours, hex toggle; editable in edit mode |
| `hex` | The text editor with its hex toggle initially open |
| `folder` | Large-icon folder contents with local image/video/code previews |
| `media` | Image viewer or audio/video player |
| `shell` | Terminal for the selected process |
| `markdown` | Rendered Markdown (HTML disabled) |
| `html` | Sandboxed HTML preview of shared unsaved bytes; scripts and same-origin access disabled |
| `pdf` | Lazy local PDF.js canvas viewer with page navigation, zoom and download |
| `image_pdf` | `image/*` parent to PDF child through the registered img2pdf WASM process |
| `mirror` | Ordinary plugin selection over shared parent bytes with an independent mode and viewport |
| `default` | Upload area, resource error or unsupported message |

## Scripts

`script="custom.js"` is bundled as a browser ES module and loaded only for selected cases. It may export `matches(context)`, `render(context)` and `setup(context)` (returning an optional cleanup). The context has `item`, `plugin`, `case`, `host`, `signal` and `load_wasm`. Check `signal.aborted` before updating a body. Details and the `host` API: [`content/plugins/README.md`](../../content/plugins/README.md#optional-scripts).

## Related

[Contract and status](../feat/plugins.md) · [desk](desk.md) · [WASM toolchain](../src/desk.md)

## Shipped split behavior

Split starts empty: no source, type or selected mode, with Open folder and upload/drop actions. Picking a mode mirrors the parent's resource; picking a type chooses conversion; picking an independent file or URI chooses comparison. Own resources take priority over type, then mode. Folder navigation in a child stays in that child and becomes an independent resource.

```xml
<plugin id="image_pdf" version="1" flow="convert">
    <case file mime="image/*" child_mime="application/pdf" host="image_pdf"/>
</plugin>
<plugin id="compare" version="1" flow="compare">
    <case file mime="text/*" child_file child_edit child_mime="text/*" host="text"/>
    <case file mime="text/*" child_file child_view child_mime="text/plain" host="text"/>
</plugin>
<plugin id="mirror" version="1" flow="mirror">
    <case child_view child_edit host="mirror"/>
</plugin>
```

Mirrors share a live document, including edits made before splitting, while each window keeps its mode, selection and scroll. Save writes through the original resource callback; a save completing after another edit does not clear that newer edit. Giving a mirror its own resource detaches its buffer. Closing a parent retains the mirrored draft in its children.

Opened text/code defaults to Edit. View shows `text/html` in a sandbox and `text/plain` in a readonly editor; other visitor text types show an unsupported message. The explicit Markdown case for the site's readonly `file:///srv/*` documents preserves authored pages such as Privacy; it does not handle uploads or home files. Hosts remain configurable by the owner.

Text comparisons mark added child lines green and removed source lines with a small red bottom arrow. They update as either document changes. Editing remains limited to 2 MB; comparison also requires a source no larger than 2 MB and has a bounded diff budget. On budget exhaustion annotations are omitted (`data-comparison="limited"`). General non-text comparisons and multi-hop conversion search remain future work.

Image conversion decodes browser-supported images, normalizes them to JPEG on white (first frame for animated inputs), then invokes img2pdf. This avoids passing compressed PNG bytes to its raw-image path. It is a raster conversion, limited to 40 megapixels. Closing or replacing the child cancels its process and removes its private temporary directory. PDF.js, its worker, fonts, CMaps and WASM assets are published locally under a package-versioned URL and fetched only for PDFs. The viewer renders one page at a time with a 32-megapixel limit; a download remains available on rendering errors.
