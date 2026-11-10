# Plugins and the WASM toolchain

> Status checklist and technical contract. Overview of all features: [README.md](README.md). Developer entry: [../README.md](../README.md).

- **Code:** `content/plugins/`, `src/plugins.ts`, `src/plugin_types.ts`, `src/web/client/desk_plugins.ts`, `src/web/client/wasm_host.ts`
- **Related guides:** [docs/content/plugin.md](../content/plugin.md), [content/plugins/README.md](../../content/plugins/README.md), [src/desk/README.md](../../src/desk/README.md)
- **Component numbers** such as `1.4` are stable ids used across the docs (index in [README.md](README.md#component-number-index)).

## Status

`[x]` implemented and verified, `[ ]` still to do, `~~struck~~` cancelled or superseded. A checked parent needs all its children checked.

- [x] Validate plugin declarations and require SHA-256 for WASM (1.10)
- [x] Ordered `<case>` matching with built-in hosts: text, hex, folder, media, shell, markdown, default
- [x] Optional case/plugin scripts bundled with esbuild and loaded only for selected cases
- [ ] Publish script/WASM manifests and verify bytes before execution
- [ ] Move built-in viewers, converters and processes to declared plugins
- [ ] Implement the full trigger/flow/WASM pipeline (convert/compare/mirror flows, conversion graph search) (3.5.3)

## Contract

*This is the target contract; a described capability is not a claim that it has shipped. The status list above is authoritative.*

## 1.10 Plugin `<plugin>`

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

## 2.10 Desk toolchain (`{codebase}/src/desk`)

**Objective.** Run real GNU/Linux or Windows programs in the browser without a virtual machine.

**Solution.** Scripts (Bash for Linux, Batch for Windows, otherwise TypeScript) that compile or package applications into WebAssembly modules, producing the `wasm` files that `<plugin>` entries reference. This is the only part of the codebase not restricted to TypeScript.
