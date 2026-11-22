/** Research layout geometry/typography, embedded only in the selected print stylesheet. */
export function research_print_css(size = "a4"): string {
    const paper = ({ a4: "A4", a5: "A5", letter: "letter", legal: "legal" } as Record<string, string>)[size.toLowerCase()] ?? "A4"
    return `
@page { size: ${paper}; margin: 18mm; @bottom-center { content: counter(page); font: 9pt Georgia, serif; color: #333; } }
html:has(.research_paper), body:has(.research_paper) {
    height: auto !important; min-height: 0 !important; overflow: visible !important;
    background: white !important; color: black !important; scroll-snap-type: none !important;
}
body:has(.research_paper) { margin: 0 !important; padding: 0 !important; }
body:has(.research_paper)::before, body:has(.research_paper)::after { display: none !important; }
body:has(.research_paper) > :not(main), body:has(.research_paper) > main > :not(.research_paper) { display: none !important; }
body:has(.research_paper) > main, .research_paper {
    display: block !important; position: static !important; width: auto !important; max-width: none !important;
    height: auto !important; min-height: 0 !important; overflow: visible !important; margin: 0 !important; padding: 0 !important;
}
.research_paper { font: 11pt/1.5 var(--research-font, Georgia), 'Times New Roman', serif !important; overflow-wrap: anywhere; }
.research_paper, .research_paper * { color: black !important; background: transparent !important; text-shadow: none !important; box-shadow: none !important; animation: none !important; transition: none !important; }
.research_paper header { display: block !important; position: static !important; text-align: center; margin: 0 0 2em; }
.research_paper h1 { font: bold 18pt/1.25 var(--research-font, Georgia), 'Times New Roman', serif !important; margin: 0 0 .5em !important; }
.research_paper h2 { font: bold 13pt/1.3 var(--research-font, Georgia), 'Times New Roman', serif !important; margin: 1.5em 0 .5em !important; break-after: avoid; }
.research_paper p { margin: .5em 0 !important; white-space: normal; orphans: 3; widows: 3; }
.research_paper_section { display: block !important; position: static !important; margin: 0 !important; padding: 0 !important; }
.research_paper ol { display: block !important; list-style: decimal outside !important; margin: .5em 0 !important; padding-left: 1.5em !important; }
.research_paper li { display: list-item !important; margin: .5em 0 !important; }
.research_paper_point_name { display: block; break-after: avoid-page; }
.research_paper_point_name + p { break-before: avoid-page; }
.research_paper_source { font-size: 9pt; }
.research_paper a { text-decoration: underline; }
`
}
