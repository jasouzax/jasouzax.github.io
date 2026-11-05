# Owner content and deployment replacements

These are public-content or operator inputs, not implemented product features. See unchecked tasks for missing functionality.

| Location | Current state | Owner action |
|---|---|---|
| `config.json` | Inherited Jason D’Souza identity and jasouza.com origin | Confirm owner name, contact details, GitHub account, domain, deployment project names and languages |
| `content/portfolio.xml` (English and Japanese roots) | Inherited public biography, roles, contact links and timeline | Review accuracy and translations before publication |
| `content/projects.xml` (English and Japanese roots) | Inherited project descriptions, demos, dates and source links; converted slide variants initially share the same description | Supply distinct skill-specific media/descriptions where useful; confirm permission to publish |
| `content/media/` | Local-only inherited media archive, ignored by Git except signature | Restore archive on new machines/CI, or replace references with owner-managed assets |
| `/media/hypro_editor.png` | Referenced by the Hypro slides, missing from the supplied archive | Add the image or replace/remove the reference in both languages |
| `<print>` roots in portfolio XML | Existing resume/rirekisho layouts and styles; missing personal fields stay blank | Add only personal fields intentionally published as landing hero `<item print="..." text="...">` values |
| `content/privacy*.md` | Inherited privacy wording | Update to match the enabled deployment, storage, sign-in and retention behavior |
| SEO `info` descriptions in page/object XML | 37 inherited length warnings | Shorten long descriptions or write fuller short descriptions; review Japanese copy separately |
| `content/work.xml` | Static workspace shell with API placeholders | Leave client data out of XML; complete authenticated backend tasks before use with clients |
| `config.json.personal_server` | Empty | Set the private origin URL only when the origin service and Tunnel/Access policy are configured |

The inherited sample birth date, phone numbers, postal code, family/commute fields and application text were removed. They are not valid owner facts and must never be silently restored. Photo fields remain empty until a public hero profile is intentionally supplied. Repository locations are private operator settings and must never be embedded in public page payloads.

| Deployment input | Replace before cloud use |
|---|---|
| `wrangler.jsonc` | Pages origin, domain, account/zone routes and optional production bindings |
| `wrangler.bindings.example.json` | Copy required binding sections into wrangler.jsonc and replace example IDs/names |
| `.env.example` | Copy to ignored .env, generate HMAC key, explicitly map only public repositories |
| Cloudflare Worker secrets | HMAC key and Access service token id/secret; never commit actual values |
| KV registry | Explicit external HTTPS origins for each approved demo/work subdomain |
| `wrangler.local.jsonc` | Local-only synthetic binding identifiers; never deploy this config |

Large local videos are staged for R2 automatically. The dry-run lists upload keys without uploading bytes. Owner must confirm media rights and retention. The API health response explicitly reports Work as not implemented; this is intentional product status, not a fake client session.
