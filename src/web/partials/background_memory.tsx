import { jsx, fragment, type child } from "../vnode.tsx"
import { raw } from "../markup.tsx"
export function background_memory(slots: child): child {
    return (
        <>
            <div class={"background"} aria-hidden={"true"}>
                {slots}
                <canvas class={"background_canvas"}></canvas>
            </div>
        </>
    )
}
