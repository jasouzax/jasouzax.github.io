# Engine: CLI, pipeline, cache and checks

Back to [site developer guide](README.md). Status: [../feat/engine.md](../feat/engine.md).

Project research printing is owned by `engine/tags/print/research.tsx` (public language-matched content) and `engine/style/print/research.ts` (print-only paper geometry/typography). `engine/style/print.ts` includes the built-in CSS before author styles/fonts when the selected layout is `research`. `engine/tags/page.tsx` places the paper in both HTML and SPA payloads. The project `print` attribute selects the existing named/language-matched template; it does not implicitly publish private projects or another translation's research.

## CLI (`src/commands.ts`, launched by `src/main.ts`)

`main.ts` registers `tsx` (so `.ts`/`.tsx` run directly, with `tsconfig.json` using `jsxFactory: jsx`) and imports `commands.ts`. Run `node src/main.ts <command>` or the npm scripts.

Flags taking a value: `--out`, `--port`, `--root`, `--date`, `--out_file`, `--target`. Any other `--flag` is boolean.

| Command | npm script | What it does |
|---|---|---|
| `build [--out dist] [--dev] [--force] [--date YYYY-MM-DD]` | `npm run build` | Generate the site. `--date` pins "present"/local-time placeholders and font timestamps for reproducible builds. `--force` ignores page hashes |
| `check [--strict] [--report tiers]` | `npm run check` | Run the pipeline in check-only mode (no icons/covers written) plus link, media, page-rule and SEO checks. Exit 1 on errors, or on warnings with `--strict` |
| `serve [--port 8080] [--out dist]` | `npm run serve` | **Builds first**, then serves `dist` on `127.0.0.1` with `_headers` applied |
| `watch` | `npm run watch` | Dev build, then rebuild (debounced 150 ms, serialized) when `content/`, `src/` or `config.json` change. Engine changes need a restart of `watch` |
| `clean` | `npm run clean` | Delete `dist/` (only if it contains `.jazu_output.json`) and `.cache/` |
| `icons [list\|add\|check]` | `npm run icons` | Inspect/extend the icon registry (`add` appends a codepoint) |
| `graph` | – | Print the dependency graph as JSON |
| `pack [paths…] [--out_file codebase.zip]` | `npm run pack` | Zip the working tree minus everything excluded by `.gitignore` files (own parser, no git needed) and `config.pack.exclude`; extra paths are force-included. **Note it therefore omits `*.wasm`, `*.tar.*`, `.env`, `dist`, `content/media`** |
| `deploy [--target pages\|worker\|all] [--dry_run]` | `npm run deploy`, `deploy:dry` | Build, stage, run Terraform and the Pages upload. See [node.md](node.md#deploy) |
| `node [--port 8788]` | `npm run node` | Start the personal node (loads `.env`). See [node.md](node.md#personal-node) |

Not yet implemented (listed in the original spec): `new`, `theme build`, `font build`, `--only`, `graph --format`.

Exit codes: `jazu_error` carries a code; other failures exit 1.

## `build_site()` (engine/build/build.ts)

1. `output_directory()` validates the output folder (inside the project, not `src/content/tests/node_modules/.hidden`, no junction escape).
2. `load_config()` (merge defaults, validate) → `load_site()` builds the `site_model`.
3. `synthesize()` adds generated pages: per-language `/sitemap` listing and a `/404` if none is authored.
4. `compile_plugins()` validates plugin declarations, bundles scripts with esbuild, publishes WASM with SHA-256 checks.
5. `build_expertise()` per language (timeline lanes, slideshow order, filter strips).
6. `fail_on_errors()` — all XML/schema/resource errors surface here with file:line.
7. Themes: `compile_inline_layout()` (the unnamed theme → inline CSS + skeleton CSS, minified with esbuild) and `compile_theme()` for each selected named theme (SCSS, fonts, JS, colours) → `assets/themes/manifest.json`.
8. `emit_page_styles()` copies page-specific CSS.
9. `bundle_runtime()` bundles the browser scripts (`page`, `theme_switch`, `desk_shell`, each WASM Worker adapter, inline `boot`) as IIFEs into `assets/runtime/[name].[hash].js` and copies BusyBox + program WASM, licenses, source archives and ports into `assets/wasm/`, writing `assets/wasm/manifest.json`. **This step reads `src/desk/busybox/artifacts/busybox.wasm`, `busybox-source.tar.bz2` and `src/desk/programs/artifacts/{fastfetch,htop,tcc}.wasm` plus their source archives; the build fails with ENOENT if they are missing** (see [desk.md](desk.md#artifacts)).
10. Per page: compute `page_hash()`; if hash and on-disk outputs match the cache, skip; otherwise `render_page()` → `index.html` and `index.json`.
11. Site files: `sitemap.xml`, `robots.txt`, `_headers` (with CSP hashes of the boot script and inline CSS), `_redirects`, `manifest.json`, `llms.txt`/`llms-full.txt`, `security.txt` (+ `.well-known/`), icons and 1200×630 covers (skipped in check mode).
12. Referenced content resources are copied (`model.resources`).
13. `write_files()` writes **only changed bytes** (compared by SHA-256); files in the previous `.jazu_output.json` manifest that are no longer produced are pruned; the new manifest and `.cache/hashes.json` are saved.

Result: `{ model, diag, written, skipped, pages }`.

## Content model (engine/load/model.ts, objects.ts, schema.ts, xml.ts)

- `xml.ts` — Saxes-based strict parser, line numbers in every node (`where_of(node)` → `file:line`). Valueless boolean attributes are expanded in start tags only (`boolean_attributes`).
- `schema.ts` — `rules[tag] = { attrs, required, children, bools }`, `root_tags`, and checks in `check_node` (unsafe URIs, page path shape, window mode, plugin SHA, case host, research structure). **Add a new tag or attribute here first**, then implement rendering.
- `model.ts` — `load_site()` scans `content/`, wraps multi-root files in `<jazu>`, validates, separates roots into `pages`, `themes`, `objects` (project/event/blog), `prints`, `plugins`, and builds `resources` (url → file) via `objects.ts::collect_resources`. Helpers: `page_url`, `find_page`, `crumb_chain`, `menu_pages`, `order_pages`, `ui_text`, `icon_of`, `localize`.
- `objects.ts` — `expand_objects()` turns each project/event/blog into a `page` (path `/projects/{id}` etc.) plus listing pages; excludes `private`; derives summaries (`object_info`).
- `expertise.ts` — pure build-time computation: skills, stacks, bars (timeline rectangles/dots with lanes), entries, per-scenario geometry. Output is the `expertise_model` consumed by `engine/tags/expertise.tsx` and `scss_data()` (state data injected into SCSS as `jazu:api`).

## Incremental regeneration (engine/build/cache.ts, graph.ts)

`.cache/hashes.json` is a flat `Record<string,string>`:

- `page:{lang}:{path}` → hash of everything that page depends on (`page_hash`: its XML serialisation, window sources, breadcrumb/dropdown names, nav candidates, icon registry, shared hash)
- `out:{file}` → SHA-256 of what was written

`engine/load/manifest.ts` stores `.cache/sources.json`: source paths, nanosecond modification/change times, size/inode/mode, a scan timestamp, Git `HEAD`, detached parsed XML trees and source digests. An unchanged source is statted without reading or parsing it again. Git revision changes add `git diff --name-only -z` paths to the invalidation set; an unavailable old revision invalidates the whole cache. Renames/deletions disappear from the saved manifest. Restoring an old modification time still changes ctime; the Git check provides an additional independent signal. Parser or Saxes version changes invalidate trees. `--force` bypasses tree reuse. Invalid cache files/trees are reparsed, and read-only checkouts can build without saving a cache. Validation, icon expansion and object generation always run against newly detached trees, so cached trees cannot retain an earlier model's mutations.

`shared_hash()` combines cached binary-safe digests for `engine/`, `desk/` and `shared/`, published artwork, configuration/icons, inline CSS, the theme manifest, runtime names and build date. Shared runtime/theme changes conservatively invalidate every page. Page styles and emitted print stylesheet references are hashed per page. Expertise pages depend on the derived expertise model, including stack definitions, rather than every project's unrelated body. Print pages also depend on their selected template and published personal data. The dependency graph includes XML/resource/template source nodes. A page is skipped only when its dependencies match **and** its outputs still have the expected hashes. Per-project repository snapshots and fully selective theme/bundle compilation remain open ([status](../feat/engine.md)).

Verified property: an unchanged, pinned-date build (`--date`) writes zero files.

## Checks (engine/check/check.ts)

`check_links`, `check_media`, `check_page_rules`, `check_seo`, and `tier_report()` (`--report tiers`) which scans emitted CSS/JS against `tier_features` (browser versions, tier, fallback). Warnings never fail a command unless `--strict`.

## Plugins at build time (engine/tags/plugin.ts, plugin_types.ts)

`compile_plugins()` produces the plugin manifest embedded for the browser; `plugin_types.ts` (`select_case`, `trigger_matches`, `plugin_matches`) is shared by the engine tests and the browser `desk_plugins.ts`, so matching semantics are identical in both. Rules: [../content/plugin.md](../content/plugin.md).

## Adding things

- **A new XML attribute:** `schema.ts` → consume it in the generator/model → document in `docs/content/{tag}.md` → add a test in `tests/content/migration.test.ts`.
- **A new XML tag:** `schema.ts` (`rules`, and `root_tags` if it can be a root) → generator in `objects.ts` or a `render_*` in `src/web` → docs.
- **A new CLI command:** add a branch in `commands.ts::main` (and, if it takes a value flag, add the name to the list in `parse_args`).
- **A new output file:** `files.set("name", content)` in `build_site`; it is hashed, written and pruned automatically.
