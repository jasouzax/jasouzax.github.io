# `<print>`

Turns pages into paper or PDF (a résumé, a Japanese 履歴書, later a quotation or research summary) **without printing personal data the owner never published**. Back to [content guide](README.md).

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
| `layout` | Built-in print layout (default is `name`). Currently implemented: `resume`, `rirekisho` (`src/web/html_rirekisho.tsx`, `rireki_form.tsx`) |

Children: `<style>`, `<font>` (same as in [themes](theme.md), but scoped to print mode).

## The privacy rule

**Only published information is used.**

- Personal details come from the website's **first `<hero>`**: `name`, `profile`, and `<item print="label">` entries.
- History comes from `<expertise>`: events by `type`, featured projects, skills with their stacks.
- Any missing value prints as an empty box or line. Nothing is invented and no other personal source exists. A form such as the 履歴書 can therefore never expose more than the owner chose to publish.
- Labels a layout reads from hero items: for `rirekisho` — `name`, `kana`, `birth`, `gender`, `postal`, `address`, `phone`, `email`.
- The sample personal values that used to be in the old form (birth date, phone numbers, postal code, family and commute fields, application text) were removed on purpose and must not be restored.

## Dates

Dates and age in a printed form are the build date until the browser's `beforeprint` handler replaces them with the day of printing (`src/web/client/print.ts`; Japanese era + year + month + day for the 履歴書).

## Related

[Contract and status](../feat/print.md) · [hero `print` labels](hero.md#item)
