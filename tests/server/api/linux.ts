/* Optional compiled Node acceptance in an ephemeral Linux container; no production files or network are needed. */
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Api_Manager } from "../../../server/api/manager.ts"
import type { Api_Call } from "../../../shared/api/types.ts"
async function main(): Promise<void> {
    const root = mkdtempSync(join(tmpdir(), "jazu-api-linux-")), file = join(root, "check.auto.js"), state = join(root, "state")
    let manager = new Api_Manager(state, process.argv[2])
    const call = (): Api_Call => ({ method: "GET", path: "/", query: {}, headers: {}, actor: { owner: false }, ip: "local", request_id: crypto.randomUUID() })
    const source = (version: number, label: string) => `const api=new API({id:'check',version:${version},access:'public'}); api.get('/',()=>{const count=(api.store.get('count')||0)+1;api.store.set('count',count);return {count,label:'${label}',pid:process.pid}})`
    try {
        writeFileSync(file, source(1, "first")); await manager.deploy(file)
        const first = (await manager.call("check", 1, call())).body as any
        writeFileSync(file, source(2, "second")); await manager.deploy(file)
        const second = (await manager.call("check", 2, call())).body as any
        assert.equal(first.data.count, 1); assert.equal(second.data.count, 2); assert.notEqual(first.data.pid, second.data.pid)
        writeFileSync(file, source(1, "replacement")); await manager.deploy(file); await manager.rollback("check", 1)
        assert.equal(((await manager.call("check", 1, call())).body as any).data.label, "first")
        await manager.close(); manager = new Api_Manager(state, process.argv[2]); await manager.restore()
        assert.equal(manager.manifests().length, 2)
        assert.equal(((await manager.call("check", 2, call())).body as any).data.count, 4)
        console.log("ARM64 API child isolation, SQLite sharing/durability, rollback and supervisor restart pass")
    } finally { await manager.close(); rmSync(root, { recursive: true, force: true }) }
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
