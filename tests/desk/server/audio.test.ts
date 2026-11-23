/** Remote audio gain follows per-window volume and mute before and after gesture unlock. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { Server_audio } from "../../../desk/server/audio.ts"

test("remote audio gain preserves level while muted and rejects non-finite volume", () => {
    const gain = { gain: { value: 1 }, connect: (node: unknown) => node }
    const analyser = { fftSize: 512, connect: () => undefined }
    const replacements = {
        window: { addEventListener() {}, removeEventListener() {} }, AudioDecoder: class {}, EncodedAudioChunk: class {},
        AudioContext: class { state = "running"; destination = {}; createGain() { return gain }; createAnalyser() { return analyser }; addEventListener() {} },
    }
    const previous = Object.fromEntries(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
    try {
        for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { value, configurable: true })
        const audio = new Server_audio()
        audio.enabled = false; audio.volume = .3; audio.unlock()
        assert.equal(gain.gain.value, 0)
        audio.enabled = true
        assert.equal(gain.gain.value, .3)
        audio.volume = NaN
        assert.equal(audio.volume, .3)
        audio.volume = 2
        assert.equal(gain.gain.value, 1)
        audio.enabled = false
        assert.equal(gain.gain.value, 0)
    } finally {
        for (const key of Object.keys(replacements)) {
            if (previous[key]) Object.defineProperty(globalThis, key, previous[key]!)
            else Reflect.deleteProperty(globalThis, key)
        }
    }
})
