# Engine: CLI, content model and incremental regeneration

> Status checklist and technical contract. Overview of all features: [README.md](README.md). Developer entry: [../README.md](../README.md).

- **Code:** `src/main.ts`, `src/commands.ts`, `src/build.ts`, `src/cache.ts`, `src/graph.ts`, `src/check.ts`
- **Related guides:** [docs/src/engine.md](../src/engine.md)
- **Component numbers** such as `1.4` are stable ids used across the docs (index in [README.md](README.md#component-number-index)).

## Status

`[x]` implemented and verified, `[ ]` still to do, `~~struck~~` cancelled or superseded. A checked parent needs all its children checked.

- [x] Incremental output hashing, generated assets and dependency graph
- [x] Pin generated font timestamps so an unchanged pinned-date build writes zero files and skips every page
- [x] No stale outputs or SPA payloads after deletes, renames and visibility changes
- [x] Cache invalidation covers generator, body, resource, date and source changes
- [x] Command surface: `build`, `check`, `serve`, `watch`, `clean`, `icons`, `graph`, `pack`, `deploy`, `node`
  - [x] Safe `clean` and output-root validation
  - [x] `watch` serializes rebuilds and reports that engine changes need a restart
  - [x] Dry-run deployment staging
  - [ ] `new`, `theme`, `font`, `--only` and `graph --format`
- [ ] Timestamp/manifest/`HEAD` incremental source parsing and repository revisions (2.3). Today `.cache/hashes.json` stores page/output hashes instead
- [ ] Isolate filesystem/process IO behind runtime adapters (engine stays Node-only for now)

## Contract

*This is the target contract; a described capability is not a claim that it has shipped. The status list above is authoritative.*

## 2.1 Command wrapper `main.ts`

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

## 2.2 Content model

**Objective.** Turn free-form files into one consistent, validated model of pages, languages and relations.

**Solution.** Pipeline: read the files that changed (the first build reads all), wrap multi-root files, parse strict XML keeping line numbers for errors, validate against the schema, resolve (paths, parents and children for breadcrumbs, languages, generators expanded into pages: projects, events, blogs, the listings and the sitemap; skills and stacks detected from references and checked against the expertise vocabulary), expand text tokens, then pass the model to the generators. Errors name the file and line.

**Interface.** The XML schema (this document's attribute tables are its source), and the model types shared by all generators.

## 2.3 Incremental regeneration

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
