# `<expertise>`, `<skill>`, `<stack>`

Lets visitors browse experience, education, projects, certifications and competitions graphically, and see each project through the skill they care about. Back to [content guide](README.md).

```xml
<page path="/" name="Home">
    <expertise>
        <skill name="web-app" icon="[web]" group="software" info="Websites and apps">
            <stack name="vue" tag="Vue"/>
        </skill>
        <skill name="cloud" icon="[cloud]" group="software"/>
        <stack name="git" tag="Git"/>
    </expertise>
</page>
```

## What you write, and what is generated

- **You write only the vocabulary**: which skills and stacks exist, how they look and group.
- **Entries are never hand-written.** They are detected from every `<event>`, every `<project>` and its `<slide>`s. Blogs are not part of expertise.
- A skill/stack that entries reference but the expertise does not declare is **not shown** and has no alternate versions; a build warning is raised. A declared skill with no entries has an empty page.
- Declare the vocabulary **once**, inside `<expertise>`. Skills and stacks are not root tags.

## `<expertise>`

Attributes (legacy, optional): `tab`, `icon`, `name`, `info`, `featured_chips`. Children: `<skill>`, `<stack>`.

## `<skill>`

| Attribute | Meaning |
|---|---|
| `name` | **Required.** Identity; its slug is used in classes and URL fragments (`#web-app/gdsc`) |
| `id`, `icon`, `info` | Optional id override, icon, description |
| `group` | Tabs are grouped by this value |
| `stack` | Legacy list form; prefer nested `<stack>` |

May contain `<stack>`; those stacks show when this skill is focused.

## `<stack>`

| Attribute | Meaning |
|---|---|
| `name` | **Required.** Tool or technology |
| `id`, `icon`, `link` | Optional id, icon, homepage |
| `tag` | Short chip label |

Directly inside `<expertise>` it is shown when no skill is focused.

## How a slide is chosen

| Situation | Slides shown | Version of each project |
|---|---|---|
| No skill focused | Projects with `featured="true"` | Its slide marked `featured`, else its first public slide |
| Skill focused | Every project with a slide for that skill | That skill's slide (media, description, stack, tags) |
| Search | Every project with a matching slide | Best matching slide *(planned; see [feature status](../feat/expertise.md))* |

The address reflects the choice (`#{skill}/{project_id}`; the featured view is currently `#expertise/{project_id}`). Each project occupies one carousel slide, one dot and one timeline marker; its slides become variations inside that position. **A skill can belong to only one public slide per project.**

## Timeline

Events and projects both appear; the focused skill/stack filters them. Overlapping periods get extra lanes to the left. Portrait screens show equal-spaced entries. All geometry is computed at build time.

## Related

[Contract and status](../feat/expertise.md) · [project](project.md) · [event](event.md)
