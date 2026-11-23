/* Pure scene timing shared by preview and offline rendering. All times are seconds. */
export type Scene = {
    name: string; text: string; duration: number; image?: string; audio?: string
    background: string; color: string
}
export type Segment = Scene & { start: number; end: number }
export type Timeline = { title: string; segments: Segment[]; duration: number }

export function make_timeline(title: string, scenes: Scene[]): Timeline {
    let duration = 0
    const segments = scenes.map(scene => {
        if (!Number.isFinite(scene.duration) || scene.duration <= 0 || scene.duration > 600) throw new Error("Invalid scene duration")
        const start = duration
        duration += scene.duration
        if (duration > 3600) throw new Error("Blog media must be at most one hour")
        return { ...scene, start, end: duration }
    })
    return { title, segments, duration }
}

export function scene_at(timeline: Timeline, time: number): Segment | null {
    if (!timeline.segments.length) return null
    const at = Number.isFinite(time) ? Math.max(0, Math.min(time, timeline.duration)) : 0
    return timeline.segments.find(scene => at >= scene.start && at < scene.end) ?? timeline.segments[timeline.segments.length - 1]
}
