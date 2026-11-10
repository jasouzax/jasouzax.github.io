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
| `host` | Built-in body: `text`, `hex`, `folder`, `media`, `shell`, `markdown`, `default` (anything else is an error) |
| `script` | Case-specific script; overrides the plugin's |

### Matching rules

1. Plugin-level triggers (if present) are checked first.
2. Cases are checked **in document order; the first full match wins**.
3. An **exact** `mime` or `url` (no `*`) *reserves* that resource: if its file/error/mode conditions fail, the whole plugin declines it instead of trying later wildcard cases. So `<case file edit mime="text/markdown" …/>` before `<case file view edit mime="text/*" …/>` keeps Markdown out of view-mode Code, while another plugin can still take it.
4. Plugin order breaks ties between plugins; `default` is always the final fallback. The Hex plugin is listed before Code so file editing starts in hex mode.

### Hosts

| Host | Body |
|---|---|
| `text` | Line numbers, syntax colours, hex toggle; editable in edit mode |
| `hex` | The text editor with its hex toggle initially open |
| `folder` | Large-icon folder contents with local image/video/code previews |
| `media` | Image viewer or audio/video player |
| `shell` | Terminal for the selected process |
| `markdown` | Rendered Markdown (HTML disabled) |
| `default` | Upload area, resource error or unsupported message |

## Scripts

`script="custom.js"` is bundled as a browser ES module and loaded only for selected cases. It may export `matches(context)`, `render(context)` and `setup(context)` (returning an optional cleanup). The context has `item`, `plugin`, `case`, `host`, `signal` and `load_wasm`. Check `signal.aborted` before updating a body. Details and the `host` API: [`content/plugins/README.md`](../../content/plugins/README.md#optional-scripts).

## Related

[Contract and status](../feat/plugins.md) · [desk](desk.md) · [WASM toolchain](../src/desk.md)
