/* CLI responsibilities for tools/pack. */
import { resolve, join, relative, sep } from "node:path"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { deflateRawSync } from "node:zlib"
import { load_config } from "../../shared/config.ts"
import { inside } from "../../shared/paths.ts"
import { collect_unignored } from "../../engine/helper/gitignore.ts"

const crc_table = (() => {
    const table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        table[n] = c >>> 0
    }
    return table
})()

function crc32(data: Buffer): number {
    let crc = 0xffffffff
    for (let index = 0; index < data.length; index++) crc = crc_table[(crc ^ data[index]) & 0xff] ^ (crc >>> 8)
    return (crc ^ 0xffffffff) >>> 0
}

export function collect_files(path: string, found: string[] = []): string[] {
    const stat = statSync(path)
    if (stat.isFile()) {
        found.push(path)
        return found
    }
    for (const name of readdirSync(path).sort()) {
        if (name === "node_modules" || name === ".DS_Store") continue
        collect_files(join(path, name), found)
    }
    return found
}

function make_zip(entries: { name: string, data: Buffer, mtime: Date }[]): Buffer {
    const parts: Buffer[] = []
    const central: Buffer[] = []
    let offset = 0
    for (const entry of entries) {
        const name = Buffer.from(entry.name, "utf8")
        const crc = crc32(entry.data)
        const deflated = deflateRawSync(entry.data)
        const stored = deflated.length >= entry.data.length
        const body = stored ? entry.data : deflated
        const method = stored ? 0 : 8
        const d = entry.mtime
        const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
        const date = (Math.max(d.getFullYear() - 1980, 0) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()

        const local = Buffer.alloc(30)
        local.writeUInt32LE(0x04034b50, 0)
        local.writeUInt16LE(20, 4)
        local.writeUInt16LE(0x0800, 6) // utf-8 names
        local.writeUInt16LE(method, 8)
        local.writeUInt16LE(time, 10)
        local.writeUInt16LE(date, 12)
        local.writeUInt32LE(crc, 14)
        local.writeUInt32LE(body.length, 18)
        local.writeUInt32LE(entry.data.length, 22)
        local.writeUInt16LE(name.length, 26)
        local.writeUInt16LE(0, 28)
        parts.push(local, name, body)

        const header = Buffer.alloc(46)
        header.writeUInt32LE(0x02014b50, 0)
        header.writeUInt16LE(20, 4)
        header.writeUInt16LE(20, 6)
        header.writeUInt16LE(0x0800, 8)
        header.writeUInt16LE(method, 10)
        header.writeUInt16LE(time, 12)
        header.writeUInt16LE(date, 14)
        header.writeUInt32LE(crc, 16)
        header.writeUInt32LE(body.length, 20)
        header.writeUInt32LE(entry.data.length, 24)
        header.writeUInt16LE(name.length, 28)
        header.writeUInt32LE(offset, 42)
        central.push(header, name)

        offset += local.length + name.length + body.length
    }
    const central_size = central.reduce((sum, part) => sum + part.length, 0)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(entries.length, 8)
    end.writeUInt16LE(entries.length, 10)
    end.writeUInt32LE(central_size, 12)
    end.writeUInt32LE(offset, 16)
    return Buffer.concat([...parts, ...central, end])
}

export async function pack_command(project: string, file_name: string, additions: string[] = []): Promise<void> {
    const config = await load_config(project)
    const excluded = config.pack.exclude.map(path => {
        const target = resolve(project, path)
        if (!inside(project, target) || target === resolve(project)) throw new Error(`Unsafe pack exclusion: ${path}`)
        return target
    })
    const out = join(project, file_name)
    // The whole working tree minus whatever the root and nested .gitignore files exclude. Git is not consulted,
    // so this works without git or a .git folder, and tracked-but-ignored files are still left out.
    const files = new Set(collect_unignored(project, path => path === out || excluded.some(target => inside(target, path))))
    // Paths given on the command line are explicit opt-ins, even if a .gitignore excludes them.
    for (const target of additions) {
        const path = resolve(project, target)
        if (!inside(project, path) || !existsSync(path)) {
            console.warn(`warning: ${target} not found or outside the project, skipping`)
            continue
        }
        for (const file of collect_files(path)) files.add(file)
    }
    const entries = [...files].sort().map(path => ({
        name: relative(project, path).split(sep).join("/"),
        data: readFileSync(path),
        mtime: statSync(path).mtime,
    }))
    writeFileSync(out, make_zip(entries))
    const megabytes = entries.reduce((sum, entry) => sum + entry.data.length, 0) / 1024 / 1024
    console.log(`packed ${entries.length} files (${megabytes.toFixed(1)} MiB uncompressed) into ${out}`)
}
