export type mime_info = { mime: string, icon: string, label: string, extensions: string[] }

export const mime_table: mime_info[] = [
    { mime: "inode/directory", icon: "[folder]", label: "Folder", extensions: [] },
    { mime: "message/cpim", icon: "[contact]", label: "Messages", extensions: [] },
    { mime: "text/x-c", icon: "[code]", label: "C source", extensions: ["c", "h"] },
    { mime: "text/x-c++src", icon: "[code]", label: "C++ source", extensions: ["cpp", "cc", "hpp"] },
    { mime: "text/x-python", icon: "[code]", label: "Python", extensions: ["py"] },
    { mime: "text/javascript", icon: "[code]", label: "JavaScript", extensions: ["js", "mjs"] },
    { mime: "text/markdown", icon: "[markdown]", label: "Markdown", extensions: ["md"] },
    { mime: "text/plain", icon: "[file]", label: "Plain text", extensions: ["txt"] },
    { mime: "application/json", icon: "[file_json]", label: "JSON", extensions: ["json"] },
    { mime: "image/png", icon: "[image]", label: "PNG", extensions: ["png"] },
    { mime: "image/jpeg", icon: "[image]", label: "JPEG", extensions: ["jpg", "jpeg"] },
    { mime: "image/webp", icon: "[image]", label: "WebP", extensions: ["webp"] },
    { mime: "image/gif", icon: "[image]", label: "GIF", extensions: ["gif"] },
    { mime: "image/svg+xml", icon: "[image]", label: "SVG", extensions: ["svg"] },
    { mime: "video/mp4", icon: "[file_video]", label: "MP4 video", extensions: ["mp4"] },
    { mime: "video/webm", icon: "[file_video]", label: "WebM video", extensions: ["webm"] },
    { mime: "audio/mpeg", icon: "[audio_file]", label: "MP3 audio", extensions: ["mp3"] },
    { mime: "audio/wav", icon: "[audio_file]", label: "WAV audio", extensions: ["wav"] },
    { mime: "audio/ogg", icon: "[audio_file]", label: "Ogg audio", extensions: ["ogg", "oga", "opus"] },
    { mime: "audio/flac", icon: "[audio_file]", label: "FLAC audio", extensions: ["flac"] },
    { mime: "audio/mp4", icon: "[audio_file]", label: "AAC audio", extensions: ["m4a", "aac"] },
    { mime: "video/ogg", icon: "[file_video]", label: "Ogg video", extensions: ["ogv"] },
    { mime: "video/quicktime", icon: "[file_video]", label: "QuickTime video", extensions: ["mov"] },
    { mime: "image/avif", icon: "[image]", label: "AVIF", extensions: ["avif"] },
    { mime: "image/bmp", icon: "[image]", label: "BMP", extensions: ["bmp"] },
    { mime: "image/x-icon", icon: "[image]", label: "Icon", extensions: ["ico"] },
    { mime: "text/html", icon: "[file_web]", label: "HTML", extensions: ["html", "htm"] },
    { mime: "text/css", icon: "[file_style]", label: "CSS", extensions: ["css", "scss"] },
    { mime: "text/csv", icon: "[file_table]", label: "CSV", extensions: ["csv"] },
    { mime: "text/xml", icon: "[code]", label: "XML", extensions: ["xml"] },
    { mime: "text/x-shellscript", icon: "[file_script]", label: "Shell script", extensions: ["sh", "bash"] },
    { mime: "application/typescript", icon: "[code]", label: "TypeScript", extensions: ["ts", "tsx"] },
    { mime: "application/pdf", icon: "[file_pdf]", label: "PDF", extensions: ["pdf"] },
    { mime: "application/zip", icon: "[file_archive]", label: "ZIP archive", extensions: ["zip"] },
    { mime: "application/x-pid", icon: "[file_script]", label: "Process", extensions: [] },
    // Automation types of the /server desk: a script that keeps running on the personal server, and a live site feed (docs/feat/server.md)
    { mime: "application/auto-javascript", icon: "[file_script]", label: "Automation script", extensions: ["auto.js"] },
    { mime: "application/auto-site", icon: "[file_web]", label: "Automation site", extensions: ["auto.site"] },
    { mime: "application/octet-stream", icon: "[file_binary]", label: "Binary data", extensions: ["bin", "exe", "dat"] },
]

// The entry whose extension ends the file name. An extension may hold dots ("auto.js"); the longest match wins, so "run.auto.js" is not plain "js".
export function find_by_name<T extends { extensions: string[] }>(table: readonly T[], name: string): T | undefined {
    const lower = name.toLowerCase()
    let best: T | undefined
    let best_length = 0
    for (const info of table) {
        for (const extension of info.extensions) {
            if (extension.length > best_length && lower.length > extension.length + 1 && lower.endsWith(`.${extension}`)) { best = info; best_length = extension.length }
        }
    }
    return best
}

export function mime_from_name(name: string): string {
    return find_by_name(mime_table, name)?.mime ?? ""
}

export function mime_info_of(mime: string): mime_info | undefined {
    return mime_table.find(info => info.mime === mime)
}

export function mime_siblings(mime: string): mime_info[] {
    const group = mime.split("/")[0]
    const same = mime_table.filter(info => info.mime.startsWith(group + "/"))
    return same.length > 0 ? same : mime_table
}
