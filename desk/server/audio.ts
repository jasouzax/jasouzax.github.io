/*
 * Sound of the watched window (ported from Browsite's audio.ts): Opus packets are decoded with WebCodecs and scheduled one after the other on a Web
 * Audio clock. Browsers keep an AudioContext silent until the person has touched the page, so the player starts on the first touch and the Pi only
 * sends sound after that. The choice (on/off) is kept in localStorage.
 */
const storage = {
    get(key: string): string | null { try { return localStorage.getItem(`jazu:server:${key}`) } catch { return null } },
    set(key: string, value: string): void { try { localStorage.setItem(`jazu:server:${key}`, value) } catch { /* private mode */ } },
}

const sample_rate = 48000
// How much sound is kept ahead of the speaker: more survives a bumpy connection, less is closer to live
const lead_seconds = 0.15
const max_lead_seconds = 0.6
const gesture_events = ['pointerdown', 'keydown', 'click', 'touchend'] as const

// Plays the sound of the window that is being watched: Opus packets from the server are decoded with WebCodecs
// and scheduled one after the other on a Web Audio clock. Browsers keep an AudioContext silent until the user
// has touched the page, so the player starts on the first touch and the server only sends sound after that
export class Server_audio {
    // The player became able (or unable) to play, or was switched
    readonly #listeners = new Set<() => void>()
    on_change(listener: () => void): () => void { this.#listeners.add(listener); return () => { this.#listeners.delete(listener) } }
    #changed(): void { for (const listener of [...this.#listeners]) listener() }

    readonly #listener = () => this.unlock()
    #context: AudioContext | null = null
    #gain: GainNode | null = null
    #analyser: AnalyserNode | null = null
    #decoder: AudioDecoder | null = null
    #enabled = storage.get('audio') !== 'off'
    #volume = 1
    #next_time = 0
    #samples: Float32Array<ArrayBuffer> | null = null

    constructor() {
        if (this.is_supported) this.#listen_for_gesture(true)
    }

    get is_supported(): boolean {
        return typeof AudioDecoder !== 'undefined' && typeof AudioContext !== 'undefined' && typeof EncodedAudioChunk !== 'undefined'
    }

    // The user's choice, from the speaker button
    get enabled(): boolean {
        return this.#enabled
    }

    set enabled(value: boolean) {
        this.#enabled = value
        storage.set('audio', value ? 'on' : 'off')
        if (this.#gain) this.#gain.gain.value = value ? this.#volume : 0
        // Pressing the button is the touch the browser wants to see
        if (value) this.unlock()
        else this.reset()
        this.#changed()
    }

    get is_running(): boolean {
        return this.#context?.state === 'running'
    }

    get volume(): number { return this.#volume }
    set volume(value: number) {
        if (!Number.isFinite(value)) return
        this.#volume = Math.max(0, Math.min(1, value))
        if (this.#gain) this.#gain.gain.value = this.#enabled ? this.#volume : 0
    }

    // Whether the server should be sending sound at all
    get is_wanted(): boolean {
        return this.is_supported && this.#enabled && this.is_running
    }

    // Has to run inside a user gesture the first time
    unlock(): void {
        if (!this.is_supported) return
        if (!this.#context) {
            const context = new AudioContext({ sampleRate: sample_rate, latencyHint: 'interactive' })
            this.#context = context
            this.#gain = context.createGain()
            this.#gain.gain.value = this.#enabled ? this.#volume : 0
            this.#analyser = context.createAnalyser()
            this.#analyser.fftSize = 512
            this.#gain.connect(this.#analyser).connect(context.destination)
            context.addEventListener('statechange', () => this.#on_state())
        }
        if (this.#context.state !== 'running') void this.#context.resume().then(() => this.#on_state(), () => {})
        this.#on_state()
    }

    // The sound of another window (or none) is about to come: nothing of the old one may linger
    reset(): void {
        if (this.#decoder && this.#decoder.state !== 'closed') this.#decoder.close()
        this.#decoder = null
        this.#next_time = 0
    }

    // How loud it is right now, 0 to 1
    level(): number {
        const analyser = this.#analyser
        if (!analyser || !this.is_running) return 0
        this.#samples ??= new Float32Array(analyser.fftSize)
        analyser.getFloatTimeDomainData(this.#samples)
        let sum = 0
        for (const sample of this.#samples) sum += sample * sample
        return Math.sqrt(sum / this.#samples.length)
    }

    push(timestamp: number, packet: Uint8Array): void {
        if (!this.is_wanted) return
        const decoder = this.#decoder_ready()
        try {
            decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp, data: packet }))
        } catch {
            this.reset()
        }
    }

    // ---------- Private ----------
    #decoder_ready(): AudioDecoder {
        if (this.#decoder && this.#decoder.state === 'configured') return this.#decoder
        const decoder = new AudioDecoder({
            output: (data) => this.#play(data),
            error: (error) => {
                console.warn('[audio] decoder:', error.message)
                if (this.#decoder === decoder) this.#decoder = null
            },
        })
        decoder.configure({ codec: 'opus', sampleRate: sample_rate, numberOfChannels: 2 })
        this.#decoder = decoder
        return decoder
    }

    #play(data: AudioData): void {
        const context = this.#context
        const gain = this.#gain
        if (!context || !gain || context.state !== 'running') return data.close()
        const buffer = context.createBuffer(data.numberOfChannels, data.numberOfFrames, data.sampleRate)
        const plane = new Float32Array(data.numberOfFrames)
        for (let channel = 0; channel < data.numberOfChannels; channel++) {
            data.copyTo(plane, { planeIndex: channel, format: 'f32-planar' })
            buffer.copyToChannel(plane, channel)
        }
        data.close()

        const now = context.currentTime
        // Ran dry (first packet, or a pause in the stream): start again with a little sound in reserve
        if (this.#next_time < now + 0.02) this.#next_time = now + lead_seconds
        // Far behind the server (a stalled tab catching up): skipping is better than falling further behind
        else if (this.#next_time > now + max_lead_seconds) return
        const source = context.createBufferSource()
        source.buffer = buffer
        source.connect(gain)
        source.start(this.#next_time)
        this.#next_time += buffer.duration
    }

    #on_state(): void {
        this.#listen_for_gesture(!this.is_running)
        this.#changed()
    }

    #listen_for_gesture(is_listening: boolean): void {
        for (const type of gesture_events) {
            if (is_listening) window.addEventListener(type, this.#listener, { capture: true, passive: true })
            else window.removeEventListener(type, this.#listener, { capture: true })
        }
    }
}

let shared: Server_audio | null = null
// one player for the tab, made when the first site window needs it (so other pages never listen for gestures)
export function server_audio(): Server_audio { return shared ??= new Server_audio() }
