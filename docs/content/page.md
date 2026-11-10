# `<page>`

One navigable URL: its identity in navigation and search, and its content. Back to [content guide](README.md).

```xml
<page path="/privacy" lang="en" name="Privacy" icon="[lock]" rank="10" info="How this site handles data.">
    <hero name="Privacy" info="…"/>
</page>
```

## Rules

- `path` and `name` are **required**. `path` must be absolute (`/…`), contain no `\`, `?`, `#` or `%`, and no `.`/`..` segments.
- The same `path` may appear once per `lang`; they are alternates of one page (`hreflang` is emitted). Keep them in one file.
- Pages for projects, events and blogs are **generated**; do not write `<page>` for them.
- Allowed children: `<hero>`, `<expertise>`, `<desk>`, `<style>`. Each child becomes a section or tab of the page, in document order.
- `<style src="x.css" media="print"/>` as a child is a page-specific stylesheet, copied as written (no scoping). Start its selectors with the page's body class so it stays page-specific. Pages swap without reload, so the page JSON lists its styles and the client adds/removes the matching `<link>`.
- Breadcrumbs, dropdowns and the sitemap come from `path` depth: the divider after crumb C lists C then C's children (pages exactly one segment deeper), `rank` descending then name, at most 10, then a link to the sitemap.

## Attributes

| Attribute | Meaning |
|---|---|
| `path` | **Required.** URL path |
| `name` | **Required.** Title; breadcrumb, dropdown and head-navigation label |
| `lang` | Language; default is `config.default_language` |
| `icon` | Icon in head navigation (`[token]` or character) |
| `rank` | Number; higher is earlier in navigation order. Unranked pages sort after ranked ones |
| `info` | Description (meta description, tooltip). Pages without one fall back to the site description; `check` warns about length |
| `menu` | `false` hides the page from dropdowns, suggestions and search |
| `noindex` | `true` removes it from search-engine files |
| `print` | Name of the `<print>` mode used when printing this page ([print.md](print.md)) |
| `image`, `cover`, `keywords`, `canonical`, `robots`, `lastmod` | SEO overrides |
| `featured`, `date`, `skill`, `short`, `note`, `role`, `sub`, `media`, `poster`, `alt`, `stack`, `tags`, `feature_stack`, `website`, `paper`, `event`, `source` | Shared attribute pool also used by `<project>`/`<event>`; accepted on `<page>` by the validator but only meaningful on those generators |

Booleans: `featured`, `noindex`, `menu`.

## Related

- Language dictionaries: `config.json.languages` ([README §4](README.md#4-configjson-non-content-settings)).
- Technical contract: [../feat/pages.md](../feat/pages.md).
