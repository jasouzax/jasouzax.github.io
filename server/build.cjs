/* Source modules are ESM; Electron's compiled tree keeps its existing CommonJS contract. */
const { execFileSync } = require("node:child_process")
const { writeFileSync } = require("node:fs")
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.json"], { stdio: "inherit" })
writeFileSync("dist/package.json", JSON.stringify({ type: "commonjs" }) + "\n")
