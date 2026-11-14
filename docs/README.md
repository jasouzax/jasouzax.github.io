# JAZU development guide

The technical documentation of JAZU. If you only want to run or deploy it, start with the root [README](../README.md); this directory is for people changing it.

## Who reads what

| You are… | Read | Covers |
|---|---|---|
| **Content developer** (edit `content/`: pages, projects, blogs, themes, plugins, print) | [content/README.md](content/README.md) → per-tag rules: [page](content/page.md), [hero](content/hero.md), [expertise](content/expertise.md), [desk](content/desk.md), [project](content/project.md), [event](content/event.md), [blog](content/blog.md), [theme](content/theme.md), [plugin](content/plugin.md), [print](content/print.md) | What every tag/attribute means and what the validator enforces |
| **Site developer** (edit `src/`) | [src/README.md](src/README.md) → [engine](src/engine.md), [web](src/web.md) (TSX static generation), [client](src/client.md), [desk](src/desk.md), [node](src/node.md) (Cloudflare Worker, personal server), [helper](src/helper.md) (fonts etc.), [tests](src/tests.md) | How the code works, how to extend it |
| **Operator** (infrastructure) | [infra.md](infra.md) and the root README | Terraform, Cloudflare resources, secrets |
| **Anyone picking the next task** | [feat/README.md](feat/README.md) | Every feature as a checklist: done / ongoing / todo |
| **AI agents** | [../CLAUDE.md](../CLAUDE.md) first | Codebase map, conventions, pitfalls |

## Features in development

These are the features being worked on **right now**. Click one for its status list and technical contract. When a feature is finished, delete it from this list; then open [feat/README.md](feat/README.md) to see what is next.

- **Expertise** — skill-specific slideshow: deduplicated search, radio-based filtering (no `:has`), nested stacks → [feat/expertise.md](feat/expertise.md)
- **Themes** — move legacy background trees to the shared fixed-canvas/slots contract → [feat/themes.md](feat/themes.md)
- **Plugins** — publish script/WASM manifests, verify bytes before execution, move built-in viewers to declared plugins → [feat/plugins.md](feat/plugins.md)
- **Desk** — map toggle/pan/zoom, destination picker on Save, plugin flow graph → [feat/desk.md](feat/desk.md)
- **Cloud** — validate Terraform against a real account and import existing resources → [feat/cloud.md](feat/cloud.md)

*(Chosen from the unchecked items that already have some checked work; edit freely.)*

## Overall development model

- Work on a feature branch (the migration was done on `migration/gen-11-to-gen12`); the owner reviews and merges to master manually. No deployment is part of feature work.
- At each successful state: tick the checkboxes in the feature page **and** its mirror in [feat/README.md](feat/README.md), and commit with [Conventional Commits](https://www.conventionalcommits.org/) (`refactor(content): migrate object roots`).
- Before committing changes that affect generation, run: `npm run types`, `npm test`, `npm run check`, `npm run build`.
- Warnings are actionable content findings; do not suppress them to look finished.
- Keep documentation next to the change: attribute added → `docs/content/{tag}.md`; feature finished → tick it; new module → `docs/src/*`.

### Documentation rules

1. `docs/feat/README.md` is the single source of "what is done / ongoing / todo". Every statement there is a checkbox.
2. A feature with sub-tasks has a page `docs/feat/{name}.md` with the full list and the technical contract. The index mirrors its top-level lines.
3. This file lists only features currently in progress; finished ones leave this list.
4. `docs/content/*` describes **what the validator accepts** (`src/schema.ts` is the truth). `docs/src/*` describes **how the code works**.
5. Never claim something works unless a test, a command or a browser check showed it. Unverified plans stay unchecked.

## Placeholders the owner must replace

These are public-content or operator inputs, not implemented product features. See the unchecked feature tasks for missing functionality.

| Location | Current state | Owner action |
|---|---|---|
| `config.json` | Inherited Jason D'Souza identity and `jasouza.com` origin | Confirm owner name, contact details, GitHub account, domain, deployment project names and languages |
| `content/portfolio.xml` (English and Japanese roots) | Inherited public biography, roles, contact links and timeline | Review accuracy and translations before publication |
| `content/projects.xml` (English and Japanese roots) | Inherited project descriptions, demos, dates and source links; converted slide variants initially share the same description | Supply distinct skill-specific media/descriptions where useful; confirm permission to publish |
| `content/media/` | Local-only inherited media archive, ignored by Git and excluded by `config.json.pack.exclude`; website artwork paths are declared in `config.json.resources` | Restore the archive on new machines/CI, or replace references with owner-managed assets |
| `/media/hypro_editor.png` | Referenced by the Hypro slides, missing from the supplied archive | Add the image or replace/remove the reference in both languages |
| `<print>` roots in portfolio XML | Existing résumé/rirekisho layouts and styles; missing personal fields stay blank | Add only personal fields intentionally published as landing hero `<item print="…" text="…">` values |
| `content/privacy*.md` | Inherited privacy wording | Update to match the enabled deployment, storage, sign-in and retention behaviour |
| SEO `info` descriptions in page/object XML | 37 inherited length warnings | Shorten long descriptions or write fuller short ones; review Japanese copy separately |
| `content/work.xml` | Static workspace shell with API placeholders | Keep client data out of XML; complete the authenticated backend tasks before use with clients |
| `config.json.personal_server` | `https://personal-server.jasouza.com` | Keep the origin behind Tunnel/Access service authentication; adjust it when moving the server |
| `src/desk/*/artifacts/*.wasm` + source archives | Not in `codebase.zip` (ignored by `.gitignore`, so `npm run pack` drops them); the build needs them | Restore from the repository/backup or rebuild ([src/desk.md](src/desk.md#artifacts)) |

The inherited sample birth date, phone numbers, postal code, family/commute fields and application text were removed. They are not valid owner facts and must never be silently restored. Photo fields remain empty until a public hero profile is intentionally supplied. Repository locations are private operator settings and must never be embedded in public page payloads.

| Deployment input | Replace before cloud use |
|---|---|
| `.env` `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `TF_VAR_*` | Deployment credentials and Terraform inputs; loaded by `deploy`; never commit |
| `terraform/terraform.tfvars` | Optional alternative to `TF_VAR_*` in `.env` (git-ignored) |
| `.env.example` | Copy to ignored `.env`, generate an HMAC key, explicitly map only public repositories |
| Worker secrets | HMAC key and Access service-token id/secret as Terraform variables; never commit actual values |
| KV registry | Explicit external HTTPS origins for each approved demo/work subdomain |
| `wrangler.local.jsonc` | Local-only synthetic binding identifiers; never deploy this config |

Large local videos are staged for R2 automatically. The dry run lists upload keys without uploading bytes. The owner must confirm media rights and retention. The API health response explicitly reports Work as not implemented; this is intentional product status, not a fake client session.

## Validation evidence (as recorded at the end of the generation-12 migration)

- TypeScript checks cover source and tests; 22 regression tests passed at the time *(the suite has since grown; run `npm test` for the current figure)*.
- 68 HTML routes responded correctly (including the generated 404). An unchanged pinned-date build skipped 68/68 pages and wrote no files.
- Local Wrangler: health 200, Pages fallback 200, Work shell 200 with `no-referrer`/`no-store`, unfinished messages API 501.
- Local R2: `bytes=0-2` returned 206 with `Content-Range: bytes 0-2/10` and the expected three bytes.
- Local D1 migration applied successfully; tests enforce idempotency and cross-tenant pin constraints.
- Worker dry-run bundled successfully; staging separated six videos for R2 and excluded stray `dist` files.
- Browser: portfolio, media and desk rendered; no desk console errors; Contact navigation targeted `#contact`.
- Content check succeeded with 39 documented warnings (the missing Hypro image in two languages and 37 inherited SEO description lengths); `check --strict` deliberately fails until they are resolved.
- No cloud deployment or merge to master had occurred.

These figures were recorded by the previous author and **were not re-run** when this documentation was written.

## Known limitations (summary)

- Work has Google sign-in, hashed cookie sessions, account-linked invitations and shared-key encrypted text chat; UUID merging, receipts and dashboards remain planned. See [setup and limitations](feat/work.md#encrypted-messaging-implementation). Unfinished APIs still return `501`.
- The PWA (offline public snapshot, installable manifest, decrypted native notifications, Web Push) is implemented but unverified; see [feat/pwa.md](feat/pwa.md).
- The personal node supports signed Git reads, authenticated HTTPS pushes, a static Pages/R2 Git mirror and XML-defined project synchronization/CI/CD (generic runtime tested locally; production activation pending). Dashboards and agents remain unimplemented.
- Terraform has not been validated against a real account; state is local.
- Plugins: no WASM manifest verification before execution beyond build-time hashes; conversion graph not implemented.
- Expertise radio filters, `#all/{id}` fragments and search deduplication are pending.
- The engine is Node-only (portability to Deno/Bun is not done).
- Desk userland is a browser port, not a Linux kernel; see [src/desk.md](src/desk.md#limits-to-remember).
- The desktop (`xinit` kiosk) device shell is implemented and tested against a simulated browser, but not yet verified in a real Chromium session: [feat/desk_env.md](feat/desk_env.md).

Full list: [feat/README.md](feat/README.md).
