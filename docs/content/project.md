# `<project>`, `<slide>`, `<research>`, `<pipeline>`

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
| `id` | Identity; page `/projects/{id}`, bare repository `{repos_dir}/{id}.git` on the personal server, static clone URL `/projects/{id}.git`, subdomain redirect `{id}.{domain}` |
| `name` | Full title. `short` is used where space is tight |
| `short`, `sub`, `note`, `role`, `rank` | Display, timeline data and ordering (`rank` higher = earlier) |
| `date`, `icon` | See [value types](README.md#2-value-types) |
| `featured` | `bool`; included in the slideshow when no skill is focused. Its `featured="true"` slide (or first public slide) is used |
| `private` | `bool`; excludes the project from rendering, watching and generation |
| `repo` | External Git repository synchronized by the personal server: `github.com/org/repo`, `https://host/org/repo.git`, `ssh://git@host/org/repo.git`, or `git@host:org/repo.git`. Hostname/path expands to HTTPS. Credentials and local paths belong in the server’s private Git/server configuration. The attribute and pipeline commands are excluded from generated page payloads |
| `stack`, `feature_stack` | `list`; extra stacks for the timeline. `feature_stack` is the set shown while no skill is focused |
| `website`, `source`, `paper`, `event` | Action buttons: *View Website / Source Code / Paper / Event*. They stay visible while slide content crossfades |
| `lang` | Language of this root; keep translations in the same file |
| `media`, `poster`, `alt`, `tags`, `menu`, `image`, `keywords`, `canonical`, `robots`, `lastmod`, `cover`, `print`, `noindex`, `path` | Shared attribute pool; rarely needed here |

**Not allowed on `<project>`:** `skill` and `info` (put them on slides). Unknown attributes are errors.

Children: `<slide>`, `<menu>`, `<window>`, `<action>`, `<research>`, `<pipeline>`. Multiple pipelines are allowed, each with a distinct branch. The first pipeline is the primary deployment branch; keep that order consistent across branches and translations.

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


## `<pipeline>` — repository synchronization and CI/CD

A project with `repo` or `<pipeline>` becomes a managed personal-server project. Its bare repository is created automatically at `{repos_dir}/{id}.git`. The server synchronizes each declared pipeline branch with `repo`, using the server account's SSH key or HTTPS credential helper. Git providers are ordinary Git remotes; there is no GitHub-specific API or webhook requirement.

```xml
<project id="example" name="Example" date="Jan 2026" repo="gitlab.com/team/example">
    <pipeline branch="main" poll_seconds="60">
        <step name="Install CI dependencies" command="npm" args='["ci"]'/>
        <step name="Test" command="npm" args='["test"]' timeout_seconds="900"/>
        <step name="Prepare build" phase="build" command="npm" args='["ci"]'/>
        <step name="Build" phase="build" command="npm" args='["run","build"]'/>
        <step name="Deploy" phase="deploy" command="node" args='["scripts/deploy.mjs","dist"]' credentials="HOSTING_TOKEN"/>
    </pipeline>
    <slide skill="web-app" info="Project description."/>
</project>
```

The real Jazu definition in [content/projects.xml](../../content/projects.xml) declares its npm installation, types, tests, content check, build and Cloudflare Pages/R2 publication with these same generic rules. No project-specific pipeline commands are hardcoded in the server. Projects without a pipeline synchronize committed changes without running build/deploy commands. `<pipeline branch="main"/>` can select a non-default branch for a sync-only repository.

For public projects, `repo` also supplies the preferred clone/fetch provider when deploying the Worker through Terraform. HTTPS providers and standard GitHub SSH URLs are supported for public read routing; absent/unavailable providers fall back to the Pi. Reapply Worker infrastructure after changing these declarations. Only the Worker receives the routing map; repository metadata remains excluded from public page payloads. Pushes always use the personal server. See [Git read routing](../src/node.md#provider-first-git-reads).

### Pipeline attributes

| Attribute | Default | Rule |
|---|---|---|
| `branch` | `master` | Git branch to receive, synchronize, test and deploy (unique within the project); a safe branch name without traversal, empty segments or `.lock` components |
| `poll_seconds` | `60` | Integer 10–86400; checks external and local checkout commits at startup and while the sequential runner is idle |

### `<step>` attributes

Steps are sequential and stop at the first failure. Their phases must appear in `ci`, `build`, `deploy` order. Step names must be unique within a pipeline.

| Attribute | Default | Rule |
|---|---|---|
| `name` | Required | Nonempty name shown in CI status and private logs |
| `command` | Required | Executable, such as `npm`, `node`, `python3`, `cargo` or a checked-in executable script |
| `args` | `[]` | JSON array of strings, passed as separate arguments; never an implicitly evaluated shell command |
| `phase` | `ci` | `ci`, `build`, or `deploy` |
| `timeout_seconds` | `600` | Integer 1–3600 |
| `credentials` | Empty | Comma-separated environment variable names, e.g. `CLOUDFLARE_API_TOKEN,CLOUDFLARE_ACCOUNT_ID`; permitted only for `deploy` steps. Values come from the private service environment, never XML. Runtime controls such as `HOME`, `PATH` and `NODE_OPTIONS` are rejected |

`node` uses the running Node executable. On Windows, `npm`/`npx` use their Node CLI without routing arguments through `cmd.exe`. Other Windows commands must be executables or Node scripts, rather than `.cmd`/`.bat` files. For complex commands, put the logic in a versioned script and pass its filename in `args`.

The supported argument substitutions are:

| Variable | Meaning |
|---|---|
| `${project}` | Project id |
| `${branch}` | Pipeline branch |
| `${commit}` | Exact tested commit (or current checkout commit for a direct file-change build) |
| `${mirror_dir}` | Absolute path of the shared, approved public Git mirror overlay |
| `${publish_state}` | This project/branch's private publication fingerprint state file |

Unknown substitutions, malformed argument arrays, invalid phases, duplicate step names, duplicate pipeline branches and unknown attributes fail content validation. Arguments containing XML-sensitive characters still need normal XML escaping. Repository URLs must use HTTPS or SSH and cannot contain passwords; HTTPS URLs cannot contain an embedded username/token.

### Execution and visibility

1. An external branch update or a committed change in the Pi checkout fast-forwards the bare hub and queues CI. An authenticated push to the personal hub queues the same pipeline. Histories are never force-overwritten; divergence requires an owner to merge them.
2. `ci` steps run in a clean, isolated checkout of the exact commit, with a scrubbed environment. The existing local `build/` artifacts and `content/media/` inputs are restored when present. CI failure leaves the deployment checkout and public mirror at their approved version.
3. After CI passes, the server creates or fast-forwards the working checkout, switching to the selected pipeline branch when multiple branches are declared and synchronizes that tested commit to the external repository. The checkout cannot silently run an independently advanced, untested HEAD.
4. `build` steps run in the working checkout without service secrets injected into their environment. `deploy` steps then receive only their requested credential names. CI and build use different checkouts, which is why the npm example prepares dependencies in both.
5. Successful public project jobs queue the engine's build/publication pipeline to upload approved Git mirrors to Pages/R2. New public managed ids are published in `projects/git.json`; the Worker uses this catalog when `PUBLIC_PROJECTS_MANIFEST` is configured. Private projects are excluded from this catalog and from public mirrors.

Local changes must be committed before they synchronize. Uncommitted edits are never sent upstream. Jazu retains its direct working-file build watcher; those CD-only builds do not synchronize uncommitted data. Matching branch tips do not generate another job, preventing a synchronization feedback loop.

A project marked `private="true"` remains private even when an operator has a public default. An operator may further restrict visibility or set `active: false` in `server.json`. Repository metadata and pipeline commands are server configuration, not rendered content. A managed project that is archived retains its last CI-approved mirror without exposing its review branches. Existing archive-only repositories retain their read-only behavior.

### Private paths and translations

The default working checkout for another project is `{state_dir}/work/{id}`. Private runtime state lives at `{state_dir}/projects/{id}/`, while job logs remain in the common `{state_dir}/runs/`. To reuse an existing repository in the Pi user's home directory, set its private path mapping:

```json
"projects": {
    "example": {
        "dir": "/home/jason/example",
        "path": "/home/jason/repos/example.git"
    }
}
```

The engine project's working path still comes from `site.dir`; `site.project` identifies the engine, not the only project allowed to run CI. Local paths are not accepted as `repo` URLs. Use `dir`/`path` in `server.json` for those paths. The old top-level `upstream` operator setting remains a compatibility input for the engine; new declarations belong in project XML and take precedence.

For translated `<project>` roots sharing an id, declare `repo`/`pipeline` once or repeat identical declarations. Conflicting repository URLs, branches, visibility or steps are rejected by the server catalog. The idle runner reloads the reviewed engine checkout's catalog after engine updates and creates hooks for newly managed projects. Changes committed only in a project's own upstream do not replace the engine's pipeline policy.


### Staging and other deployment branches

Declare another `<pipeline branch="staging">` under the same project, after the primary pipeline. Any branch name is supported; the listener has no Jazu or staging hostname logic. Each pipeline has its own ordered commands and deploy arguments. Jazu's concrete example builds with `--base_url https://staging.jasouza.com` and publishes with `--pages_project jazu-staging --branch staging --assets_bucket jazu-staging-assets`.

All branches share one deployment checkout and one sequential queue. The existing exact-commit CI workspace is reused across branches; no branch worktrees or second deployment repositories are created. CI passes before the server switches the deployment checkout, then runs that branch's build/deploy steps and leaves it checked out. Another branch update (or explicit `server run --branch ...`) switches it again. Dirty files, independently advanced target branches and divergent histories are refused rather than reset. A failed staging test does not change the deployed checkout.

Sync status, CI approval and publication state are isolated per branch. The primary branch retains its existing state paths; other branches use `branches/<URL-encoded-branch>/` below the project's state directory. Identical commits on two branches still run both pipelines. A declared upstream branch that has never existed is idle until created. Only owners/local operators may push any declared pipeline branch; collaborators with write tokens use review branches.

The public clone mirror continues to advertise only the primary branch and its approved tags. Staging does not change that mirror or queue a production mirror publication. A CD-only mirror-publication request for the primary engine branch is deferred while its checkout is on another branch; it is included when the primary branch next updates. Direct file edits run the pipeline of the currently checked-out declared branch.

Use `server run --project <id> --branch staging`, `server status --project <id> --branch staging`, or `GET /api/v1/ci/<id>/runs?branch=staging`. For Jazu deployment instructions after merging this feature, see [staging setup](../infra-staging.md). Keep all engine branches on a version supporting branch pipelines; incompatible old workers fail their capability check before executing a pipeline.
