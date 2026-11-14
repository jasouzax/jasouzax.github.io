/* Heartbeat expiry without waiting 90 seconds; reconstruct the hub to simulate hibernation. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { readFileSync, readdirSync } from "node:fs"
import { Realtime_Hub } from "../src/node/realtime.ts"
import type { Work_Env, Work_Statement } from "../src/node/work.ts"

test("alarms expire dead sockets, preserve another device, survive reconstruction and retain the last confirmed time", async () => {
    const original = (globalThis as any).WebSocketRequestResponsePair
    ;(globalThis as any).WebSocketRequestResponsePair = class {}
    const real_now = Date.now
    const db = new DatabaseSync(":memory:"), now = Date.now()
    for (const name of readdirSync("migrations").filter(name => name.endsWith(".sql")).sort()) db.exec(readFileSync(`migrations/${name}`, "utf8"))
    db.prepare("INSERT INTO auth_users VALUES ('u','u@example.com','User',?)").run(now)
    db.prepare("INSERT INTO auth_sessions VALUES ('credential','u',?,?)").run(now, now)
    db.prepare("INSERT INTO last_signed_in VALUES ('a:u',NULL)").run()
    const env: Work_Env = { DB: { prepare(sql) { let values: unknown[] = []; const statement: Work_Statement = { bind(...args) { values = args; return statement }, async first<T>() { return db.prepare(sql).get(...values as any[]) as T ?? null }, async all<T>() { return { results: db.prepare(sql).all(...values as any[]) as T[] } }, async run() { return db.prepare(sql).run(...values as any[]) } }; return statement } } }
    const fake = (auto: number) => ({ readyState: 1, auto, code: 0, attachment: { principal: "a:u", credential: "credential", connected: now - 120000, activity: now - 120000, watches: {} }, deserializeAttachment() { return this.attachment }, serializeAttachment(value: any) { this.attachment = value }, close(code: number) { this.code = code; this.readyState = 3 } })
    const dead = fake(now - 100000), live = fake(now - 1000), sockets = [dead, live], memory = new Map<string, any>([["principal", "a:u"]])
    let alarm = 0
    const ctx: any = { getWebSockets: () => sockets, getWebSocketAutoResponseTimestamp: (ws: any) => new Date(ws.auto), setWebSocketAutoResponse() {}, storage: { async get(key: string) { return memory.get(key) }, async put(key: string | Record<string, unknown>, value?: unknown) { if (typeof key === "string") memory.set(key, value); else for (const [name, entry] of Object.entries(key)) memory.set(name, entry) }, async delete(key: string) { memory.delete(key) }, async setAlarm(time: number) { alarm = time }, async deleteAlarm() { alarm = 0 } } }
    try {
        await new Realtime_Hub(ctx, env).alarm()
        assert.equal(dead.code, 4000); assert.equal(live.readyState, 1)
        assert.equal(db.prepare("SELECT last_online FROM last_signed_in").get()!.last_online, null)
        assert.ok(alarm <= live.auto + 90000 && alarm > now)
        Date.now = () => now + 100000
        await new Realtime_Hub(ctx, env).alarm()
        assert.equal(live.code, 4000)
        assert.equal(db.prepare("SELECT last_online FROM last_signed_in").get()!.last_online, live.auto)
        await new Realtime_Hub(ctx, env).alarm()
        assert.equal(db.prepare("SELECT last_online FROM last_signed_in").get()!.last_online, live.auto, "an offline timestamp must not drift forward")
        assert.equal(alarm, 0)
        const revoked = fake(Date.now()); sockets.push(revoked); db.prepare("DELETE FROM auth_sessions").run()
        await new Realtime_Hub(ctx, env).alarm(); assert.equal(revoked.code, 4003)
        // A delayed offline fanout must not overwrite a newer online state.
        db.prepare("INSERT INTO auth_sessions VALUES ('credential','u',?,?)").run(now, now)
        const active = fake(Date.now()); sockets.push(active)
        const hub = new Realtime_Hub(ctx, env); await hub.alarm()
        const conversation = crypto.randomUUID(), frames: any[] = [], observer_memory = new Map<string, any>([["principal", "a:observer"]])
        const observer: any = { ...fake(Date.now()), send(value: string) { frames.push(JSON.parse(value)) } }
        observer.attachment.watches = { [`work:${conversation}`]: { channel: "work", conversation, target: "a:u", cursor: 0 } }
        const observer_ctx: any = { ...ctx, getWebSockets: () => [observer], storage: { ...ctx.storage, async get(key: string) { return observer_memory.get(key) }, async put(key: string, value: unknown) { observer_memory.set(key, value) } } }
        const receiver = new Realtime_Hub(observer_ctx, env)
        memory.set("watchers", { observer: { principal: "a:observer", channel: "work", conversation, revision: "one" } })
        let unblock!: () => void, started!: () => void, failed = false
        const blocked = new Promise<void>(resolve => { unblock = resolve }), waiting = new Promise<void>(resolve => { started = resolve })
        env.REALTIME = { idFromName: name => name, get: () => ({ async fetch(request) {
            const value = await request.clone().json() as any
            if (failed) throw new Error("Synthetic presence delivery failure")
            if (!value.online) { started(); await blocked }
            return receiver.fetch(request)
        } }) }
        Date.now = () => now + 200001
        const offline = hub.alarm(); await waiting
        sockets.push(fake(Date.now())); await hub.alarm()
        unblock(); await offline
        assert.equal(frames.at(-1).online, true)
        assert.ok(frames.at(-1).version > 0)
        assert.equal(db.prepare("SELECT last_online FROM last_signed_in").get()!.last_online, null)
        assert.ok(alarm > Date.now(), "a late offline handler must not cancel a live connection's alarm")
        failed = true; Date.now = () => now + 300002; await hub.alarm()
        assert.ok(memory.has("presence_delivery"), "failed presence fanout is retained durably")
        failed = false; await hub.alarm()
        assert.equal(frames.at(-1).online, false)
        assert.equal(memory.has("presence_delivery"), false)
        assert.equal(alarm, 0)
    } finally { Date.now = real_now; db.close(); (globalThis as any).WebSocketRequestResponsePair = original }
})
