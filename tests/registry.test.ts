/* OCI pull contracts: mutable tags, immutable digests, repository isolation and anonymous write rejection. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { registry_route, type Registry_Env } from "../src/node/registry.ts"

const digest = `sha256:${"a".repeat(64)}`
const index = JSON.stringify({ schema: 1, tags: { latest: digest }, manifests: { [digest]: "application/vnd.oci.image.index.v1+json" }, blobs: [digest] })
const values: Record<string, string> = { "repos/jazu/index.json": index, [`blobs/sha256/${digest.slice(7)}`]: "{}" }
const env: Registry_Env = { DOMAIN: "registry.jasouza.com", BLOBS: {
    async get(key) { const text = values[key]; return text === undefined ? null : { size: text.length, httpEtag: '"test"', body: new Response(text).body!, text: async () => text } },
    async head(key) { const text = values[key]; return text === undefined ? null : { size: text.length, httpEtag: '"test"' } },
} }
const request = (path: string, method = "GET") => registry_route(new Request(`https://${env.DOMAIN}/v2/${path}`, { method }), env)

test("OCI pulls resolve tags and immutable digests, support HEAD and isolate repositories", async () => {
    assert.equal((await request("")).status, 200)
    const tag = await request("jazu/manifests/latest")
    assert.equal(tag.status, 200)
    assert.equal(tag.headers.get("docker-content-digest"), digest)
    assert.equal(tag.headers.get("cache-control"), "no-store")
    assert.match((await request(`jazu/manifests/${digest}`)).headers.get("cache-control")!, /immutable/)
    const head = await request(`jazu/blobs/${digest}`, "HEAD")
    assert.equal(head.headers.get("content-length"), "2")
    assert.equal(await head.text(), "")
    assert.equal((await request(`other/blobs/${digest}`)).status, 404)
    assert.equal((await request(`jazu/blobs/sha256:${"b".repeat(64)}`)).status, 404)
    assert.deepEqual(await (await request("jazu/tags/list")).json(), { name: "jazu", tags: ["latest"] })
})

test("OCI registry rejects public writes and foreign hosts", async () => {
    assert.equal((await request("jazu/blobs/uploads/", "POST")).status, 405)
    assert.equal((await registry_route(new Request("https://evil.example/v2/"), env)).status, 404)
})
