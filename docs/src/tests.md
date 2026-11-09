# Tests

Back to [site developer guide](README.md).

## Unit / contract tests (`node:test`)

```sh
npm run types     # tsc --noEmit over src and tests
npm test          # node --import tsx --test tests/*.test.ts
```

Node 22.18+ is required (`tests/nodes.test.ts` uses `node:sqlite`). Tests build temporary sites in OS temp folders; nothing touches `dist/`.

| File | Covers |
|---|---|
| `migration.test.ts` | The migration contract: free-form roots, private data never published, resource/path escapes, print language matching, cache invalidation and pruning, folder renames with config only, project variants/actions/research, language dictionaries, vnode page payloads, XML bare attributes |
| `plugins.test.ts` | Plugin compile identical across file layouts; case ordering and exact-MIME reservation; trigger combinations; script/WASM bundling; duplicate ids and escapes |
| `nodes.test.ts` | Worker routing, header security, R2 ranges/WASM, HMAC signing/replay, D1 migration constraints (`node:sqlite`), personal Git adapter safety, deploy staging |
| `render.test.ts` | vnode `to_html`/`to_dom`/serialize round trips |
| `layout.test.ts` | Shared geometry extraction, CSP hashes for inline styles |
| `font.test.ts` | Independent decode of generated TTF/WOFF/WOFF2/COLRv0 (`fontkit`), writer validation |
| `gitignore.test.ts` | `.gitignore` semantics used by `pack` |
| `desk_*.test.ts` | Desk logic: rename tokens, ZIP, folder covers, paths, permissions, previews, selection; `desk_wasm.test.ts` runs the real BusyBox WASM in `worker_threads` (needs the `.wasm` artifacts) |

## Browser tests (Playwright, Chromium)

```sh
npx playwright install chromium
npm run build
npm run test:loading:browser     # skeleton / loading lifecycle (serves dist on :8125)
npm run test:expertise:browser   # expertise slider and fragments
npm run test:desk:browser        # desk: isolation, terminal, shared FS, programs, FSA (serves on :8124, builds first)
```

Output folders are under `.cache/` (ignored).

## Not covered / how to verify manually

- Real Cloudflare deployment (`terraform plan/apply` has not been validated against a real account).
- `npm run check -- --strict` is intentionally not clean until the owner placeholders are resolved ([../README.md](../README.md#placeholders-the-owner-must-replace)).
