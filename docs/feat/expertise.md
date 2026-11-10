# Expertise

> Status checklist and technical contract. Overview of all features: [README.md](README.md). Developer entry: [../README.md](../README.md).

- **Code:** `src/expertise.ts`, `src/web/html_expertise.tsx`, `src/web/client/expertise.ts`, `src/web/client/search.ts`, `src/web/client/pager.ts`
- **Related guides:** [docs/content/expertise.md](../content/expertise.md)
- **Component numbers** such as `1.4` are stable ids used across the docs (index in [README.md](README.md#component-number-index)).

## Status

`[x]` implemented and verified, `[ ]` still to do, `~~struck~~` cancelled or superseded. A checked parent needs all its children checked.

- [x] Derive expertise entries from every event, project and slide; keep the declared skill/stack vocabulary (1.3)
- [x] Select per-skill project slides and fall back to the featured (or first public) slide
- [x] Compute timeline geometry, lanes and slideshow order at build time per scenario
- [ ] Finish skill-specific slideshow behaviour
  - [x] Per-skill slide selection and featured fallback
  - [ ] Deduplicate search results across variants and rank the best matching slide
  - [ ] Support skill/stack radio filtering without `:has` and without version fragments
  - [ ] Respect nested skill stacks and report undeclared vocabulary consistently
  - [ ] Adopt the planned `#all/{project_id}` fragment (today: `#expertise/{project_id}` and `#{skill}/{project_id}`; old bookmarks must keep working)

## Contract

*This is the target contract; a described capability is not a claim that it has shipped. The status list above is authoritative.*

## 1.3 Expertise `<expertise>`

**Objective.** Let a visitor browse the owner's experience, education, projects, certifications and competitions graphically, and instantly see each project through the skill they care about.

**Solution.** The component has no attributes. Its **entries** are never hand-written: they are detected from every `<event>` (1.6) and every `<project>` and its `<slide>`s (1.5). Blogs are not part of it. Its **vocabulary** (which skills and stacks exist, how they look and group) is declared by its children. A skill or stack that entries reference but the expertise does not declare is not shown and has no alternate versions (a build warning is raised); a declared skill with no entries has an empty page. For example, without `<skill name="iot"/>` there is no IoT page and no slide has an IoT version.

Filtering uses radio inputs placed before the content so selectors such as `#skill_iot:checked ~ .expertise_body .slide:not(.skill_iot)` work without JavaScript and without `:has()`. All geometry is computed at build time (2.4.4).

Sub-components:

1. **Skill head** - tabs, one per declared skill, grouped by `group`. Exactly one skill or none is focused. Focusing a skill updates the whole component to it. A clear control returns to none. Beside the skills, the **stacks** are shown: the stacks of the focused skill, or the expertise's own stacks when no skill is focused. A stack filters in the same one-at-a-time way, within the current skill.
2. **Search** - text search over every entry regardless of the focused skill. It matches names, descriptions, media alternative text, tags and hashtags of every slide, so a result can be a slide of a skill that is not focused.
3. **Timeline** - vertical continuous time axis with dots for point events and rectangles for periods. Overlapping periods are placed in the next lane to the left. On portrait screens the axis becomes equal-spaced entries with no rectangles. Events and projects both appear; the focused skill and stack filter them.
4. **Slideshow** - the slide on the center, a filter strip above it, a button to view all projects (`/projects`), and slide navigation below. A slide is one **version of a project for one skill**.

**Slide selection.** A project (1.5) has one slide per skill. For each project the slideshow decides which version to show:

| Situation | Slides shown | Version of each project |
|---|---|---|
| No skill focused | Projects with `featured="true"` | Its slide marked `featured`, else its first slide |
| Skill focused | Every project that has a slide for that skill | That skill's slide (media, description, stack and tags change) |
| Search | Every project with a matching slide | The best matching slide, even if another is featured |

Example: an IoT traffic tracker has an IoT slide (the system diagram and an explanation of the IoT system) and an AI slide (image-recognition footage and an explanation of the model). With IoT focused the slide shows the diagram; with AI focused it shows the footage; a search for "recognition" shows the AI version without focusing the skill.

The slide's hashtags move to its head, and the filter strip holds **the skills that slide's project has versions for**. Clicking one switches the same project to that skill's version. The address reflects the choice as `#{skill}/{project_id}` (`#iot/traffic_tracker`, `#ai/traffic_tracker`; `#all/{project_id}` with no skill) so a version can be linked.

**Interface.**

- `<skill name icon group info>` - a skill. `name` is the identity (its slug is used in classes and addresses). May contain `<stack>`.
- `<stack name icon tag link>` - a tool or technology; `tag` is a short chip label. Inside `<skill>` it belongs to that skill; directly inside `<expertise>` it is shown when no skill is focused.
- Events and projects join the vocabulary through their `skill` and `stack` attributes (and slides through theirs); many to many.
