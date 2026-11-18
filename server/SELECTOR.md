# Hover selectors

The bar under the browser feed shows a CSS selector for the element under the pointer. It is built to keep
working after a redesign (**resilient**) and on pages whose IDs and classes are generated (**adaptive**), so it
prefers what an element *is* (test hooks, IDs, ARIA and data attributes) over where it *sits* (ancestors, positions).

The code is `src/selector.ts`. It runs inside the page (it is one of the helpers of `page_prelude` in `src/web.ts`),
so it only uses what is inside the function. The result is up to three selectors, each with a confidence and the
signals it is made of: `{ selector, confidence, signals }`, the best first. Pure CSS only, descendant combinators
(spaces) only, uniqueness is checked against every match in the document, visible or not.

## What describes a node

| Score | Descriptor |
| --- | --- |
| 100 | `data-testid`, `data-test`, `data-test-id`, `data-qa`, `data-cy`, `data-automation-id`, `data-e2e` |
| 95 | `id` |
| 85 | `name`, `aria-label` |
| 80 | any other `data-*` (a bare `data-cds` counts) |
| 60 | `role`, `placeholder`, `alt`, `title`, `href` (path only) |
| 55 | `type` |
| 50 | `aria-labelledby` / `aria-describedby` |
| 30 | the tag |
| 12-25 | a position: `:first-child`, `:nth-last-of-type(n)`, `:nth-of-type(n)`, `:nth-child(n)` (target only) |
| 10 | a class |

A value is **never** used when it looks generated (`:r5:`, `button-48291`, UUIDs, hashes, `css-` / `sc-` / `jsx-`,
long digit runs, no vowels, high entropy), when an `aria-label`, `placeholder`, `alt` or `title` holds digits or a
price (`Cart (3)`), or when it is state or framework noise (`aria-expanded`, `tabindex`, `data-state`, `data-v-*`,
`data-radix-*`, state classes such as `active` / `is-*`, Tailwind utilities). Values with a short trailing number
(`step2`) are allowed but score 15 less. CSS Modules classes (`Button_primary__3xK9a`) become
`[class*="Button_primary__"]`.

## How a selector is built

1. The target on its own, with every descriptor that is unique.
2. Otherwise, the nearest ancestors that are unique by themselves (score 60 or more) become **anchors**. From each
   one the selector grows towards the target: first a stronger descriptor of the target, then the single ancestor
   that leaves the fewest matches, up to 5 steps. It is greedy on purpose: resilient enough, never slow.
3. A position is the last resort and only for the target, because its position is what the person picked. A
   positional selector always keeps a parent as scope ("the 3rd item of this list", not "any 3rd item").
4. Steps the selector does not need are pruned (the anchor too), and every result is verified:
   `querySelectorAll(selector)` must return exactly the target.
5. Fallbacks come from searching again **without the signals the best result used**, so a fallback survives
   when the primary's signal disappears.
6. When nothing identifies the element, an exact structural path is returned with confidence 5.

`confidence = average(step scores) - 4 * (steps - 1)`, minus 15 for a position and minus 10 for an anchor more than
4 levels away. 80 and above is strong, 50 to 79 acceptable, below 50 fragile.

The search stops after 150 ms (the page's own thread runs it) and returns what it has.

## Stale answers

The pointer moves while the page works out a selector, so an answer can describe a position the pointer has left.
Every pointer position of a window gets a number (`hover_seq`, `src/server/windows.ts`):

- an answer is only sent while its number is still the newest, so the selector of an element that is no longer
  under the pointer is dropped instead of shown;
- a navigation clears the bar and makes every answer still on its way stale;
- the page applies `window_hover` only when its `seq` is newer than the last one it applied for that window.

## Not covered yet

Text and accessible-name selectors, Puppeteer syntax (`::-p-aria`, `>>>`), shadow DOM and iframe paths (the pointer
finds the host or the frame element), and the two-load check for values that change between visits.
