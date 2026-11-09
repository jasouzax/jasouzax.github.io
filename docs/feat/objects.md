# Projects, events and blogs

> Status checklist and technical contract. Overview of all features: [README.md](README.md). Developer entry: [../README.md](../README.md).

- **Code:** `src/objects.ts`, `content/projects.xml`, `content/blogs/`, `src/web/html_desk.tsx`
- **Related guides:** [docs/content/project.md](../content/project.md), [docs/content/event.md](../content/event.md), [docs/content/blog.md](../content/blog.md)
- **Component numbers** such as `1.4` are stable ids used across the docs (index in [README.md](README.md#component-number-index)).

## Status

`[x]` implemented and verified, `[ ]` still to do, `~~struck~~` cancelled or superseded. A checked parent needs all its children checked.

- [x] Generate project, event and blog pages plus `/projects`, `/blogs` listings from roots (1.5–1.7)
- [x] Exclude private projects and slides from generated public resources and pages
- [x] Project `<research>` block renders an Overview menu (terminology … results)
- [x] Slides act as skill variations inside one carousel position; the footer switches skill in place
- [ ] Load repository Files/Version snapshots from the personal server (1.5)
- [ ] Contributor-only Agent menu (1.5)
- [ ] Repository change scanning (`repo` attribute) applied at build time
- [ ] `/srv/events/{id}` and `/srv/repo/{id}` mounted in the browser filesystem (see [filesystem](filesystem.md))

## Contract

*This is the target contract; a described capability is not a claim that it has shipped. The status list above is authoritative.*

## 1.5 Project `<project>`

**Objective.** Make each project one place that holds its description, its files and history, and its workspace, and let it appear in the expertise automatically in as many skill versions as the owner wants.

**Solution.** A project is a **generator**: from one element the engine produces the project page at `/projects/{id}` (the path is fixed by the type, so only `id` is given), its desk, and its expertise entries. The desk acts as the project's workspace. `repo="~/repo/linux_remake"` assigns the project's repository on the owner's private server (the codebase itself lives there with many repositories); the engine also scans that repository for changes and applies them, unless the project is private. In the virtual filesystem the repository is `/srv/repo/{id}`.

Generated desk menu tabs:

- **Files** - the repository tree. A hard-coded snapshot is rendered as a failsafe if JavaScript fails; at runtime the tab reads the newest data from the server so it is never stale, and it fails (keeping the snapshot with a notice) when the server is down.
- **Version** - the commit and branch timeline; same snapshot and live behavior.
- **Agent** - the agents' conversation for the project; visible only to a signed-in contributor. Likewise, files are editable and programs executable only for a signed-in contributor; everyone else gets a read-only view with in-memory changes.
- the project's description and any windows it declares.

The engine also generates `/projects` (a desk listing every project, a map of them, featured projects as cards).

**Interface.** `<project id name date icon featured role sub short note repo private skill stack>`:

| Attribute | Meaning |
|---|---|
| `id` | Identity; the page is `/projects/{id}`, the repository `/srv/repo/{id}` |
| `name`, `date`, `icon`, `role`, `sub`, `short`, `note` | Display and timeline data |
| `featured` | `bool`; included in the expertise slideshow when no skill is focused |
| `repo` | Repository location on the private server, e.g. `~/repo/linux_remake` |
| `private` | `bool`; when `true` the project is excluded from rendering, watching and generation |
| `skill`, `stack` | `list`; extra skills and stacks for the timeline (slides add their own) |

Children:

- `<slide media alt description skill stack hashtags tags featured private>` - one version of the project for the expertise slideshow (1.3). `media` is the picture, video or diagram; `alt` its alternative text; `description` the explanation (an attribute, or the element's text); `skill` is a `list`, so one slide can serve several skills; `stack` its tools; `hashtags` and `tags` its labels; `featured` makes it the project's default version; `private="true"` excludes it. A slide may contain `<action icon text link primary>` children.
- `<menu>` and `<window>` extend the generated desk.

## 1.6 Event `<event>`

**Objective.** Represent a period or moment of experience, education, certification or competition with its own explanation and sub-events.

**Solution.** An event is a **generator**: one element produces its page at `/events/{id}`, a timeline entry for the expertise, and entries in print modes that list experience or education (1.13). Its desk has only a menu and a main window: the menu lists the event's sub-events as a tree; the main window explains the selected one. Its resources are `/srv/events/{id}` in the virtual filesystem.

**Interface.** `<event id name sub date icon type skill stack featured info note image>` with child `<event>` for sub-events. `type` is `education`, `experience`, `certification`, `competition` or `other`.

## 1.7 Blog `<blog>`

**Objective.** Let the owner publish technical writing that visitors can read and also run, edit and experiment with.

**Solution.** A blog is a **generator**: one element produces the page `/blogs/{id}` and its `<desk auto="true">`; its files are `/srv/blogs/{id}`. Windows whose source is known at build time are pre-rendered into the HTML (markdown as HTML, code as `<pre>`), so search engines and no-JavaScript readers get the article, while JavaScript turns them into live windows. Visitors may edit any window or run any program, but `/srv` is shared and read-only, so edits vanish on refresh; they can copy files to `/home/user`. `/blogs` is generated as a desk listing posts. Blogs are flat (no categories) and are not part of the expertise.

**Interface.** `<blog id name date icon info>` with children `<menu>` and `<window>` (the desk's starting condition). Relative paths in windows (`path="intro.md"`) are resolved from the blog's XML file and published as `/srv/blogs/{id}/intro.md`.
