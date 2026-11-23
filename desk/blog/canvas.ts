/* Every frame depends only on the timeline, decoded assets, dimensions and requested time. */
import { scene_at, type Timeline } from "../../shared/blog/timeline.ts"
import type { Assets } from "./assets.ts"

export function render_frame(context: CanvasRenderingContext2D, timeline: Timeline, assets: Assets, time: number): void {
    const { width, height } = context.canvas
    context.save()
    context.setTransform(width / 1920, 0, 0, height / 1080, 0, 0)
    context.globalAlpha = 1
    const scene = scene_at(timeline, time)
    context.fillStyle = scene?.background || "#101827"
    context.fillRect(0, 0, 1920, 1080)
    if (!scene) { context.restore(); return }
    const image = scene.image && assets.images.get(scene.image)
    let available = 1728
    if (image) {
        available = 840
        const scale = Math.min(840 / image.width, 760 / image.height)
        const w = image.width * scale, h = image.height * scale
        context.drawImage(image, 1000 + (840 - w) / 2, 180 + (760 - h) / 2, w, h)
    }
    context.fillStyle = scene.color
    context.textBaseline = "top"
    context.font = "bold 56px sans-serif"
    const wrap = (text: string, y: number, line_height: number, limit: number): number => {
        let line = "", rows = 0
        // Character wrapping also handles languages without spaces and long code tokens.
        for (const char of text.replace(/\r\n?/g, "\n")) {
            if (char === "\n" || context.measureText(line + char).width > available) {
                context.fillText(line, 96, y + rows++ * line_height)
                line = char === "\n" ? "" : char
                if (rows >= limit) return y + rows * line_height
            } else line += char
        }
        if (line && rows < limit) context.fillText(line, 96, y + rows++ * line_height)
        return y + rows * line_height
    }
    const y = wrap(scene.name, 100, 70, 3) + 35
    context.font = "32px sans-serif"
    wrap(scene.text, y, 46, Math.max(1, Math.floor((940 - y) / 46)))
    context.globalAlpha = 0.6
    context.font = "24px sans-serif"
    context.fillText(timeline.title, 96, 1010, 1500)
    context.fillRect(96, 980, 1728 * Math.max(0, Math.min(1, time / timeline.duration)), 5)
    context.restore()
}
