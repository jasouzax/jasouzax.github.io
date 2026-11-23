# Notebook windows

`desk/window/note.ts` selects Markdown editing/preview or the structured Jupyter editor in `note/notebook.ts`. The `notebook` plugin precedes the generic text fallback and handles `text/markdown` and `application/x-ipynb+json`. An `.ipynb` filename takes precedence over a generic JSON content type. Other JSON documents keep the ordinary text/hex editor.

The shared document adapter is `shared/notebook.ts`; the data-only renderer is `shared/notebook/render.tsx`. Both static window generation and blog book printing use the same renderer. The format follows [Jupyter's notebook format](https://nbformat.readthedocs.io/en/latest/format_description.html).

## Documents and preservation

Supported documents use nbformat 4, with a maximum of 2,000,000 UTF-8 bytes, 1,000 cells and 2,000 stored output records. IDs must be unique and valid when present; minor version 5 and later require them. Earlier version-4 documents retain their original version and optional IDs. Unsupported/invalid documents display a status and disable saving; selecting JSON in the MIME menu exposes the original bytes for repair. Version-3 notebooks require conversion outside this editor.

Code, Markdown and raw cells have editable sources. Unknown future cell types retain their fields and expose their source as plain text. Notebook/cell/output metadata, attachments, execution counts and unknown extension fields are preserved. Existing source arrays remain arrays when edited. An untouched save preserves the original JSON bytes exactly; an edited document uses indented JSON.

Add, move and delete cells with their controls. Undo/redo keeps up to twenty coalesced local snapshots. A received edit from another window resets that window's undo stack, preventing a stale undo from silently replacing the received document. Source changes retain stored output and execution counts; **Clear stored outputs** explicitly clears both. New code cells start with no outputs and a null execution count.

## Viewing and saving

View mode displays Markdown, code/raw sources, stored streams/errors and supported rich-output representations. Edit mode supplies source textareas and Markdown previews. Split mirrors share current bytes through `desk/plugin/flow.ts`; views also refresh from unsaved edits. Markdown files have live view/edit behavior at any resource path, including uploads and browser home files.

Save uses the existing document destination. A read-only source prompts for an explicit destination; `/home/user` persists through OPFS or the user's connected folder. Uploads remain in `/tmp`, so saving an uploaded document writes to temporary storage. Copy it into the home directory through the file manager when persistence is intended. No notebook is uploaded by the editor.

Stored output never runs code. HTML and unsupported MIME bundles are displayed as text, not injected markup. JavaScript, SVG, widgets and interactive HTML outputs remain inert. Notebook Markdown images render only from embedded raster attachments; image outputs also accept embedded PNG/JPEG/GIF/WebP data. Remote image references become their alt text without making a network request. Output clearing and editing do not change the source file until Save succeeds.

Cell execution and Jupyter kernel connections are not implemented. The status explicitly identifies results as stored output. Static page/print rendering uses the published notebook file, never the visitor's runtime drafts or account storage.

## Verification

Model tests cover version validation, immutable edits, IDs, line arrays, metadata/output preservation, structural operations and inert rich output. Static tests cover readable notebook cells and semantic book printing. Chrome regressions cover cell editing/reordering/undo, exact-byte saves, OPFS reloads, linked views/editors, dirty-state propagation, invalid-file recovery and Markdown live preview.
