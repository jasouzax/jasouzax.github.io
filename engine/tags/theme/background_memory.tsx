import { jsx, fragment, type child } from "../../../shared/vnode/vnode.tsx"
import { raw } from "../page/markup.tsx"
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
