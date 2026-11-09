# `<project>`, `<slide>`, `<research>`

One project = one place for its description, files, history and workspace, appearing in expertise in as many skill versions as you want. Back to [content guide](README.md).

```xml
<project id="example" name="Example" date="Jan 2026" featured="true" website="https://example.com">
    <slide skill="web-app" info="Interface and design work." stack="vue, vuetify" media="/media/example.png" alt="Screenshot"/>
    <slide skill="cloud" info="Backend and database work." stack="firebase"/>
</project>
```

A project is a **generator**: from one element the engine produces `/projects/{id}` (path is fixed by the type), its desk, and its expertise entries. `/projects` (a listing desk with featured cards) is generated too.

## `<project>` attributes

Required: `id`, `name`, `date`.

| Attribute | Meaning |
|---|---|
| `id` | Identity; page `/projects/{id}`, repository mount `/srv/repo/{id}`, subdomain redirect `{id}.{domain}` |
| `name` | Full title. `short` is used where space is tight |
| `short`, `sub`, `note`, `role`, `rank` | Display, timeline data and ordering (`rank` higher = earlier) |
| `date`, `icon` | See [value types](README.md#2-value-types) |
| `featured` | `bool`; included in the slideshow when no skill is focused. Its `featured="true"` slide (or first public slide) is used |
| `private` | `bool`; excludes the project from rendering, watching and generation |
| `repo` | Repository location on the private server, e.g. `~/repo/linux_remake` (**operator setting; never published in page payloads**). Repository-backed Files/Version tabs are not implemented yet |
| `stack`, `feature_stack` | `list`; extra stacks for the timeline. `feature_stack` is the set shown while no skill is focused |
| `website`, `source`, `paper`, `event` | Action buttons: *View Website / Source Code / Paper / Event*. They stay visible while slide content crossfades |
| `lang` | Language of this root; keep translations in the same file |
| `media`, `poster`, `alt`, `tags`, `menu`, `image`, `keywords`, `canonical`, `robots`, `lastmod`, `cover`, `print`, `noindex`, `path` | Shared attribute pool; rarely needed here |

**Not allowed on `<project>`:** `skill` and `info` (put them on slides). Unknown attributes are errors.

Children: `<slide>`, `<menu>`, `<window>`, `<action>`, `<research>`.

## `<slide>`

One **version of the project for one skill**. `skill` is **required**.

| Attribute | Meaning |
|---|---|
| `skill` | **Required.** `list`; one slide may serve several skills. Each skill may belong to only one *public* slide per project |
| `info` | The explanation (alias `description`, then the element's text as a fallback) |
| `media`, `poster`, `alt` | Picture/video/diagram, video poster, alternative text (searched too) |
| `stack`, `feature_stack` | Tools used / tools shown in the default view |
| `hashtags`, `tags` | Labels shown in the slide head |
| `featured` | `bool`; makes this the project's default version |
| `private` | `bool`; excludes the slide |

Slides have no children. A project's summary in Featured, page summaries and the generated desk comes from its featured (or first public) slide. The footer lists all the project's slide skills; choosing one crossfades the content and changes the fragment (`#web-app/example` → `#cloud/example`).

## `<research>`

At most one per project. Generates an **Overview** menu with these sections, in order, each optional but never duplicated:

`<terminology>`, `<problem>`, `<solution>`, `<significance>`, `<objectives>`, `<literature_review>`, `<frameworks>`, `<methodology>`, `<results>`.

Write each section's explanation as body text. Except `<terminology>`, a section may nest `<point name="…">Explanation<point name="…">More detail</point></point>` — expandable explanations with no links or buttons. The English `stesis` project in `content/projects.xml` is a complete **placeholder** reference; its prompts and results are not verified research.

## Generated desk tabs

Files, Version and Agent tabs are planned (repository-backed; Agent for signed-in contributors only). See [status](../feat/objects.md).

## Related

[expertise](expertise.md) · [desk](desk.md) · [contract](../feat/objects.md)
