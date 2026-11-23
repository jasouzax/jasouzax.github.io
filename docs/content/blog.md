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

Required: `id`, `name`. Optional: `date`, `icon`, `info`, `lang`, `print`, `private`, `noindex`. Children: `<menu>`, `<window>` (the desk's starting condition; see [desk.md](desk.md)), `<blog>`, `<scene>`.

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

Book output is hidden while reading and replaces the desktop during printing. Chapter source changes invalidate the parent book's incremental build. See [print layouts](print.md) for size, font and style overrides. Scene headings, scripts, published images and window content also enter the book.

## Scenes and video

```xml
<blog id="lesson" name="A lesson" lang="en" print="book">
    <scene name="Introduction" duration="5" script="A reproducible explanation."
           image="diagram.svg" audio="narration.wav" background="#101827" color="#ffffff">
        <window path="example.rs" type="text/plain" edit/>
        <window split="1" type="text/plain" view/>
        <scene name="Next step" duration="3" script="Nested sections play after their parent."/>
    </scene>
</blog>
```

`name` is required. `duration` defaults to 6 seconds and must be greater than zero and at most 600 seconds. Total media duration is limited to one hour. Optional `script` (or scene text) becomes readable prose and the video caption. Optional `background`/`color` must be six-digit hex colors. `image`/`audio` resolve relative to the XML and are published as hashed assets; only local published assets enter the video. Downloaded assets are limited to 64 MiB each; SVG rasterization requires intrinsic dimensions of at most 8192 pixels per axis. Nested `<scene>` and `<window>` are supported; window split IDs refer to earlier window siblings within that scene.

Scenes generate H2/H3/etc. reading sections and interactive windows in a fixed, scrolling desk in both orientations. Editing a reading window does not change the authored video. The preview uses a 960×540 Canvas driven by animation frames, with Play/Pause and a seek slider. Audio starts only after a user gesture and is stopped/restarted on pause/seek. Navigation disposes animation, audio, decoded images and pending exports.

**Render 1080p video** creates a downloadable VP9/Opus WebM using WebCodecs. It renders 1920×1080 frames at 30 fps with encoder backpressure and mixes published scene audio at its authored start time using OfflineAudioContext. Rendering is independent of real-time playback speed. Cancel works during preparation and encoding. Export requires a secure browser context with compatible WebCodecs encoders; unsupported browsers keep the readable page. Frames are repeatable for the same authored data/assets/browser fonts; byte-identical encoded video across devices is not promised. Fonts come from the browser's sans-serif family. Long text is wrapped and clipped to the slide; divide long scripts into more scenes. This initial renderer supports text and images; executable windows, arbitrary diagram/animation plugins and network-only media are not captured.

## Related

RSS 2.0 and Atom subscriptions are generated at `/blogs/rss.xml` and `/blogs/atom.xml` (prefix with `/ja`, etc. for other configured languages). HTML includes feed autodiscovery links. Only public, indexable blogs in that language appear. Entries contain the title, summary, canonical URL and an ISO publication date when authored; otherwise the build date is used. No private content or script is included in feed bodies.

[desk](desk.md) · [contract](../feat/objects.md)
