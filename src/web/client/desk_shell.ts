// Lazy registration only: command parsing and utilities execute in compiled WASM.

import { register_wasm, registered_programs } from "./wasm_host.ts"
import type { wasm_image } from "./wasm_protocol.ts"

const ready = fetch("/assets/wasm/manifest.json").then(async response => {
    if (!response.ok) throw new Error(`Cannot load executable manifest: ${response.status}`)
    const images: wasm_image[] = await response.json()
    for (const image of images) register_wasm(image)
})
;(window as Window & { jazu_desk_shell?: unknown }).jazu_desk_shell = { programs: registered_programs, ready, register_wasm }
