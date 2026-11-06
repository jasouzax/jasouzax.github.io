// Independent viewport overlay: theme paint and font swaps never resize it.
export const skeleton_css = `
@layer skeleton {
:root { background: var(--loading-bg); color: var(--loading-ink); --loading-ink: #1b2430; --loading-bg: #fff; --loading-gray: 100 108 118; }
:root[data-mode="dark"] { --loading-ink: #e6f1fb; --loading-bg: #000; --loading-gray: 166 175 188; }
@media (prefers-color-scheme: dark) { :root:not([data-mode="light"]) { --loading-ink: #e6f1fb; --loading-bg: #000; --loading-gray: 166 175 188; } }
:root[data-skeleton="loading"]:not([data-spa]) { background: var(--loading-bg) !important; }
:root[data-skeleton="loading"] :is(#main-content,.site_foot,#head > :not(#head_signature):not(#head_tray)), :root[data-skeleton="loading"] :is(#main-content,.site_foot,#head > :not(#head_signature):not(#head_tray)) * { visibility: hidden !important; }
:root[data-skeleton="loading"]:not([data-spa]) #head_tray > *, :root[data-skeleton="loading"]:not([data-spa]) #head_tray > * * { visibility: hidden !important; }
:root[data-skeleton]:not([data-spa]) .memory_bg, :root[data-background-wait] .memory_bg, :root[data-skeleton]:not([data-spa]) #theme_background, :root[data-background-wait] #theme_background { visibility: hidden !important; }
:root[data-spa] #loading_overlay::before { display: none; }
:root[data-skeleton] #head { z-index: 1001 !important; }
:root[data-skeleton="loading"]:not([data-spa]) #head::before { opacity: 0 !important; }
:root[data-skeleton]:not([data-spa]) body::before, :root[data-skeleton]:not([data-spa]) body::after { opacity: 0 !important; }
:root[data-skeleton] :is(#main-content,#head > :not(#head_tray),.site_foot) * { animation: none !important; }
:root[data-skeleton] .landing_role::after { animation: none !important; }
:root.theme_ready #head > * { animation: none !important; }
:root.js:not(.intro) #head_signature { animation: none !important; }
.loading_settled :is(.landing_panel > *, .landing_scroll, .expertise_head,.expertise_box,.desk_wbox,.desk_side),
.article.no_reveal :is(.expertise_head,.expertise_box,.desk_wbox,.desk_side) { animation: none !important; }
#head_path_logo { transform-box: view-box; transform-origin: center; }
:root[data-signature-intro] #head_signature::before { content: ''; display: block; width: calc(2em * 19 / 6.4); height: 2em; }
:root[data-signature-intro] #head_path_logo { position: fixed !important; left: 50vw !important; top: 50vh !important; translate: -50% -50% !important; width: 25vmin !important; height: auto !important; max-width: none !important; z-index: 1003; color: var(--text, var(--loading-ink)); filter: drop-shadow(0 0 2px var(--loading-bg)) drop-shadow(0 0 6px var(--loading-bg)) drop-shadow(0 0 12px var(--loading-bg)) !important; }
#loading_overlay { position: fixed; inset: 0; z-index: 999; pointer-events: none; overflow: hidden; animation: skeleton_enter .3s ease both; }
#loading_overlay::before { content: ''; position: absolute; inset: 0; background: var(--loading-bg); transition: opacity .45s ease; }
#loading_overlay.background_fade::before { opacity: 0; }
.loading_shapes { position: absolute; inset: 0; }
.loading_placeholder { position: absolute; overflow: hidden; border: 1px solid rgb(var(--loading-gray) / .25); background: rgb(var(--loading-gray) / .14); border-radius: 3px; }
.loading_shapes::after { content: ''; position: absolute; inset: 0; background: linear-gradient(110deg, transparent 20%, rgb(var(--loading-gray) / .28) 50%, transparent 80%); transform: translateX(-110%); animation: skeleton_shine 1.6s ease-in-out infinite; }
@keyframes skeleton_shine { to { transform: translateX(110%); } }
@keyframes skeleton_enter { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { #loading_overlay, .loading_shapes::after { animation: none; } #loading_overlay::before { transition: none; } }
:root:has(#motion_pause:checked) .loading_shapes::after { animation: none; }
:root[data-spa-transition] #head_signature { view-transition-name: spa-signature; }
:root[data-spa-transition] #theme_background { view-transition-name: spa-background; }
::view-transition { pointer-events: none; }
::view-transition-group(*) { animation: none; z-index: 3; }
::view-transition-group(root) { z-index: 1; }
::view-transition-group(spa-background) { z-index: 0; }
::view-transition-old(*) { display: none; }
::view-transition-new(*) { animation: none; mix-blend-mode: normal; }
::view-transition-old(root), ::view-transition-new(root) { mix-blend-mode: normal; animation: none; mask-size: 300% 300%; mask-repeat: no-repeat; }
::view-transition-old(root) { display: block; z-index: 2; mask-image: linear-gradient(135deg,transparent 40%,#000 60%); animation: spa_wipe .36s ease-in-out both; }
::view-transition-new(root) { z-index: 1; mask-image: linear-gradient(135deg,#000 40%,transparent 60%); animation: spa_wipe .36s ease-in-out both; }
::view-transition-old(spa-signature), ::view-transition-old(spa-tray), ::view-transition-old(spa-background) { display: none; }
::view-transition-new(spa-signature), ::view-transition-new(spa-tray), ::view-transition-new(spa-background) { animation: none; mix-blend-mode: normal; }
@keyframes spa_wipe { from { mask-position: 100% 100%; } to { mask-position: 0% 0%; } }
@media print { :root[data-signature-intro] #head_path_logo { position: static !important; translate: none !important; width: auto !important; height: 2em !important; } #loading_overlay { display: none; } :root[data-skeleton="loading"] :is(#main-content,.site_foot,#head > *,#head_tray > *) { visibility: visible !important; } }
}
`
