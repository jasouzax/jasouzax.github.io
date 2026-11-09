# `<blog>`

Technical writing that visitors can read **and run, edit and experiment with**. Back to [content guide](README.md).

```xml
<blog lang="en" id="chaos-theory" name="Chaos theory, drawn" icon="[blog]" info="A tour of the logistic map.">
    <window path="chaos_theory/index.md" type="text/markdown" mode="view"/>
</blog>
<blog lang="ja" id="chaos-theory" name="カオス理論を描く" icon="[blog]" info="…">
    <window path="chaos_theory/index.ja.md" type="text/markdown" mode="view"/>
</blog>
```

A blog is a **generator**: it produces the page `/blogs/{id}` with a `<desk auto="true">`, and its files appear at `/srv/blogs/{id}`. `/blogs` is a generated listing. Blogs are flat (no categories) and not part of expertise.

Required: `id`, `name`. Optional: `date`, `icon`, `info`, `lang`. Children: `<menu>`, `<window>` (the desk's starting condition; see [desk.md](desk.md)).

- Relative `path`s (`path="intro.md"`) resolve from the blog's XML file and are published as `/srv/blogs/{id}/intro.md`.
- Windows whose source is known at build time are **pre-rendered** (markdown as HTML, code as `<pre>`), so the article exists without JavaScript; JavaScript upgrades them to live windows.
- `/srv` is shared and read-only for visitors: their edits are in-memory overlays that vanish on refresh; they can copy files into `/home/user`.
- Put translations in the same file, one root per language, same `id`.

## Related

[desk](desk.md) · [contract](../feat/objects.md)
