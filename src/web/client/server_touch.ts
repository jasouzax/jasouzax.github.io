import type { Input_Event } from '../../../server/src/shared/protocol.ts'

/*
 * A mouse for a finger (ported from Browsite's touch.ts): virtual cursor, tap / double tap / two-finger tap clicks, hold to drag, two fingers to scroll
 * or zoom. It only reacts to touch; a mouse or pen acts on the picture directly (server_site.ts).
 */
function el<tag extends keyof HTMLElementTagNameMap>(name: tag, properties: Partial<Omit<HTMLElementTagNameMap[tag], 'style' | 'children'>> & { class?: string } = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[tag] {
    const element = document.createElement(name)
    const { class: class_name, ...rest } = properties
    if (class_name) element.className = class_name
    Object.assign(element, rest)
    element.append(...children)
    return element
}

// What the controller needs from the view that owns the picture
export interface touch_host {
    // The window (or DevTools) shown right now and its size in its own pixels, null while there is nothing
    target: () => { id: number; width: number; height: number } | null
    send: (input: Input_Event) => void
    // A tap or a press: the hidden field gets the keyboard, so that typing works on phones too
    focus_keys: () => void
}

// A finger that moves less than this is still (a tap, a press, two fingers that only touched)
const tap_slop_px = 10
const tap_max_ms = 320
// A finger that stays down this long presses the mouse button, and moving it then drags
const hold_ms = 380
const double_tap_ms = 420
const two_finger_tap_max_ms = 300
// Two fingers have to travel this far before it is clear whether they scroll or pinch
const gesture_slop_px = 12
const max_zoom = 6
// A cursor this close to the edge of the zoomed picture pushes the picture along
const follow_margin_px = 44

const cursor_svg = `<svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true"><path d="M3 2v15l4.2-3.8 2.7 6.2 2.6-1.1-2.7-6.1H15.5z" fill="#fff" stroke="#0b0f17" stroke-width="1.4" stroke-linejoin="round"/></svg>`

// A mouse for a finger, like the touchpad mode of a remote desktop app:
//  - one finger dragged anywhere on the feed moves a virtual cursor (the picture does not jump to the finger)
//  - a tap clicks where the cursor is, two quick taps double click, two fingers tapped together right click
//  - a finger that stays down presses the button: moving it then drags (select text, move things), lifting releases
//  - two fingers moving together scroll what is under the cursor, two fingers moving apart or together zoom the picture
// It only reacts to touch: a mouse or a pen keeps working on the picture directly, and takes the cursor away
export class Touch_control {
    // 1: not zoomed
    zoom = 1

    readonly #feed: HTMLElement
    readonly #canvas: HTMLCanvasElement
    readonly #host: touch_host
    readonly #cursor: HTMLElement
    readonly #badge: HTMLButtonElement
    // The cursor, as a share of the page (0-1), so that it stays on the same spot when the picture is resized
    #nx = 0.5
    #ny = 0.5
    // Where the picture is moved to while it is zoomed (from its centered place), in screen pixels
    #tx = 0
    #ty = 0
    #is_touch: boolean
    #pointers = new Map<number, { x: number; y: number }>()
    #phase: 'idle' | 'one' | 'two' | 'spent' = 'idle'
    #one = { start_x: 0, start_y: 0, start_t: 0, anchor_x: 0, anchor_y: 0, last_t: 0, moved: false, held: false, timer: null as number | null }
    #two = { dist0: 0, mid0: { x: 0, y: 0 }, prev_dist: 0, prev_mid: { x: 0, y: 0 }, start_t: 0, mode: 'undecided' as 'undecided' | 'scroll' | 'zoom' }
    #last_tap = { time: 0, x: 0, y: 0, count: 0 }
    #move_queued = false
    #place_queued = false

    constructor(feed: HTMLElement, canvas: HTMLCanvasElement, host: touch_host) {
        this.#feed = feed
        this.#canvas = canvas
        this.#host = host
        this.#is_touch = matchMedia('(pointer: coarse)').matches
        feed.classList.add('server_site_touch')

        this.#cursor = el('div', { class: 'server_site_cursor', hidden: true })
        this.#cursor.innerHTML = `${cursor_svg}<i class="server_site_ring"></i>`
        this.#cursor.querySelector('.server_site_ring')!.addEventListener('animationend', () => this.#cursor.classList.remove('tap'))
        this.#badge = el('button', { type: 'button', class: 'server_site_zoom', hidden: true, title: 'Reset the zoom', ariaLabel: 'Reset the zoom', onclick: () => this.reset_view() })
        feed.append(this.#cursor, this.#badge)
        feed.dataset.touch = this.#is_touch ? 'on' : 'off'

        feed.addEventListener('pointerdown', (event) => this.#down(event))
        feed.addEventListener('pointermove', (event) => this.#move(event))
        feed.addEventListener('pointerup', (event) => this.#up(event))
        feed.addEventListener('pointercancel', (event) => this.#up(event))
        // A long press would open the menu of the browser, and the picture is not a page
        feed.addEventListener('contextmenu', (event) => event.preventDefault())
        // The size of the picture decides where the cursor is on screen, and how far it can be moved
        const observer = new ResizeObserver(() => this.refresh())
        observer.observe(feed)
        observer.observe(canvas)
    }

    // The picture was resized or replaced: the zoom stays inside it, and the cursor stays on its spot
    refresh(): void {
        this.#clamp_pan()
        this.#apply_zoom()
        this.#schedule_place()
    }

    // Back to the whole picture
    reset_view(): void {
        this.zoom = 1
        this.#tx = 0
        this.#ty = 0
        this.#apply_zoom()
        this.#schedule_place()
    }

    // ---------- Fingers ----------
    #set_touch(on: boolean): void {
        if (this.#is_touch === on) return
        this.#is_touch = on
        this.#feed.dataset.touch = on ? 'on' : 'off'
        this.#schedule_place()
    }

    #down(event: PointerEvent): void {
        if (event.pointerType !== 'touch') return this.#set_touch(false)
        if ((event.target as Element).closest('.server_site_zoom')) return
        this.#set_touch(true)
        // The browser must not also make a mouse press or a text selection out of this finger
        event.preventDefault()
        if (this.#pointers.size >= 2) return
        try {
            this.#feed.setPointerCapture(event.pointerId)
        } catch {}
        this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
        if (this.#pointers.size === 1) this.#begin_one(event)
        else this.#begin_two(event)
    }

    #begin_one(event: PointerEvent): void {
        this.#phase = 'one'
        const one = this.#one
        Object.assign(one, { start_x: event.clientX, start_y: event.clientY, start_t: event.timeStamp, anchor_x: event.clientX, anchor_y: event.clientY, last_t: event.timeStamp, moved: false, held: false })
        this.#clear_hold()
        one.timer = window.setTimeout(() => {
            one.timer = null
            if (this.#phase !== 'one' || one.moved || one.held) return
            this.#press()
        }, hold_ms)
    }

    #begin_two(event: PointerEvent): void {
        // What the first finger was doing is over: a held press is let go, a tap that was not finished is dropped
        this.#clear_hold()
        if (this.#one.held) this.#release_press()
        this.#phase = 'two'
        const [dist, mid] = this.#pair()
        Object.assign(this.#two, { dist0: dist, mid0: mid, prev_dist: dist, prev_mid: mid, start_t: event.timeStamp, mode: 'undecided' })
    }

    #move(event: PointerEvent): void {
        if (event.pointerType !== 'touch') return this.#set_touch(false)
        const pointer = this.#pointers.get(event.pointerId)
        if (!pointer) return
        event.preventDefault()
        pointer.x = event.clientX
        pointer.y = event.clientY
        if (this.#phase === 'one') this.#move_one(event)
        else if (this.#phase === 'two') this.#move_two()
    }

    // One finger: the cursor moves by what the finger moved, a little more when the finger is fast
    #move_one(event: PointerEvent): void {
        const one = this.#one
        if (!one.moved && Math.hypot(event.clientX - one.start_x, event.clientY - one.start_y) > tap_slop_px) {
            one.moved = true
            // It is not a tap or a press any more
            if (!one.held) this.#clear_hold()
        }
        if (!one.moved && !one.held) return
        const dx = event.clientX - one.anchor_x
        const dy = event.clientY - one.anchor_y
        const speed = Math.hypot(dx, dy) / Math.max(1, event.timeStamp - one.last_t)
        const gain = speed < 0.3 ? 1 : Math.min(2.5, 1 + (speed - 0.3) * 1.5)
        one.anchor_x = event.clientX
        one.anchor_y = event.clientY
        one.last_t = event.timeStamp
        this.#move_cursor(dx * gain, dy * gain)
    }

    // Two fingers: first it is decided what they do. Fingers that travel together scroll, fingers that change
    // their distance zoom. That stays so until they are lifted, so that a scroll never turns into a zoom by accident
    #move_two(): void {
        const two = this.#two
        const [dist, mid] = this.#pair()
        if (two.mode === 'undecided') {
            const spread = Math.abs(dist - two.dist0)
            const travel = Math.hypot(mid.x - two.mid0.x, mid.y - two.mid0.y)
            if (Math.max(spread, travel) < gesture_slop_px) return
            two.mode = spread > travel ? 'zoom' : 'scroll'
            two.prev_dist = two.dist0
            two.prev_mid = two.mid0
        }
        const pan = { x: mid.x - two.prev_mid.x, y: mid.y - two.prev_mid.y }
        if (two.mode === 'zoom') this.#zoom_by(two.prev_dist > 0 ? dist / two.prev_dist : 1, mid, pan)
        else this.#scroll_by(pan.x, pan.y)
        two.prev_dist = dist
        two.prev_mid = mid
    }

    #up(event: PointerEvent): void {
        if (event.pointerType !== 'touch' || !this.#pointers.has(event.pointerId)) return
        this.#pointers.delete(event.pointerId)
        try {
            this.#feed.releasePointerCapture(event.pointerId)
        } catch {}
        const is_up = event.type === 'pointerup'
        if (this.#phase === 'one') {
            this.#clear_hold()
            const one = this.#one
            if (one.held) this.#release_press()
            else if (is_up && !one.moved && event.timeStamp - one.start_t < tap_max_ms) this.#click('left', one.start_t)
            this.#phase = 'idle'
        } else if (this.#phase === 'two') {
            const two = this.#two
            // Two fingers that touched together and left again without going anywhere: a right click
            if (is_up && two.mode === 'undecided' && event.timeStamp - two.start_t < two_finger_tap_max_ms) this.#click('right', two.start_t)
            // A zoom that ended almost at the whole picture goes all the way back (it would only be a blur)
            if (two.mode === 'zoom' && this.zoom < 1.05) this.reset_view()
            // The finger that is left does not move the cursor: it would jump from where the two fingers were
            this.#phase = this.#pointers.size > 0 ? 'spent' : 'idle'
        }
        if (this.#pointers.size === 0) this.#phase = 'idle'
    }

    #pair(): [number, { x: number; y: number }] {
        const [a, b] = [...this.#pointers.values()]
        return [Math.hypot(a.x - b.x, a.y - b.y), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }]
    }

    #clear_hold(): void {
        if (this.#one.timer !== null) clearTimeout(this.#one.timer)
        this.#one.timer = null
    }

    // ---------- Mouse ----------
    // Where the cursor is, in the page's own pixels
    #page_point(): { x: number; y: number } | null {
        const target = this.#host.target()
        if (!target) return null
        return { x: Math.min(target.width - 1, Math.max(0, this.#nx * target.width)), y: Math.min(target.height - 1, Math.max(0, this.#ny * target.height)) }
    }

    // How many pixels of the page are one pixel of the screen (the zoom included)
    #page_per_screen(): number {
        const target = this.#host.target()
        const width = this.#canvas.getBoundingClientRect().width
        return target && width > 0 ? target.width / width : 1
    }

    #move_cursor(dx: number, dy: number): void {
        const target = this.#host.target()
        if (!target) return
        const k = this.#page_per_screen()
        this.#nx = Math.min(1, Math.max(0, this.#nx + (dx * k) / target.width))
        this.#ny = Math.min(1, Math.max(0, this.#ny + (dy * k) / target.height))
        this.#follow_cursor()
        this.#schedule_place()
        if (this.#move_queued) return
        this.#move_queued = true
        requestAnimationFrame(() => this.#flush_move())
    }

    // Moves arrive faster than the connection can take them: one per animation frame is plenty
    #flush_move(): void {
        if (!this.#move_queued) return
        this.#move_queued = false
        const point = this.#page_point()
        if (point) this.#host.send({ kind: 'mouse', action: 'move', ...point, modifiers: this.#one.held ? ['left_button'] : undefined })
    }

    // Two presses near each other in quick succession are a double click, three a triple click
    #click_count(time: number, point: { x: number; y: number }): number {
        const last = this.#last_tap
        const is_repeat = time - last.time < double_tap_ms && Math.hypot(point.x - last.x, point.y - last.y) < 12
        this.#last_tap = { time, x: point.x, y: point.y, count: is_repeat ? Math.min(last.count + 1, 3) : 1 }
        return this.#last_tap.count
    }

    // A tap: the button goes down and up where the cursor is
    #click(button: 'left' | 'right', started: number): void {
        const point = this.#page_point()
        if (!point) return
        this.#flush_move()
        const clicks = button === 'left' ? this.#click_count(started, point) : 1
        this.#host.send({ kind: 'mouse', action: 'move', ...point })
        this.#host.send({ kind: 'mouse', action: 'down', ...point, button, clicks })
        this.#host.send({ kind: 'mouse', action: 'up', ...point, button, clicks })
        this.#pulse()
        if (button === 'left') this.#host.focus_keys()
    }

    // A finger that stays down presses the button and keeps it down until it is lifted
    #press(): void {
        const point = this.#page_point()
        if (!point) return
        this.#flush_move()
        this.#one.held = true
        this.#one.anchor_x = this.#pointers.values().next().value?.x ?? this.#one.anchor_x
        this.#one.anchor_y = this.#pointers.values().next().value?.y ?? this.#one.anchor_y
        const clicks = this.#click_count(this.#one.start_t, point)
        this.#host.send({ kind: 'mouse', action: 'move', ...point })
        this.#host.send({ kind: 'mouse', action: 'down', ...point, button: 'left', clicks })
        this.#cursor.dataset.pressed = '1'
        this.#host.focus_keys()
        // A short tick says the press took hold
        navigator.vibrate?.(15)
    }

    #release_press(): void {
        this.#one.held = false
        delete this.#cursor.dataset.pressed
        this.#flush_move()
        const point = this.#page_point()
        if (point) this.#host.send({ kind: 'mouse', action: 'up', ...point, button: 'left', clicks: this.#last_tap.count })
    }

    // Two fingers move together: what is under the cursor scrolls, following the fingers
    #scroll_by(dx: number, dy: number): void {
        const point = this.#page_point()
        if (!point) return
        const k = this.#page_per_screen()
        this.#host.send({ kind: 'mouse', action: 'wheel', ...point, dx: -dx * k, dy: -dy * k })
    }

    // ---------- Zoom ----------
    // The picture grows around the point between the fingers, and follows them while they move
    #zoom_by(ratio: number, mid: { x: number; y: number }, pan: { x: number; y: number }): void {
        const box = this.#feed.getBoundingClientRect()
        const mx = mid.x - (box.left + box.width / 2)
        const my = mid.y - (box.top + box.height / 2)
        const next = Math.min(max_zoom, Math.max(1, this.zoom * ratio))
        const grown = next / this.zoom
        this.#tx = mx - grown * (mx - this.#tx) + pan.x
        this.#ty = my - grown * (my - this.#ty) + pan.y
        this.zoom = next
        this.#clamp_pan()
        this.#apply_zoom()
        this.#schedule_place()
    }

    // The picture never leaves the area empty: it can only be moved as far as its edges
    #clamp_pan(): void {
        const reach_x = Math.max(0, (this.#canvas.offsetWidth * this.zoom - this.#feed.clientWidth) / 2)
        const reach_y = Math.max(0, (this.#canvas.offsetHeight * this.zoom - this.#feed.clientHeight) / 2)
        this.#tx = Math.min(reach_x, Math.max(-reach_x, this.#tx))
        this.#ty = Math.min(reach_y, Math.max(-reach_y, this.#ty))
    }

    #apply_zoom(): void {
        this.#canvas.style.transform = this.zoom === 1 ? '' : `translate(${this.#tx}px, ${this.#ty}px) scale(${this.zoom})`
        this.#badge.hidden = this.zoom === 1
        this.#badge.textContent = `${this.zoom.toFixed(1)}× ✕`
    }

    // Zoomed in, a cursor that gets close to the edge takes the picture along, so that it is always in sight
    #follow_cursor(): void {
        if (this.zoom === 1) return
        const spot = this.#screen_spot()
        if (!spot) return
        const area = this.#feed.getBoundingClientRect()
        const margin = Math.min(follow_margin_px, area.width / 4, area.height / 4)
        let dx = 0
        let dy = 0
        if (spot.x < area.left + margin) dx = area.left + margin - spot.x
        else if (spot.x > area.right - margin) dx = area.right - margin - spot.x
        if (spot.y < area.top + margin) dy = area.top + margin - spot.y
        else if (spot.y > area.bottom - margin) dy = area.bottom - margin - spot.y
        if (dx === 0 && dy === 0) return
        this.#tx += dx
        this.#ty += dy
        this.#clamp_pan()
        this.#apply_zoom()
    }

    // ---------- The cursor on screen ----------
    #screen_spot(): { x: number; y: number } | null {
        const box = this.#canvas.getBoundingClientRect()
        if (this.#canvas.hidden || box.width === 0 || box.height === 0) return null
        return { x: box.left + this.#nx * box.width, y: box.top + this.#ny * box.height }
    }

    #schedule_place(): void {
        if (this.#place_queued) return
        this.#place_queued = true
        requestAnimationFrame(() => {
            this.#place_queued = false
            this.#place()
        })
    }

    #place(): void {
        const spot = this.#is_touch && this.#host.target() ? this.#screen_spot() : null
        this.#cursor.hidden = spot === null
        if (!spot) return
        const area = this.#feed.getBoundingClientRect()
        this.#cursor.style.transform = `translate(${spot.x - area.left}px, ${spot.y - area.top}px)`
    }

    // A ring that opens and fades where a tap landed
    #pulse(): void {
        this.#cursor.classList.remove('tap')
        void this.#cursor.offsetWidth
        this.#cursor.classList.add('tap')
    }
}
