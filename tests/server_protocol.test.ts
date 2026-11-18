/* /server wire contract: base64 and binary frames round-trip, and the hub's allow-lists reject anything outside the contract. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { api_body_limit, agent_direct_types, agent_message_types, client_message_types, max_frame_bytes, parse_message, reserved_api_names, api_name_pattern } from "../server/src/shared/protocol.ts"
import { from_base64, pack_audio, pack_video, to_base64, unpack_binary } from "../server/src/shared/codec.ts"

test("base64 round-trips every byte value and large buffers", () => {
    const all = Uint8Array.from({ length: 256 }, (_, index) => index)
    assert.deepEqual(from_base64(to_base64(all)), all)
    const large = new Uint8Array(200_000).map((_, index) => index % 251)
    assert.deepEqual(from_base64(to_base64(large)), large)
    assert.equal(to_base64(new Uint8Array()), "")
})

test("binary frames carry the window id and, for sound, the timestamp", () => {
    const video = unpack_binary(pack_video(7, Uint8Array.of(1, 2, 3)))
    assert.deepEqual(video, { kind: "video", id: 7, payload: Uint8Array.of(1, 2, 3) })
    const audio = unpack_binary(pack_audio(4_000_000_000, 12.5, Uint8Array.of(9)))
    assert.deepEqual(audio, { kind: "audio", id: 4_000_000_000, timestamp: 12.5, payload: Uint8Array.of(9) })
    assert.equal(unpack_binary(Uint8Array.of(1, 0)), null)
    assert.equal(unpack_binary(Uint8Array.of(9, 0, 0, 0, 1, 5)), null)
    assert.equal(unpack_binary(Uint8Array.of(2, 0, 0, 0, 1, 5)), null)
})

test("parse_message accepts only objects whose t is allowed", () => {
    assert.deepEqual(parse_message('{"t":"fastfetch"}', client_message_types), { t: "fastfetch" })
    for (const bad of ['{"t":"api_set"}', '{"t":1}', "[]", "null", "7", "{", '{"x":1}']) assert.equal(parse_message(bad, client_message_types), null, bad)
    assert.equal(parse_message("x".repeat(max_frame_bytes + 1), client_message_types), null)
})

test("the three allow-lists never overlap, so a page cannot speak as the agent", () => {
    for (const name of client_message_types) assert.ok(!agent_direct_types.has(name), `${name} is both client and agent-direct`)
    for (const name of agent_direct_types) assert.ok(!agent_message_types.has(name), `${name} is both agent-direct and relayed`)
    // Both directions legitimately use these names; the hub picks the list by socket role
    const shared = [...client_message_types].filter(name => agent_message_types.has(name)).sort()
    assert.deepEqual(shared, ["auto_logs", "auto_state", "fastfetch"])
})

test("API names: reserved ones are listed and the pattern rejects paths", () => {
    for (const name of ["api", "css", "js", "ws", "v1", "server"]) assert.ok((reserved_api_names as readonly string[]).includes(name))
    assert.ok(api_name_pattern.test("sample_1-a"))
    for (const bad of ["", "-x", "a/b", "a b", "a.b", "x".repeat(65)]) assert.ok(!api_name_pattern.test(bad), bad)
})

test("a body of the largest allowed size still fits one frame once it is base64 inside JSON", () => {
    const body = to_base64(new Uint8Array(api_body_limit))
    const frame = JSON.stringify({ t: "api_res", id: 1, status: 200, headers: { "content-type": "application/octet-stream" }, body })
    assert.ok(frame.length < max_frame_bytes, `${frame.length} bytes`)
    assert.deepEqual(parse_message(frame, agent_direct_types)?.t, "api_res")
})
