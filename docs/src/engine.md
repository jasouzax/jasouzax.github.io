# Engine: CLI, pipeline, cache and checks

Back to [site developer guide](README.md). Status: [../feat/engine.md](../feat/engine.md).

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

## `build_site()` (src/build.ts)

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

## Content model (src/model.ts, objects.ts, schema.ts, xml.ts)

- `xml.ts` — Saxes-based strict parser, line numbers in every node (`where_of(node)` → `file:line`). Valueless boolean attributes are expanded in start tags only (`boolean_attributes`).
- `schema.ts` — `rules[tag] = { attrs, required, children, bools }`, `root_tags`, and checks in `check_node` (unsafe URIs, page path shape, window mode, plugin SHA, case host, research structure). **Add a new tag or attribute here first**, then implement rendering.
- `model.ts` — `load_site()` scans `content/`, wraps multi-root files in `<jazu>`, validates, separates roots into `pages`, `themes`, `objects` (project/event/blog), `prints`, `plugins`, and builds `resources` (url → file) via `objects.ts::collect_resources`. Helpers: `page_url`, `find_page`, `crumb_chain`, `menu_pages`, `order_pages`, `ui_text`, `icon_of`, `localize`.
- `objects.ts` — `expand_objects()` turns each project/event/blog into a `page` (path `/projects/{id}` etc.) plus listing pages; excludes `private`; derives summaries (`object_info`).
- `expertise.ts` — pure build-time computation: skills, stacks, bars (timeline rectangles/dots with lanes), entries, per-scenario geometry. Output is the `expertise_model` consumed by `src/web/html_expertise.tsx` and `scss_data()` (state data injected into SCSS as `jazu:api`).

## Incremental regeneration (src/cache.ts, graph.ts)

`.cache/hashes.json` is a flat `Record<string,string>`:

- `page:{lang}:{path}` → hash of everything that page depends on (`page_hash`: its XML serialisation, window sources, breadcrumb/dropdown names, nav candidates, icon registry, shared hash)
- `out:{file}` → SHA-256 of what was written

`shared_hash()` mixes the **full text of every file under `src/`**, the signature/icon sources, `config.json`, the icon registry, inline CSS, theme manifest, runtime bundle names, page styles and the build date. Consequence: **any edit under `src/` invalidates every page** (intended until the finer source manifest lands). A page is skipped only when its hash matches **and** its outputs still exist with the cached hashes. The design target (last-compiled timestamp + path manifest + git `HEAD`) is not implemented ([status](../feat/engine.md)).

Verified property: an unchanged, pinned-date build (`--date`) writes zero files.

## Checks (src/check.ts)

`check_links`, `check_media`, `check_page_rules`, `check_seo`, and `tier_report()` (`--report tiers`) which scans emitted CSS/JS against `tier_features` (browser versions, tier, fallback). Warnings never fail a command unless `--strict`.

## Plugins at build time (src/plugins.ts, plugin_types.ts)

`compile_plugins()` produces the plugin manifest embedded for the browser; `plugin_types.ts` (`select_case`, `trigger_matches`, `plugin_matches`) is shared by the engine tests and the browser `desk_plugins.ts`, so matching semantics are identical in both. Rules: [../content/plugin.md](../content/plugin.md).

## Adding things

- **A new XML attribute:** `schema.ts` → consume it in the generator/model → document in `docs/content/{tag}.md` → add a test in `tests/migration.test.ts`.
- **A new XML tag:** `schema.ts` (`rules`, and `root_tags` if it can be a root) → generator in `objects.ts` or a `render_*` in `src/web` → docs.
- **A new CLI command:** add a branch in `commands.ts::main` (and, if it takes a value flag, add the name to the list in `parse_args`).
- **A new output file:** `files.set("name", content)` in `build_site`; it is hashed, written and pruned automatically.
