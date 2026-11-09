# Print modes

> Status checklist and technical contract. Overview of all features: [README.md](README.md). Developer entry: [../README.md](../README.md).

- **Code:** `src/prints.ts`, `src/web/html_rirekisho.tsx`, `src/web/rireki_form.tsx`, `src/web/client/print.ts`, `content/portfolio.print.css`
- **Related guides:** [docs/content/print.md](../content/print.md)
- **Component numbers** such as `1.4` are stable ids used across the docs (index in [README.md](README.md#component-number-index)).

## Status

`[x]` implemented and verified, `[ ]` still to do, `~~struck~~` cancelled or superseded. A checked parent needs all its children checked.

- [x] Select the `<print>` root by page language: exact, prefix wildcard, then `*` (1.13)
- [x] Use only published hero data for personal print details
- [x] Preserve the `beforeprint` date/age refresh (3.10)
- [ ] Arbitrary print layouts, fonts and the quotation runtime

## Contract

*This is the target contract; a described capability is not a claim that it has shipped. The status list above is authoritative.*

## 1.13 Print `<print>`

**Objective.** Turn pages into useful paper or PDF (a resume, a Japanese resume form, a quotation, a research summary) without printing personal data the owner never published.

**Solution.** `<print>` is a root element like `<theme>`, but it applies only in print mode, and only for the languages it names. A page chooses which one to use with its `print` attribute (`print="resume"`). All print behavior is determined by this element: nothing else in content changes how a page prints. For a page in language L the engine picks the `<print>` named by the page whose `lang` matches best (exact, then prefix wildcard such as `en*`, then `*`).

The engine emits print-only markup (hidden on screen) for pages that name a print mode, using the print mode's layout, and the print mode's styles format it. **Only published information is used.** Personal details come from the website's first `<hero>` (name, `profile` image, and `<item>`s found by their `print` labels); history comes from `<expertise>` (events by `type`, featured projects, skills with their stacks). Any value that is missing is printed as a placeholder (an empty box or line); nothing is invented, and no other personal source exists. This protects the owner: a form such as the 履歴書, which asks for many personal details, can never expose more than the owner chose to publish.

Layouts whose data is not in content (the `quotation`, which prints a client's own receipts) are filled in the visitor's browser at print time from their own session (3.10).

**Interface.**

| Element | Attributes | Meaning |
|---|---|---|
| `<print>` | `name` (the mode: `resume`, `rirekisho`, `quotation`, `research`, ...), `lang` (`list`, wildcards allowed, default `*`), `size` (paper, e.g. `a4`), `layout` (built-in print layout; default is `name`) | Root |
| `<style>`, `<font>`, `<palette>`, `<sym>` | as in `<theme>` | Print appearance, scoped to print mode |

Labels a layout reads from hero items are listed with the layout (for example `rirekisho`: `name`, `kana`, `birth`, `gender`, `postal`, `address`, `phone`, `email`). Dates and age in a printed form are the build date until the browser replaces them with the day of printing (3.10).

## 3.10 Print runtime

On `beforeprint`, replaces the build-date placeholders (date and age) with the day of printing, and fills layouts whose data is not in content (the quotation prints the client's own receipts, read from their session). No other script is needed for printing.
