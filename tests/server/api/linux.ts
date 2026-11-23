/* Optional compiled Node acceptance in an ephemeral Linux container; no production files or network are needed. */
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Api_Manager } from "../../../server/api/manager.ts"
import type { Api_Call } from "../../../shared/api/types.ts"
import { setTimeout } from "node:timers/promises"
async function main(): Promise<void> {
    const root = mkdtempSync(join(tmpdir(), "jazu-api-linux-")), file = join(root, "check.auto.js"), state = join(root, "state")
    let manager = new Api_Manager(state, process.argv[2])
    const call = (): Api_Call => ({ method: "GET", path: "/", query: {}, headers: {}, actor: { owner: false }, ip: "local", request_id: crypto.randomUUID() })
    const source = (version: number, label: string) => `const api=new API({id:'check',version:${version},access:'public'}); api.get('/',()=>{const count=(api.store.get('count')||0)+1;api.store.set('count',count);return {count,label:'${label}',pid:process.pid}});const job=api.job('held',()=>new Promise(()=>{}));api.post('/job',()=>api.reply(job.run(),202));api.get('/jobs/:id',ctx=>api.jobs.get(ctx.params.id));api.post('/hang',{idempotent:true},()=>{api.store.set('hang',(api.store.get('hang')||0)+1);while(true){}});api.get('/hang',()=>api.store.get('hang'));`
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
        const job = ((await manager.call("check", 1, { ...call(), method: "POST", path: "/job" })).body as any).data
        const job_call = { ...call(), path: `/jobs/${job.id}` }
        for (let count = 0; count < 100 && ((await manager.call("check", 1, job_call)).body as any).data.state !== "running"; count++) await setTimeout(10)
        const crashed = manager.active.get("check/v1")!, request = { ...call(), method: "POST", path: "/hang", body: {}, headers: { "idempotency-key": "hang" } }
        assert.equal((await crashed.call(request, 300)).status, 504); await crashed.stopped
        for (let count = 0; count < 100 && !manager.active.get("check/v1")?.manifest; count++) await setTimeout(30)
        assert.equal((await manager.call("check", 1, request)).status, 409)
        assert.equal(((await manager.call("check", 1, { ...call(), path: "/hang" })).body as any).data, 1)
        assert.equal(((await manager.call("check", 1, job_call)).body as any).data.state, "interrupted")
        console.log("ARM64 API isolation, SQLite durability, rollback, restart, forced watchdog and interrupted jobs/requests pass")
    } finally { await manager.close(); rmSync(root, { recursive: true, force: true }) }
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
