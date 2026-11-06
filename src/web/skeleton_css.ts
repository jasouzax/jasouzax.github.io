// This sheet is emitted in <head>, before the nonblocking theme link.
export const skeleton_css = `
@layer skeleton {
@property --skeleton-alpha { syntax: '<number>'; inherits: true; initial-value: 0; }
:root { color-scheme: light; --loading-bg: #f3f7fc; --loading-ink: #1b2430; --loading-gray: 100 108 118; --skeleton-alpha: 0; --skeleton-duration: 1.5s; }
:root[data-mode="dark"] { color-scheme: dark; --loading-bg: #04060c; --loading-ink: #e6f1fb; --loading-gray: 166 175 188; }
@media (prefers-color-scheme: dark) {
    :root:not([data-mode="light"]) { color-scheme: dark; --loading-bg: #04060c; --loading-ink: #e6f1fb; --loading-gray: 166 175 188; }
}
:root { background: var(--loading-bg); color: var(--text, var(--loading-ink)); }
:root[data-skeleton] { background: var(--loading-bg) !important; transition: --skeleton-alpha .32s ease; }
:root[data-skeleton="loading"] { --skeleton-alpha: 1; }
:root[data-skeleton="revealing"] { --skeleton-alpha: 0; }
:root[data-skeleton] #theme_background { visibility: hidden; }
:root[data-skeleton] body::before, :root[data-skeleton] body::after { opacity: 0 !important; }
:root[data-skeleton] :is(#head > :not(#head_signature), #main-content, .site_foot) { pointer-events: none; }
:root[data-skeleton="loading"] :is(#head > :not(#head_signature), #main-content, .site_foot),
:root[data-skeleton="loading"] :is(#head > :not(#head_signature), #main-content, .site_foot) * {
    color: transparent !important; -webkit-text-fill-color: transparent !important;
    text-shadow: none !important; caret-color: transparent !important;
}
:root[data-skeleton="revealing"] :is(h1,h2,h3,h4) {
    color: var(--text, var(--loading-ink)) !important; -webkit-text-fill-color: currentColor !important;
}
:root[data-skeleton] :is(#main-content, #head > :not(#head_signature), .site_foot) * {
    animation: none !important;
}
:root[data-skeleton] :is(.expertise_head, .expertise_box, .desk_wbox, .desk_side) { opacity: 1 !important; }
:root[data-skeleton] :is(h1,h2,h3,h4,p,button,input,textarea,select,summary,
    .landing_contact,.landing_btn,.chip,.desk_folder_tile,.desk_view,
    #head_path > a,#head_tabs > a,.site_foot > a) {
    background-image: linear-gradient(115deg,
        rgb(var(--loading-gray) / calc(.13 * var(--skeleton-alpha))) 20%,
        rgb(var(--loading-gray) / calc(.29 * var(--skeleton-alpha))) 45%,
        rgb(var(--loading-gray) / calc(.13 * var(--skeleton-alpha))) 70%) !important;
    background-size: 240% 100% !important;
    background-clip: border-box !important; -webkit-background-clip: border-box !important;
    background-color: rgb(var(--loading-gray) / calc(.07 * var(--skeleton-alpha))) !important;
    outline: 1px solid rgb(var(--loading-gray) / calc(.25 * var(--skeleton-alpha))) !important;
    outline-offset: -1px;
    border-color: transparent !important;
    box-shadow: none !important;
    animation: skeleton_shine var(--skeleton-duration) linear infinite !important;
}
:root[data-skeleton="loading"] :is(#head > :not(#head_signature), #main-content, .site_foot) :is(svg,canvas,video,iframe) { visibility: hidden !important; }
:root[data-skeleton="loading"] #main-content img { object-position: -100000px -100000px !important; background: rgb(var(--loading-gray) / .18); }
:root[data-skeleton="loading"] :is(#head > :not(#head_signature), #main-content, .site_foot) *::before,
:root[data-skeleton="loading"] :is(#head > :not(#head_signature), #main-content, .site_foot) *::after { visibility: hidden !important; }
#head_signature { color: var(--text, var(--loading-ink)); }
:root.js:not(.intro) #head_signature { animation: none !important; }
@keyframes skeleton_shine { from { background-position: 140% 0; } to { background-position: -100% 0; } }
@media (prefers-reduced-motion: reduce) {
    :root { --skeleton-duration: 0s; }
    :root[data-skeleton] { transition: none; }
    :root[data-skeleton] :is(#main-content, #head) * { animation: none !important; }
}
:root:has(#motion_pause:checked) { --skeleton-duration: 0s; }
@media print {
    :root[data-skeleton] { --skeleton-alpha: 0; }
    :root[data-skeleton="loading"] :is(#head > :not(#head_signature),#main-content,.site_foot),
    :root[data-skeleton="loading"] :is(#head > :not(#head_signature),#main-content,.site_foot) * {
        color: revert !important; -webkit-text-fill-color: currentColor !important;
    }
}
}
`
