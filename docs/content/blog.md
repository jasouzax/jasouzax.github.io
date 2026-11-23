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

A blog is a **generator**: it produces the page `/blogs/{id}` with a `<desk auto="true">`, and its files appear at `/srv/blogs/{id}`. `/blogs` is a generated listing. Nested blogs form collections: a child `<blog id="intro">` under `<blog id="rust">` produces `/blogs/rust/intro` and owns `/srv/blogs/rust/intro`. IDs are safe URL segments, unique among siblings in each language; nested blogs inherit their parent's language unless explicitly specified. Blogs are not part of expertise.

Required: `id`, `name`. Optional: `date`, `icon`, `info`, `lang`, `print`, `private`, `noindex`. Children: `<menu>`, `<window>` (the desk's starting condition; see [desk.md](desk.md)), `<blog>`.

- Relative `path`s (`path="intro.md"`) resolve from the blog's XML file and are published as `/srv/blogs/{id}/intro.md`.
- Windows whose source is known at build time are **pre-rendered** (markdown as HTML, code as `<pre>`), so the article exists without JavaScript; JavaScript upgrades them to live windows.
- `/srv` is shared and read-only for visitors: their edits are in-memory overlays that vanish on refresh; they can copy files into `/home/user`.
- Put translations in the same file, one root per language, same `id`.
- `private="true"` excludes the entire blog subtree from pages, resources and books. `noindex="true"` keeps its page readable but excludes it from feeds and book collections.

## Books

Add `print="book"` to a blog or a collection parent, then print its page to paper/PDF. The built-in `<print name="book" lang="*" layout="book" size="a5"/>` supplies a cover, linked contents, chapter breaks and page numbers. Descendants appear depth-first in authored XML order, in the page's language only. Each chapter includes its published Markdown, plain/code text and image windows; browser edits, terminal/process output and network-only windows are not printed. The source link returns to the interactive chapter.

```xml
<blog id="rust" name="Learning Rust" lang="en" print="book">
    <window type="text/markdown" data="A collection of published lessons."/>
    <blog id="intro" name="Introduction">
        <window path="rust/intro.md" type="text/markdown" view/>
    </blog>
</blog>
```

Book output is hidden while reading and replaces the desktop during printing. Chapter source changes invalidate the parent book's incremental build. See [print layouts](print.md) for size, font and style overrides. Scene/Canvas video generation remains separate unfinished work.

## Related

RSS 2.0 and Atom subscriptions are generated at `/blogs/rss.xml` and `/blogs/atom.xml` (prefix with `/ja`, etc. for other configured languages). HTML includes feed autodiscovery links. Only public, indexable blogs in that language appear. Entries contain the title, summary, canonical URL and an ISO publication date when authored; otherwise the build date is used. No private content or script is included in feed bodies.

[desk](desk.md) · [contract](../feat/objects.md)
