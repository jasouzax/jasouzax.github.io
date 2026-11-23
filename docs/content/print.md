# `<print>`

Turns pages into paper or PDF (a résumé, a Japanese 履歴書 or project research; quotations remain planned) **without printing personal data the owner never published**. Back to [content guide](README.md).

```xml
<print name="resume" lang="en" layout="resume">
    <style><![CDATA[ /* print-only CSS */ ]]></style>
</print>
```

A page opts in with `print="resume"`. For a page in language L the engine chooses the `<print>` with that name whose `lang` best matches: exact, then prefix wildcard (`en*`), then `*`.

## Attributes

| Attribute | Meaning |
|---|---|
| `name` | **Required.** The mode name (`resume`, `rirekisho`, `quotation`, `research`, …) |
| `lang` | `list`, wildcards allowed; default `*` |
| `size` | Paper size, e.g. `a4` |
| `layout` | Built-in print layout (default is `name`). Implemented: `resume`, `rirekisho`, `research`, `book`. |

Children: `<style>`, `<font>` (same as in [themes](theme.md), but scoped to print mode).

Print styles accept SCSS (inline or `src`) and the theme `jazu:api` mixins. Fonts use the same generated/prebuilt pipeline as themes. Selected styles are emitted in a content-hashed stylesheet with both `media="print"` on its page link and an `@media print` wrapper. Font and relative asset changes update the stylesheet URL; SPA navigation loads only the current page's print stylesheet.

## Research papers

Declare `<print name="research" lang="*" layout="research" size="a4"/>` and add `print="research"` to a project with `<research>`. The paper uses only the matching public language variant's title, date, safe HTTP(S) paper-source link and authored research sections/points. It never fills absent sections, borrows another translation or adds authors, repository/collaborator settings or account data. Placeholder wording is preserved; the English Stesis reference remains an unverified authoring example.

The paper is hidden on screen and replaces desktop/navigation during printing. Sections follow vocabulary order and points retain nesting. The layout supplies margins, page numbers and typography, with `a4` (default), `a5`, `letter` and `legal` sizes. Print styles/fonts work as usual; set `.research_paper { --research-font: "Your Font"; }` to use a configured font. Styling is scoped to research output.

## Blog books

Use `print="book"` on a blog with `<print name="book" lang="*" layout="book" size="a5"/>`. It prints that blog and public, indexable descendants in authored order, using the same language. The book has a cover, linked contents, chapter starts, online source links and page numbers. It includes authored Markdown/code and published image windows, without desk controls or runtime state. See [nested blogs](blog.md#books). Size accepts `a5` (default), `a4`, `letter`, `legal`; a configured font can be selected with `.blog_book { --book-font: "Your Font"; }`.

## The privacy rule

**Only published information is used.**

- Personal details come from the website's **first `<hero>`**: `name` and `<item print>` entries.
- History comes from `<expertise>`: events by `type`, featured projects, skills with their stacks.
- Events marked `resume="license"` supply dated rows in the rirekisho Licenses area.
- Any missing value prints as an empty box or line. Nothing is invented and no other personal source exists. A form such as the 履歴書 can therefore never expose more than the owner chose to publish.
- Printed contact fields use the published text of boolean print items: `mailto:` links identify email, `tel:` links identify phone, and `[location]` identifies address. Other structured fields and the removed hero profile photo remain blank for the existing form editor. No fields are inferred from translated labels.
- The sample personal values that used to be in the old form (birth date, phone numbers, postal code, family and commute fields, application text) were removed on purpose and must not be restored.

## Dates

Dates and age in a printed form are the build date until the browser's `beforeprint` handler replaces them with the day of printing (`desk/site/print.ts`; Japanese era + year + month + day for the 履歴書).

## Related

[Contract and status](../feat/print.md) · [hero `print` labels](hero.md#item)

The Japanese portfolio's 履歴書 can be completed in Chrome DevTools: open Rendering and set **Emulate CSS media type** to **print**. Click a value or empty row to edit it, and click the photo box to select a PNG, JPEG, or WebP. Changes update the two SVG sheets immediately. Print normally when finished; editing controls disappear during printing. These additions stay in the current document only, are never uploaded or saved, and reset on reload.
