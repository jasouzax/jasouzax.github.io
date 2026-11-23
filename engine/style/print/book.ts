/** Built-in book geometry, included only for a selected book print layout. */
export function book_print_css(size = "a5"): string {
    const paper = ({ a4: "A4", a5: "A5", letter: "letter", legal: "legal" } as Record<string, string>)[size.toLowerCase()] ?? "A5"
    return `
@page { size: ${paper}; margin: 17mm 15mm 19mm; @bottom-center { content: counter(page); font: 9pt Georgia, serif; } }
html:has(.blog_book), body:has(.blog_book) { height: auto !important; min-height: 0 !important; overflow: visible !important; background: white !important; color: black !important; scroll-snap-type: none !important; }
body:has(.blog_book) { margin: 0 !important; padding: 0 !important; }
body:has(.blog_book)::before, body:has(.blog_book)::after { display: none !important; }
body:has(.blog_book) > :not(main), body:has(.blog_book) > main > :not(.blog_book) { display: none !important; }
body:has(.blog_book) > main, .blog_book { display: block !important; position: static !important; width: auto !important; max-width: none !important; height: auto !important; min-height: 0 !important; overflow: visible !important; margin: 0 !important; padding: 0 !important; }
.blog_book { font: 11pt/1.5 var(--book-font, Georgia), serif !important; overflow-wrap: anywhere; }
.blog_book, .blog_book * { color: black !important; background: transparent !important; text-shadow: none !important; box-shadow: none !important; animation: none !important; transition: none !important; }
.blog_book header, .blog_book nav, .blog_book section, .book_prose { display: block !important; position: static !important; height: auto !important; overflow: visible !important; }
.blog_book h1 { font: bold 24pt/1.2 var(--book-font, Georgia), serif !important; margin: 0 0 1em !important; }
.blog_book h2 { font: bold 18pt/1.3 var(--book-font, Georgia), serif !important; margin: 1em 0 !important; break-after: avoid; }
.blog_book h3, .blog_book h4, .blog_book h5, .blog_book h6 { break-after: avoid; margin: 1em 0 .5em !important; }
.book_cover { padding-top: 25mm !important; }
.book_contents, .book_chapter { break-before: page; }
.blog_book p { margin: .6em 0 !important; orphans: 3; widows: 3; }
.blog_book ol, .blog_book ul { display: block !important; margin: .7em 0 !important; padding-left: 1.6em !important; }
.blog_book ol { list-style: decimal outside !important; }
.blog_book ul { list-style: disc outside !important; }
.blog_book li { display: list-item !important; }
.blog_book pre { display: block !important; font: 9pt/1.4 monospace !important; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid #aaa; padding: .6em !important; }
.blog_book code { font-family: monospace !important; }
.blog_book img { display: block; max-width: 100%; max-height: 170mm; object-fit: contain; }
.blog_book figure { margin: 1em 0 !important; break-inside: avoid; }
.blog_book table { border-collapse: collapse; width: 100%; }
.blog_book th, .blog_book td { border: 1px solid #aaa; padding: .3em; }
.book_chapter_number, .book_source { font-size: 9pt; }
.blog_book a { text-decoration: underline; }
`
}
