# `<event>`

A period or moment of experience, education, certification or competition, with its own explanation and sub-events. Back to [content guide](README.md).

```xml
<event id="uni" name="University" sub="BS Computer Engineering" date="Aug 2022 - Jun 2026" type="education" skill="systems" info="…">
    <event id="thesis" name="Thesis" date="Apr 2026"/>
</event>
```

An event is a **generator**: it produces `/events/{id}`, a timeline entry in expertise, and rows in print modes that list experience or education. Its desk has a menu (sub-events as a tree) and a main window explaining the selected one. Its resources are `/srv/events/{id}` in the browser filesystem.

Required: `id`, `name`, `date`. Child: nested `<event>` for sub-events.

| Attribute | Meaning |
|---|---|
| `id`, `name`, `sub`, `date`, `icon`, `info`, `note`, `image` | Identity and display |
| `type` | `education`, `experience`, `certification`, `competition` or `other` (keyword; never translated) |
| `skill`, `stack` | `list`; vocabulary used by the timeline filters |
| `featured` | `bool` |
| `resume` | `license` places this event's date and name in the 履歴書 Licenses area; education and experience default from `type` |
| `lang` | Language of this root |
| `resume_start`, `resume_end` | Override the start/end text printed in the 履歴書 history table |
| *shared pool* | `rank`, `short`, `role`, `media`, `poster`, `alt`, `tags`, `feature_stack`, `website`, `paper`, `event`, `source`, `path`, `menu`, SEO overrides — accepted by the validator |

## Related

[expertise](expertise.md) · [print](print.md) · [contract](../feat/objects.md)
