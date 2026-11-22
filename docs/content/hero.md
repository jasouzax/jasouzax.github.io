# `<hero>`, `<item>`, `<action>`

Quick, direct information. One component serves landing pages, contact sections, sitemap and error pages. Back to [content guide](README.md).

```xml
<hero tab="Home" name="Your Name" tags="Engineer, Maker" info="One-line pitch.">
    <item icon="[mail]" name="Email" text="you@example.com" link="mailto:you@example.com" print="true"/>
    <action icon="[contact]" text="Contact" link="#contact" primary/>
</hero>
```

## `<hero>`

| Attribute | Meaning |
|---|---|
| `name` | The owner's name on a landing page, or a header for contact/error/sitemap heroes |
| `tab` | Header-tab label override; defaults to `name`. Does not change the visible name or the published print name. The landing hero uses `Home` / `ホーム` |
| `tags` | `list`; the owner's roles. All are rendered and cycled by CSS only; the first is the static state |
| `info` | Description |

Children: `<item>`, `<action>`.

Wording such as a greeting ("Hi, I'm") belongs to the theme, not to the hero.

**The first hero of the landing page is the only source of personal information for print modes** ([print.md](print.md)).

Hero ids: the first hero on a page gets anchor `#home`, the second `#contact`, later ones `#hero_N`.

## `<item>`

One entry of the link list: contact detail, page, location.

| Attribute | Meaning |
|---|---|
| `icon`, `name`, `text`, `link` | Display and destination |
| `print` | `bool`; include this item’s text in print output. `false` excludes it. Only mark information intentionally published. |

## `<action>`

A button. **`text` and `link` are required.**

| Attribute | Meaning |
|---|---|
| `icon`, `text`, `link` | Display and destination |
| `primary` | `bool`; highlights the button |

`<action>` is also allowed directly under `<project>` (custom buttons) — not under `<slide>`.

## Related

[Contract](../feat/pages.md) · [print rules](print.md)
