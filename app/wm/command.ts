/* Bounded shell-free OS commands; adapters pass arguments, never executable command text from the renderer. */
import { execFile } from "node:child_process"
export type Command = (file: string, args: string[]) => Promise<string>
export const command: Command = (file, args) => new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 5000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => error ? reject(new Error(`${file}: ${stderr.trim() || error.message}`)) : resolve(stdout))
})
