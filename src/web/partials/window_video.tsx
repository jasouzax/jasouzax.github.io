import { jsx, fragment, type child } from "../vnode.tsx"
export function window_video(src: string, mime: string, label: string): child {
    return (
        <div class="desk_wbox_body_media">
            <video
                class="desk_wbox_body_media_video"
                controls
                playsinline
                preload="metadata"
                aria-label={label}
            >
                <source src={src} type={mime} />
                <a href={src}>{label}</a>
            </video>
        </div>
    )
}
