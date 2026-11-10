import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join, dirname } from "node:path"
import { createContext, runInContext } from "node:vm"

const root = join(dirname(fileURLToPath(import.meta.url)), "artifacts")
const module = new WebAssembly.Module(readFileSync(join(root, "busybox.wasm")))
const context = createContext({ console, WebAssembly, TextDecoder, TextEncoder, URL, setTimeout, clearTimeout, performance })
const glue = readFileSync(join(root, "busybox.js"), "utf8").replace(/;?if\(typeof exports==="object"&&typeof module==="object"\)[\s\S]*$/, "").replace(/export default createBusybox;\s*$/, "")
writeFileSync(join(root, "busybox.js"), glue + "\nexport default createBusybox;\n")
runInContext(glue, context)
const names: string[] = []
const runtime = await context.createBusybox({ thisProgram: "busybox", noInitialRun: true,
    jazu: { pid: 1, ppid: 0 },
    print: (text: string) => names.push(text),
    instantiateWasm(imports: WebAssembly.Imports, ready: (instance: WebAssembly.Instance) => void) { const instance = new WebAssembly.Instance(module, imports); ready(instance); return instance.exports },
})
runtime.jazu = { pid: 1, ppid: 0 }
runtime.callMain(["--list"])
if (!names.includes("sh") || !names.includes("ls")) throw new Error("Compiled BusyBox must list its real shell and applets")
writeFileSync(join(root, "commands.json"), JSON.stringify(names.sort(), null, 2) + "\n")
console.log(`Packaged ${names.length} compiled BusyBox commands`)
