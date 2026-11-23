# Blog scenes and media

- [?] Nested scenes validate duration, colors and media URIs, publish local resources, and render readable headings with fixed interactive windows.
- [?] Pure-time Canvas frames share a timeline between seekable preview and 1080p frame-by-frame VP9 WebCodecs export.
- [?] Published scene audio is scheduled during preview and mixed offline into an Opus WebM track; export supports progress and cancellation.
- [?] Scene reading content integrates with book printing and source changes invalidate incremental page hashes.
- [ ] Arbitrary scene renderer plugins and animated executable/diagram window projections.

The implementation lives in `shared/blog`, `shared/content/tags/scene.ts`, `engine/tags/scene.tsx` and `desk/blog`. Authoring and runtime limits are documented in [blog content](../content/blog.md#scenes-and-video). Tests cover safe JSON, publication/privacy, nested split IDs, timing boundaries, printing, portrait reading, Canvas seek equality, actual 1080p/Opus file metadata and cancellation.

The pinned, unmodified Mediabunny dependency handles WebCodecs encoding and WebM muxing. Builds include its MPL-2.0 license and a versioned source-package notice under `assets/vendor/`.

Verification on 2026-11-23: four Chrome checks pass, including a real 1920×1080 WebM containing a rasterized SVG and Opus audio, cancellation, unavailable encoders and portrait reading without JavaScript. Ten scene/book contracts pass locally; the combined Linux verification includes these alongside origin/cache and filesystem checks (20 passes). Root types, static generation and content checking pass; content retains 39 authoring warnings. The broad Windows suite without the separately verified WASM worker has 308 passes, four skips and four existing POSIX-path failures; the isolated WASM worker has 44 passes.

All fourteen existing book/server-desk Chrome regressions also pass. No production publication was performed.
