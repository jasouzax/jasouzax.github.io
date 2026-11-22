/* Existing CLI watch behavior, owned by its step. */
import { join } from "node:path"
import { watch } from "node:fs"
import { show, run_build } from "./make.ts"
import type { flags } from "../config.ts"

export async function watch_command(root: string, flags: flags): Promise<void> {
    await run_build(root, { ...flags, dev: true }, false)
    let timer: NodeJS.Timeout | undefined
    let running = false
    let again = false
    const rebuild = async (): Promise<void> => {
        if (running) { again = true; return }
        running = true
        try { do { again = false; show(await run_build(root, { ...flags, dev: true }, false)) } while (again) }
        catch (error) { console.error(error instanceof Error ? error.message : error) }
        finally { running = false }
    }
    const changed = () => {
        clearTimeout(timer)
        timer = setTimeout(() => void rebuild(), 150)
    }
    watch(join(root, "content"), { recursive: true }, changed)
    for (const name of ["engine", "desk", "shared"]) watch(join(root, name), { recursive: true }, changed)
    watch(join(root, "config.json"), changed)
    console.log("watching content/, engine/, desk/, shared/ and config.json (restart watch after engine changes)")
    return
}
