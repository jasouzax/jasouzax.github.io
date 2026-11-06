class Contour_Map {
    static defaults = {
        canvas_selector: '.background_canvas',
        container_selector: '.background',
        ready_class: 'ready',
        arena_scale: 0.25,
        hill_count: 8,
        hill_radius: 0.5,
        field_floor: 0.02,
        level_count: 15,
        width_range: [0.4, 0.4],
        tone_range: [0.5, 1],
        edge_softness: 4,
        noise_octaves: 10,
        noise_scale: 10,
        roughness: 0.55,
        jaggedness: 1.2,
        wave_max: 4,
        wave_speed: 0.25,
        wave_width: 0.05,
        wave_core: 0.1,
        wave_strength: 0.9,
        wave_min: 0.02,
        base_speed: 0.01,
        height_rate: 0.05,
        depth_power: 1.5,
        damping: 0.98,
        max_speed: 1,
        scroll_strength: 0.5,
        pointer_strength: 0.25,
        shake_strength: 0.02,
        max_fps: 60,
        globe_reach: [0.75, 0.75],
        globe_follow: 0.1,
        light_anchor: [0.5, 0.5],
        globe_tilt: 22,
        globe_outline: 1,
        primary_mix: 0.5,
        globe_speed: 0.05,
        glow_colors: { start: '#22d3ee', end: '#a78bfa' },
        glow_reach: 0.4,
        glow_strength: 0.35,
        glow_altitude: [0.45, 0.8],
        glow_valley: 0.55,
        glow_shades: 2,
        glow_opacity: 1,
        globe_tint: 0.12,
        globe_shade: 0.3,
        land_shine: 1,
        land_reach: 0.6,
        reflect_reach: 3,
        reflect_height: 0.6,
        reflect_strength: 1,
        reflect_step: 4,
        reflect_drop: 0.3,
        intro_flood_time: 1,
        intro_flood_noise: 0.6,
        intro_flood_softness: 0.15,
        intro_light_time: 1,
        intro_spin: 3.28,
        intro_spin_peak: 0.4,
        intro_glow_start: 0.4,
        intro_glow_time: 0.6,
        land_size: [1024, 512],
        land_tone: [0.35, 0.75],
        colors: {
            light: { valley: '#f3f7fc', mid: '#e1e9f4', hill: '#c9d6e8', primary: '#0b4a6e' },
            dark: { valley: '#04060c', mid: '#0a1120', hill: '#14223a', primary: '#7ee7f7' },
        },
    };
    static vertex_source = 'attribute vec2 corner;void main(){gl_Position=vec4(corner,0.0,1.0);}';
    static fragment_source(c) {
        const f = n => Number.isInteger(n) ? n + '.0' : '' + n;
        const v2 = a => `vec2(${a.map(f)})`;
        const v3 = hex => `vec3(${Contour_Map.hex_to_rgb(hex).map(f)})`;
        const tilt = c.globe_tilt * Math.PI / 180;
        return `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
#define MAX_HILLS ${c.hill_count}
#define MAX_WAVES ${c.wave_max}
#define NOISE_OCTAVES ${c.noise_octaves}
#define FIELD_FLOOR ${f(c.field_floor)}
#define RADIUS ${f(c.hill_radius)}
#define LEVELS ${f(c.level_count)}
#define EDGE_SOFTNESS ${f(c.edge_softness)}
#define JAGGEDNESS ${f(c.jaggedness)}
#define NOISE_SCALE ${f(c.noise_scale)}
#define ROUGHNESS ${f(c.roughness)}
#define WAVE_WIDTH ${f(c.wave_width)}
#define WAVE_CORE ${f(c.wave_core)}
#define WAVE_STRENGTH ${f(c.wave_strength)}
#define WAVE_MIN ${f(c.wave_min)}
#define WIDTH_RANGE ${v2(c.width_range)}
#define TONE_RANGE ${v2(c.tone_range)}
#define GLOW_START ${v3(c.glow_colors.start)}
#define GLOW_END ${v3(c.glow_colors.end)}
#define OCTAVE_TURN mat2(1.6, 1.2, -1.2, 1.6)
#define PI 3.1415927
#define TILT_COS ${f(Math.cos(tilt))}
#define TILT_SIN ${f(Math.sin(tilt))}
#define PRIMARY_MIX ${f(c.primary_mix)}
#define CONTOUR_STEPS 2.0
#define GLOBE_STEPS 4.0
#define LAND_TEXEL ${v2([1 / c.land_size[0], 1 / c.land_size[1]])}
#define GLOBE_OUTLINE ${f(c.globe_outline)}
#define GLOW_REACH ${f(c.glow_reach)}
#define GLOW_STRENGTH ${f(c.glow_strength)}
#define GLOW_ALTITUDE ${v2(c.glow_altitude)}
#define GLOW_VALLEY ${f(c.glow_valley)}
#define GLOW_OPACITY ${f(c.glow_opacity)}
#define GLOBE_TINT ${f(c.globe_tint)}
#define GLOBE_SHADE ${f(c.globe_shade)}
#define LAND_SHINE ${f(c.land_shine)}
#define LAND_REACH ${f(c.land_reach)}
#define GLOW_STEPS ${f(c.glow_shades + 1)}
#define FLOOD_NOISE ${f(c.intro_flood_noise)}
#define FLOOD_SOFTNESS ${f(c.intro_flood_softness)}
#define FLOOD_SPAN (FLOOD_NOISE * 0.3)
#define REFLECT_HEIGHT ${f(c.reflect_height)}
#define REFLECT_REACH ${f(c.reflect_reach)}
#define REFLECT_STRENGTH ${f(c.reflect_strength)}
#define REFLECT_STEP ${f(c.reflect_step)}
#define REFLECT_DROP ${f(c.reflect_drop)}
uniform vec2 resolution;
uniform vec4 hills[MAX_HILLS];
uniform vec4 waves[MAX_WAVES];
uniform float wave_levels[MAX_WAVES];
uniform mediump sampler2D land;
uniform float globe_radius;
uniform float globe_spin;
uniform vec2 globe_center;
uniform vec3 light_direction;
uniform vec3 valley_color;
uniform vec3 mid_color;
uniform vec3 hill_color;
uniform vec3 primary_color;
uniform float intro_flood;
uniform float intro_light;
uniform float intro_glow;
float bayer(vec2 pixel) {
vec2 cell = mod(floor(pixel), 4.0);
vec2 low = mod(cell, 2.0);
vec2 high = floor(cell / 2.0);
return (abs(low.x - low.y) * 8.0 + low.y * 4.0 + abs(high.x - high.y) * 2.0 + high.y + 0.5) / 16.0;
}
float hash(float seed) {
return fract(sin(seed) * 43758.5453);
}
float lattice(vec2 cell) {
return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
}
float value_noise(vec2 point) {
vec2 cell = floor(point);
vec2 local = fract(point);
float bottom = mix(lattice(cell), lattice(cell + vec2(1.0, 0.0)), local.x);
float top = mix(lattice(cell + vec2(0.0, 1.0)), lattice(cell + vec2(1.0, 1.0)), local.x);
return mix(bottom, top, local.y);
}
float terrain_noise(vec2 point) {
float total = 0.0;
float amplitude = 1.0;
float weight = 0.0;
for (int i = 0; i < NOISE_OCTAVES; i++) {
total += value_noise(point) * amplitude;
weight += amplitude;
point = OCTAVE_TURN * point;
amplitude *= ROUGHNESS;
}
return total / weight - 0.5;
}
vec3 dither_color(float strength, float steps) {
float level = min(floor(strength * steps + bayer(gl_FragCoord.xy)), steps);
vec3 color = mix(valley_color, mid_color, step(0.5, level));
color = mix(color, hill_color, step(1.5, level));
if (steps < 2.5) return color;
color = mix(color, mix(primary_color, hill_color, PRIMARY_MIX), step(2.5, level));
return mix(color, primary_color, step(3.5, level));
}
float globe_strength(out float land_flag, out float depth, out float lit) {
land_flag = 0.0;
depth = 0.0;
lit = 0.0;
vec2 disc = (gl_FragCoord.xy - globe_center) / globe_radius;
float edge = dot(disc, disc);
if (edge > 1.0) return -1.0;
vec3 view = vec3(disc, sqrt(1.0 - edge));
depth = view.z;
vec3 tilted = vec3(view.x * TILT_COS - view.y * TILT_SIN, view.x * TILT_SIN + view.y * TILT_COS, view.z);
vec2 map = vec2((atan(tilted.x, tilted.z) - globe_spin) / (2.0 * PI) + 0.5, asin(clamp(tilted.y, -1.0, 1.0)) / PI + 0.5);
vec2 here = texture2D(land, map).rg;
vec2 right = texture2D(land, map + vec2(LAND_TEXEL.x, 0.0)).rg;
vec2 above = texture2D(land, map + vec2(0.0, LAND_TEXEL.y)).rg;
float border = max(step(0.002, length(here - right)), step(0.002, length(here - above)));
float facing = dot(light_direction, view);
float light = mix(GLOBE_SHADE, 1.0, max(facing, 0.0));
float sweep = mix(1.15, 0.35, intro_light);
lit = step(bayer(gl_FragCoord.xy), smoothstep(sweep - 0.15, sweep + 0.15, facing));
float rim = step(1.0 - GLOBE_OUTLINE / globe_radius, sqrt(edge));
float land_mask = step(0.001, here.g);
land_flag = land_mask;
float base = mix(0.12, 0.25 + 0.6 * here.r, land_mask);
return max(max(border, rim), base * light);
}
float rim_position(vec2 offset) {
return clamp(atan(abs(offset.y), -offset.x) / (0.5 * PI), 0.0, 1.0);
}
vec3 glow_layer(vec3 base, float intensity, float fade, float position) {
if (intensity < bayer(gl_FragCoord.xy)) return base;
float shade = min(floor(position * GLOW_STEPS + bayer(gl_FragCoord.xy + vec2(2.0, 1.0))), GLOW_STEPS);
return mix(base, mix(GLOW_START, GLOW_END, shade / GLOW_STEPS), fade * GLOW_OPACITY);
}
vec3 globe_color(vec3 base, float land_flag, float depth) {
float position = rim_position(gl_FragCoord.xy - globe_center);
vec3 tinted = mix(base, mix(GLOW_START, GLOW_END, position), GLOBE_TINT * intro_glow);
float fade = land_flag * pow(1.0 - smoothstep(0.0, max(LAND_REACH, 0.0001), depth), 2.0) * intro_glow;
return glow_layer(tinted, fade * LAND_SHINE, fade, position);
}
vec3 globe_glow(vec3 base, float altitude, vec2 ring_change) {
vec2 offset = gl_FragCoord.xy - globe_center;
float away = length(offset);
float gap = (away - globe_radius) / globe_radius;
if (gap > max(GLOW_REACH, REFLECT_REACH)) return base;
vec2 outward = offset / max(away, 0.0001);
float lift = mix(GLOW_VALLEY, 1.0, altitude);
float halo_fade = pow(1.0 - smoothstep(0.0, GLOW_REACH, gap), 2.0) * lift;
float shine_reach = max(REFLECT_REACH * mix(1.0 - REFLECT_HEIGHT, 1.0, altitude), 0.0001);
float exposure = smoothstep(0.0, REFLECT_DROP, dot(ring_change, outward) * REFLECT_STEP);
float ink = step(0.001, distance(base, valley_color));
float shine_fade = pow(1.0 - smoothstep(0.0, shine_reach, gap), 1.5) * exposure * lift * ink;
float halo = halo_fade * GLOW_STRENGTH * intro_glow;
float shine = shine_fade * REFLECT_STRENGTH * intro_glow;
return glow_layer(base, max(halo, shine), (halo >= shine ? halo_fade : shine_fade) * intro_glow, rim_position(offset));
}
void main() {
float land_flag;
float depth;
float lit;
float globe = globe_strength(land_flag, depth, lit);
if (globe >= 0.0) {
gl_FragColor = vec4(mix(valley_color, globe_color(dither_color(globe, GLOBE_STEPS), land_flag, depth), lit), 1.0);
return;
}
vec2 uv = gl_FragCoord.xy / resolution;
float aspect = resolution.x / resolution.y;
float field = FIELD_FLOOR;
float field_peak = FIELD_FLOOR;
vec2 slope = vec2(0.0);
for (int i = 0; i < MAX_HILLS; i++) {
field_peak += hills[i].z;
vec2 delta = uv - hills[i].xy;
vec2 wave = sin(PI * delta) / PI;
wave.x *= aspect;
float hill_distance = max(length(wave), 0.0001);
float height = hills[i].z * exp(-hill_distance / RADIUS);
vec2 direction = wave / hill_distance * cos(PI * delta);
field += height;
slope -= height / RADIUS * direction;
}
float ring_position = log(field) * LEVELS;
for (int i = 0; i < MAX_WAVES; i++) {
vec2 offset = uv - waves[i].xy;
offset -= floor(offset + 0.5);
offset.x *= aspect;
float wave_distance = length(offset);
float reached = 1.0 - smoothstep(-WAVE_WIDTH, WAVE_WIDTH, wave_distance - waves[i].z);
float erased = 1.0 - smoothstep(-WAVE_WIDTH, WAVE_WIDTH, wave_distance - waves[i].w);
float scaled_distance = wave_distance / WAVE_CORE;
float fade = max(WAVE_STRENGTH / (1.0 + scaled_distance * scaled_distance) - WAVE_MIN, 0.0);
ring_position = mix(ring_position, wave_levels[i], reached * (1.0 - erased) * fade);
}
float field_low = FIELD_FLOOR + (field_peak - FIELD_FLOOR) * exp(-length(vec2(aspect, 1.0)) / PI / RADIUS);
float height_ratio = (ring_position / LEVELS - log(field_low)) / max(log(field_peak) - log(field_low), 0.0001);
float altitude = smoothstep(GLOW_ALTITUDE.x, GLOW_ALTITUDE.y, height_ratio);
vec2 noise_point = vec2(uv.x * aspect, uv.y) * NOISE_SCALE;
float noise_step = NOISE_SCALE / resolution.y;
float noise = terrain_noise(noise_point);
vec2 noise_change = vec2(terrain_noise(noise_point + vec2(noise_step, 0.0)), terrain_noise(noise_point + vec2(0.0, noise_step))) - noise;
ring_position += JAGGEDNESS * noise;
vec2 ring_change = LEVELS * slope / (field * resolution.y) + JAGGEDNESS * noise_change;
float pixels_per_ring = max(1.0 / (length(ring_change) + 0.0001), 1.0);
float ring_index = floor(ring_position + 0.5);
float half_width = mix(WIDTH_RANGE.x, WIDTH_RANGE.y, hash(ring_index * 78.233));
float peak = mix(TONE_RANGE.x, TONE_RANGE.y, hash(ring_index * 12.9898));
float soft_rings = min(EDGE_SOFTNESS / pixels_per_ring, 0.5);
float ring_distance = abs(ring_position - ring_index);
float strength = clamp((half_width - ring_distance) / soft_rings, 0.0, 1.0) * peak;
float revealed = max(smoothstep(0.0, FLOOD_SOFTNESS, mix(-FLOOD_SPAN, 1.0 + FLOOD_SPAN + FLOOD_SOFTNESS, intro_flood) - height_ratio - FLOOD_NOISE * noise), step(1.0, intro_flood));
gl_FragColor = vec4(mix(valley_color, globe_glow(dither_color(strength, CONTOUR_STEPS), altitude, ring_change), step(bayer(gl_FragCoord.xy), revealed)), 1.0);
}`;
    }
    static random_between(low, high) {
        return low + Math.random() * (high - low);
    }
    static clamp(value, low, high) {
        return Math.max(low, Math.min(high, value));
    }
    static wrap(value) {
        return value - Math.floor(value);
    }
    static hex_to_rgb(hex) {
        return [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255);
    }
    static world_countries() {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
        const { world_code: code, world_units: units } = Contour_Map;
        const turn = 360 * units;
        let at = 0;
        const next = () => {
            let value = 0, shift = 0, digit;
            do {
                digit = alphabet.indexOf(code[at++]);
                value |= (digit & 31) << shift;
                shift += 5;
            } while (digit & 32);
            return value;
        };
        const signed = () => {
            const value = next();
            return value >> 1 ^ -(value & 1);
        };
        const list = make => Array.from({ length: next() }, make);
        const arcs = list(() => {
            let count = next(), x = next(), y = next();
            const points = [[x, y]];
            while (--count) points.push([x += signed(), y += signed()]);
            return points;
        });
        return list(() => list(() => list(() => {
            const ring = [];
            for (let count = next(); count--;) {
                const index = signed();
                const arc = index < 0 ? arcs[~index].slice().reverse() : arcs[index];
                ring.push(...(ring.length ? arc.slice(1) : arc));
            }
            let previous = ring[0][0];
            const unwrapped = ring.map(([x, y]) => [previous = x + turn * Math.round((previous - x) / turn), y]);
            return Math.abs(unwrapped.at(-1)[0] - unwrapped[0][0]) > turn / 2 ? ring : unwrapped;
        })));
    }
    constructor(options = {}) {
        const defaults = new.target.defaults;
        const config = this.config = {
            ...defaults,
            ...options,
            colors: Object.fromEntries(['light', 'dark'].map(name => [name, { ...defaults.colors[name], ...options.colors?.[name] }])),
        };
        this.ready = false;
        this.container = document.querySelector(config.container_selector);
        this.canvas = this.container?.querySelector(config.canvas_selector);
        this.gl = this.canvas?.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false });
        if (!this.gl) { this.container?.classList.add('fallback'); return; }
        this.dark_query = matchMedia('(prefers-color-scheme: dark)');
        const reduce_query = matchMedia('(prefers-reduced-motion: reduce)');
        const pause_input = document.getElementById('motion_pause');
        this.motion_query = {
            get matches() { return reduce_query.matches || Boolean(pause_input?.checked); },
            addEventListener: (type, handler, options) => {
                reduce_query.addEventListener(type, handler, options);
                pause_input?.addEventListener(type, handler, options);
            },
        };
        this.points = [];
        this.waves = [];
        this.holds = new Map();
        this.hill_data = new Float32Array(config.hill_count * 4);
        this.wave_data = new Float32Array(config.wave_max * 4);
        this.wave_levels = new Float32Array(config.wave_max);
        this.uniforms = {};
        this.sim_time = 0;
        this.last_frame = 0;
        this.last_scroll = scrollY;
        this.frame_request = 0;
        this.abort = new AbortController();
        this.measure();
        this.globe_progress = this.scroll_progress();
        if (!this.setup_gl()) { this.container.classList.add('fallback'); return; }
        this.spawn_points();
        this.paint_land();
        this.bind_events();
        this.resize();
        this.apply_colors();
        this.sync_loop();
        this.ready = true;
        this.container.classList.add(config.ready_class);
    }
    destroy() {
        this.abort?.abort();
        cancelAnimationFrame(this.frame_request);
        this.container?.classList.remove(this.config.ready_class);
        this.ready = false;
    }
    compile_shader(type, source) {
        const { gl } = this;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(shader));
        return shader;
    }
    setup_gl() {
        const { gl, uniforms } = this;
        const program = gl.createProgram();
        gl.attachShader(program, this.compile_shader(gl.VERTEX_SHADER, Contour_Map.vertex_source));
        gl.attachShader(program, this.compile_shader(gl.FRAGMENT_SHADER, this.constructor.fragment_source(this.config)));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error(gl.getProgramInfoLog(program));
            return false;
        }
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const corner = gl.getAttribLocation(program, 'corner');
        gl.enableVertexAttribArray(corner);
        gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
        for (const name of [
            'resolution', 'hills', 'waves', 'wave_levels', 'globe_radius', 'globe_spin', 'globe_center', 'light_direction',
            'valley_color', 'mid_color', 'hill_color', 'primary_color', 'intro_flood', 'intro_light', 'intro_glow',
        ]) uniforms[name] = gl.getUniformLocation(program, name);
        return true;
    }
    spawn_points() {
        const { config, points } = this;
        const { random_between, clamp } = Contour_Map;
        const depths = Array.from({ length: config.hill_count }, (_, i) => (i + Math.random()) / config.hill_count);
        const shift = 0.5 - depths.reduce((sum, depth) => sum + depth, 0) / depths.length;
        for (const depth of depths) {
            const heading = random_between(0, Math.PI * 2);
            const speed = random_between(0.2, 1) * config.base_speed;
            points.push({
                x: Math.random(),
                y: Math.random(),
                base_x: Math.cos(heading) * speed,
                base_y: Math.sin(heading) * speed,
                kick_x: 0,
                kick_y: 0,
                depth: clamp(depth + shift, 0, 1),
                phase: random_between(0, Math.PI * 2),
                rate: random_between(0.5, 1) * config.height_rate,
            });
        }
    }
    paint_land() {
        const { gl, config } = this;
        const [width, height] = config.land_size;
        const scale_x = width / (360 * Contour_Map.world_units);
        const scale_y = height / (180 * Contour_Map.world_units);
        const painter = Object.assign(document.createElement('canvas'), { width, height });
        const context = painter.getContext('2d');
        context.fillRect(0, 0, width, height);
        Contour_Map.world_countries().forEach((polygons, index) => {
            const path = new Path2D();
            for (const rings of polygons) for (const ring of rings) {
                ring.forEach(([x, y], corner) => path[corner ? 'lineTo' : 'moveTo'](x * scale_x, height - y * scale_y));
                path.closePath();
            }
            const tone = config.land_tone[0] + (index * 0.618034 % 1) * (config.land_tone[1] - config.land_tone[0]);
            context.fillStyle = `rgb(${Math.round(tone * 255)}, ${index + 1}, 0)`;
            for (const turn of [-1, 0, 1]) {
                context.setTransform(1, 0, 0, 1, turn * width, 0);
                context.fill(path, 'evenodd');
            }
        });
        gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, painter);
    }
    bind_events() {
        const { config, waves, holds } = this;
        const { signal } = this.abort;
        const options = { signal };
        const still = () => this.motion_query.matches;
        addEventListener('resize', () => this.resize(), options);
        this.dark_query.addEventListener('change', () => this.apply_colors(), options);
        // a manual theme switch sets <html data-theme="light|dark|...">, or swaps a class: repaint with the new tokens
        new MutationObserver(() => this.apply_colors()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
        // the Auto / Light / Dark radios flip the tokens through :has() in style.css, no attribute changes, so listen to them directly
        document.addEventListener('change', event => {
            if (!event.target.matches('input[name="theme_state"]')) return;
            this.apply_colors();
        }, options);
        this.motion_query.addEventListener('change', () => this.sync_loop(), options);
        document.addEventListener('visibilitychange', () => this.sync_loop(), options);
        const observer = new ResizeObserver(() => this.measure());
        observer.observe(document.documentElement);
        signal.addEventListener('abort', () => observer.disconnect());
        addEventListener('scroll', () => {
            const delta = scrollY - this.last_scroll;
            this.last_scroll = scrollY;
            if (still()) {
                this.globe_progress = this.scroll_progress();
                this.draw();
            } else this.kick(0, delta / innerHeight, config.scroll_strength);
        }, { passive: true, signal });
        addEventListener('pointermove', event => {
            this.follow_pointer(event);
            if (!still()) this.kick(event.movementX / innerWidth, -event.movementY / innerHeight, config.pointer_strength);
        }, options);
        addEventListener('pointerdown', event => {
            if (still()) return;
            const ask_permission = window.DeviceMotionEvent?.requestPermission;
            if (typeof ask_permission === 'function') ask_permission().catch(() => { });
            if (event.button !== 0 || waves.length >= config.wave_max) return;
            const origin = this.pointer_to_field(event);
            const wave = { ...origin, level: this.ring_level_at(origin.x, origin.y), born: this.sim_time, released_at: null, front: 0, erase_front: -1 };
            waves.push(wave);
            holds.set(event.pointerId, wave);
        }, options);
        addEventListener('pointerup', event => {
            this.follow_pointer(event);
            this.release_wave(event.pointerId);
        }, options);
        addEventListener('pointercancel', event => this.release_wave(event.pointerId), options);
        addEventListener('blur', () => [...holds.keys()].forEach(id => this.release_wave(id)), options);
        addEventListener('devicemotion', event => {
            const shake = event.acceleration;
            if (!still() && shake && shake.x !== null) this.kick(shake.x, shake.y, config.shake_strength);
        }, options);
    }
    measure() {
        this.scroll_range = Math.max(document.documentElement.scrollHeight - innerHeight, 1);
    }
    scroll_progress() {
        return Contour_Map.clamp(scrollY / this.scroll_range, 0, 1);
    }
    hill_height(point) {
        return 0.5 + 0.5 * Math.sin(point.phase + this.sim_time * point.rate);
    }
    intro_progress(start, duration) {
        if (this.motion_query.matches) return 1;
        const linear = Contour_Map.clamp((this.sim_time - start) / duration, 0, 1);
        return linear * linear * (3 - 2 * linear);
    }
    intro_sync_progress(duration) {
        if (this.motion_query.matches) return 1;
        const remaining = 1 - Contour_Map.clamp(this.sim_time / duration, 0, 1);
        return 1 - remaining * remaining;
    }
    kick(delta_x, delta_y, strength) {
        for (const point of this.points) {
            const nearness = (1 - point.depth) ** this.config.depth_power;
            point.kick_x += delta_x * strength * nearness;
            point.kick_y += delta_y * strength * nearness;
        }
    }
    step(dt) {
        const { config, points, waves } = this;
        const { clamp, wrap } = Contour_Map;
        const damping = config.damping ** (dt * 60);
        for (const point of points) {
            point.kick_x = clamp(point.kick_x * damping, -config.max_speed, config.max_speed);
            point.kick_y = clamp(point.kick_y * damping, -config.max_speed, config.max_speed);
            point.x = wrap(point.x + (point.base_x + point.kick_x) * dt);
            point.y = wrap(point.y + (point.base_y + point.kick_y) * dt);
        }
        this.sim_time += dt;
        this.globe_progress += (this.scroll_progress() - this.globe_progress) * (1 - (1 - config.globe_follow) ** (dt * 60));
        const erase_limit = config.wave_core * Math.sqrt(config.wave_strength / config.wave_min - 1);
        for (let i = waves.length - 1; i >= 0; i--) {
            const wave = waves[i];
            wave.front = config.wave_speed * (this.sim_time - wave.born);
            if (wave.released_at === null) continue;
            wave.erase_front = config.wave_speed * (this.sim_time - wave.released_at);
            if (wave.erase_front > erase_limit) waves.splice(i, 1);
        }
    }
    pointer_to_field(event) {
        return { x: event.clientX / innerWidth, y: 1 - event.clientY / innerHeight };
    }
    ring_level_at(x, y) {
        const { config } = this;
        let field = config.field_floor;
        for (const point of this.points) {
            const wave_x = Math.sin(Math.PI * (x - point.x)) / Math.PI * (innerWidth / innerHeight);
            const wave_y = Math.sin(Math.PI * (y - point.y)) / Math.PI;
            const distance = Math.max(Math.hypot(wave_x, wave_y), 0.0001);
            field += this.hill_height(point) * Math.exp(-distance / config.hill_radius);
        }
        return Math.log(field) * config.level_count;
    }
    follow_pointer(event) {
        const wave = this.holds.get(event.pointerId);
        if (wave) Object.assign(wave, this.pointer_to_field(event));
    }
    release_wave(pointer_id) {
        const wave = this.holds.get(pointer_id);
        if (!wave) return;
        wave.released_at = this.sim_time;
        this.holds.delete(pointer_id);
    }
    draw() {
        const { gl, config, uniforms, canvas, hill_data, wave_data, wave_levels } = this;
        const { width, height } = canvas;
        this.points.forEach((point, slot) => {
            hill_data[slot * 4] = point.x;
            hill_data[slot * 4 + 1] = point.y;
            hill_data[slot * 4 + 2] = this.hill_height(point);
        });
        wave_data.fill(-1);
        wave_levels.fill(0);
        this.waves.forEach((wave, slot) => {
            wave_data.set([wave.x, wave.y, wave.front, wave.erase_front], slot * 4);
            wave_levels[slot] = wave.level;
        });
        const center_y = this.globe_progress * height;
        const toward_x = (config.light_anchor[0] * width - width) / width;
        const toward_y = (config.light_anchor[1] * height - center_y) / height;
        const toward = Math.max(Math.hypot(toward_x, toward_y), 0.0001);
        const direction_x = toward_x / toward * 0.85;
        const direction_y = toward_y / toward * 0.85;
        const direction = Math.hypot(direction_x, direction_y, 0.5);
        gl.uniform2f(uniforms.globe_center, width, center_y);
        gl.uniform3f(uniforms.light_direction, direction_x / direction, direction_y / direction, 0.5 / direction);
        gl.uniform4fv(uniforms.hills, hill_data);
        gl.uniform4fv(uniforms.waves, wave_data);
        gl.uniform1fv(uniforms.wave_levels, wave_levels);
        const spin_time = this.sim_time / config.intro_spin_peak;
        gl.uniform1f(uniforms.globe_spin, this.sim_time * config.globe_speed + config.intro_spin * (1 - (1 + spin_time) * Math.exp(-spin_time)));
        gl.uniform1f(uniforms.intro_light, this.intro_sync_progress(config.intro_light_time));
        gl.uniform1f(uniforms.intro_flood, this.intro_sync_progress(config.intro_flood_time));
        gl.uniform1f(uniforms.intro_glow, this.intro_progress(config.intro_glow_start, config.intro_glow_time));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    frame = now => {
        this.frame_request = requestAnimationFrame(this.frame);
        if (now - this.last_frame < 1000 / this.config.max_fps - 1) return;
        const dt = Math.min((now - this.last_frame) / 1000, 0.05);
        this.last_frame = now;
        if (document.documentElement.hasAttribute("data-background-wait") || document.documentElement.hasAttribute("data-skeleton")) return;
        this.step(dt);
        this.draw();
    };
    sync_loop() {
        cancelAnimationFrame(this.frame_request);
        if (document.hidden || this.motion_query.matches) return;
        this.last_frame = performance.now();
        this.frame_request = requestAnimationFrame(this.frame);
    }
    resize() {
        const { gl, canvas, config, uniforms } = this;
        canvas.width = Math.max(1, Math.round(innerWidth * config.arena_scale));
        canvas.height = Math.max(1, Math.round(innerHeight * config.arena_scale));
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
        gl.uniform1f(uniforms.globe_radius, Math.min(config.globe_reach[0] * canvas.width, config.globe_reach[1] * canvas.height));
        this.measure();
        this.draw();
    }
    apply_colors() {
        const { gl, uniforms, config } = this;
        const base = this.dark_query.matches ? config.colors.dark : config.colors.light;
        // The page theme owns the palette: --bg-valley / --bg-mid / --bg-hill / --bg-primary (6-digit hex) win over config.colors
        const style = getComputedStyle(document.documentElement);
        const palette = {};
        for (const name of ['valley', 'mid', 'hill', 'primary']) {
            const value = style.getPropertyValue('--bg-' + name).trim();
            palette[name] = /^#[0-9a-f]{6}$/i.test(value) ? value : base[name];
        }
        for (const name of ['valley', 'mid', 'hill', 'primary']) gl.uniform3fv(uniforms[name + '_color'], Contour_Map.hex_to_rgb(palette[name]));
        this.draw();
    }
    static world_units = 5;
    static world_code = 'jSG_3BqLGABFLACIGBHAyLAFqwDBFBBEOGvwDAEuhB9NkBTCFOJFoiBrNDNGHBPMTDuiBuMdLbADxhBoMHWJCCohB0MTID-gB4MLSBWD3gBsNOKDKD8gB2NEIDEC8gB8NkBCC5asSABI5arSAPhBCAZHBBRlBABDCvZrRAEHvZtRWCKUMMMUaECEI-I3VtBSFKCGNEBILGAGJ3H0WGMRGPSTOTHPKTEA-CsDjG_YsBJWIOAgBGGDKGYJOICHcE-BHOFPDUDiBEMFKEJGGCUCSHeDeCBGKCODAJIIIAEKVKAMMIYFMLHDSDAJOIMFDHKFSQAKeBODAFHDIFBDTHXCPRhBLAFLBVTDROBKROC6BRcBATIJOJIEGKFQFEQGQOHOLIMKHasBAYLSBETQHOGQQgBhBDFsBREHMFCJrBT_BAvBhBaOkBKIDJHIRMDQAKMCHGB3BXHAAISIbAW0RkVFGAMNENTJDfATNTADBCFjBLFEKQDSVOjBQfBbEDIDDzIAEgP6XWGLHJCG1PuZJGACcASHjBAFwN5ZFDZEUGMFDvNmaZCaBGgNsaMDRFHCDISAOrO2ZpBEDKJGhBEEE0BDIDBDSDwCCOHVF9BAF4KpaOBVFPEYEE5KsaOBdBQEXuTjWLPGEIBDDYDDFIAEJDJLCAKLJFCIEJCdAEGDESWQIEABBKhPoYkBNHDVIXLBGNAIEGSUFyB6PsZKEkBJCDSCKFYDSNRDoBJOHQBDFRLbOLBBFcLIJDHlBMaRZE7BWdDHEIImBABECGOIHIhBIGEbKXDnCGJEMENADKSOaCHFIFKIYESJBHUEGrN1ZoBDjBRLAFOOIH-I_ZkBOeABHHBpBHNEHsHwWKCBLIHRMBIEBH1LvauBFMH3BEKCLEAEG6I1VTCXMDIaFWPLkJ2ZoBBUHjBHLHADZDdIUSJGiBCOpL9ZUCAFFD5BFPEUE7BAYMgCJNKIEKBIHdvLvZMDKPiBJADRAIDDDjBEpCFDEXCLIyBE3BCDEWEfCQMaGKBDFWEOFKGSNGEHKSAMuMuZLGMEeACDHDODBJPDnBOACUAFvLyZUBHFPGECJ4MiaGFDLPBJCAGRAAIqBENkN1aSEFCYAuBHUJfLlBCLEIGRARIIEb6N7a-BIWBIEeEwFF5BJWA5BR5BDOBFBIDrBNUDbF3CCBGSCDIgBDdIeKTI0BC5BCnBMHsQzYRDBGEGKAGBAFGjN9YGBFDjBGQIUHDhS7VcFbGHkStVEDQBHDNEBEEClB0RkVCDfLDFBFIHlBFSATBJRFEGJJLCIFMALFCGBGXfVXTANOfDPHAFGJUCILONDLIfBCJlBGNDZPATK-MjSRGTeNEHHHCZarBDlBOXBK6JlTNOTGlB6BBYGcFaOBGJBUG7DmRGDHFDICEEBEkCwXIDRCKCGmEkXKDRHFCAEOG0B3H0WNGBKNIDKZAfOpCMJBCFlBHEQKCBChBRIFJFVHTNhCNgCYIGIOTFNGPDCKHELBPIAEHEEGMMQBWIHGIEpBDNCRKmBKIABFWCzBWGESCYO2BKWHmEHFpBhYgBFJBTEBEK5pB4VPHAJFDTEHRXFIRFBAFG1oB2UJExBEHFPCHFMnnB1UbPBGLABIFAAKLIbBhBUZFAjBD8kBxUTKNFKrkBzUAKLEJOIACGQAAQRCTFkB6jBqVFCAEFIFAJGMUKFCIUKQCiBLKEcDSCCEPIQKFGEEmBEmBKSBEJYBBFiBKBBMHWZGGOFOCWNMCGFGnnB1UCAHFaHLFHAKnnBrUFCCGLBHLHADDIBCHFJC3mB8TLCLxmB9TAGXIRMFKNCDKNGPJADJATlyB1NkBLOPQFCFHBCFQRGCBFQFHDTETWLEPFCHHDPCClyB0MAiCH_zBwNGHDDDKRKEEQLM5zBlNPFNGOCEGAFGCIGAGGACFJJFq0BnNKNFCFOCBSlyB0MHKZBKKFUrBSFFBIHGQGNAPMSGQDETKFUQkBHC1vB2MAFF1vBzMFHJAGKKEUxuB3ODJGJBDMHLBBPJFDZBELFDILCLBBEPABOJMAIGQHotBsOKLWGKBICMeUBGrwB0NKBEHbECGMAHkwBtOGJAJDCBLFSGMcrvBmOWGHJHBhBABHKHYIBDDALJQhBFBDEGINBCEHGCKFDAZFADCAUFGKeKMWFF9uBvMLGKCIFFBGjvB3MQGBFbBIGGDGzuB4MGCEFXBKKEDMitBiNCDUACESFEFcHLD_BKbKGKYFQusB9NENOFDbJAVQhBsBFQhBkBWBgBfKAIFOLDJKBFtR7FILcHFFNED1RwFPAAWCkTrJHlBbgT4IADMHBHGDAFJLNFfACRFDXACJGDGEEFRHDPPFDHUHDJLDFLNJKPDCXtR9FhBCDOJCAKKMIgBECFGEEHQECEeGEDUIGGSHcKeOQBWKGCMG0RwKKKMBGHEIOBIrSzKSPeNCDJPeBIICIFzThKECGFAHnBfH1RwFLHbGjBWiBLKKQEFoRqLMRDJKXGAXtR9FVFBJPCXOFkBOQNEKICQMBEUFCDLFCMoBDUEASwBAkBEMK-BDeCkRmLIIK-gB4MRAFHAZMDAJFARQNBRIJ8frMRADmBRCFBDHPAJWnBBCiekNBCChelNIKHleqNMCEDOOESMOIoBHgf0OCGIIeJEIQEeAEtgB8OGHSCKJF-gB0OALEBNPBTC4gB7NFNC1gB0NEPE0iB6NFIAkBIME1iB2OSKOAceDzjBqPMOAUH5jB7PWGBNPlBbnBhBZPREuhB9NBMMSJWCuhB3OMOG0hB-OKLUHOBMIKBD0iB6NNJJTE_frPLICKHMG2f6PFOBAKeIAAoBE7fkRAEMAAUChgBwR2DAD8hBwRGhBKFDkiB8QPJDZE6hBqQFRPTBTQuhBtPBSFEAODAHBEJJLNEJHVAJKHBDLHDIDG2f6PJFHLVDHLbDGwenPBOJICEMAJcJseiQCGFADKEMMKImBJKBODue0RKGwClBC9QlRARI9Q8QZEACUADIFCCEOBH9QlRSBQJBDTCHHDEJ5qB3aWCqBNBJVArBGHINCaGGmsBuaaDDD3BDSMQAH6xB_Z-BFHHzBBTGGIMCGpzB7ZaDLDhBGCCSAE_xBxZWEQFlBCGkjB1akCCnBHJCEEVAC2fyWfADmfyWCEOEDuf2WQDADSwkBzZYIDE4BMmCIGDnDVdTCHUHnBABERCBGKCAGUIHCQvyBvWCTObNEFPKJAFHGHHCyBFKAOKEDEECEFCywB1UBCTxwB2UAGGABUUCUgBnBFDKLGREPeXGZBHDGBAFPRNFLCOruB7VVElBJVAPKfBNGBGfIJJEFJFxBKrBPC7pB4VDAD6jBqVZRUbD3jBzUHFNGDsjBzUJI1BIGsiB7UhBSQKFEQEJCKjiBuVGGKACStBKDGHACGFGTBGjhBnWDIMEROAIZGCxgB7WJMEsgBhXGEDKGGDwgBrXMGLGKwgBxXkBWPIEGHIGILMKGPICGCzgB7YaG5FghB-YKEsBJsBPCFbHzBGQFCPUFCGFEGEYFICFGWKUDGIJGGGHGcDGFLAAFIDOCEI4BMGAJF2BGMFKIJGGCeByBPGGJILACGFKiBUaBCFJHKJBNKFXTMBaQFGGGLABGIKLIQIBGKFDHMBDGQEUCSFHIAK-BEHEMI8BIiBAqBEMIYEQBLBWBCFmBEgBJDDrBLkBBGFUEsCHAImBBQFEFFDcLKKQD8BAFKME8CFiBN8BAIDAFMDkCCSJMEHGEEyCFhwDDyBRAFGBBGcAUJbFAJDBdIBEVAFEEELDEDFDwwDAZDUPBFRClBJfRNIbHDEJDLAPPADMBBNHADJEDRDDLNBDJNJNsBGOIKQC0BgBIOLBFHXJHMZDZPIFlBDCIPALD_BBlCpBQBOHGEMAOLNtBzBxBLFNENJGAoZYDXDmwDABCjwDGCrhBoVQBHzhBnVQDbJDCCELEKGE9PgSGNHICGHyS_FaIIFPFDEHDFEMwewaSEuBJZDRRLAVGIEhBKHIcEUDHzgB7YEILEPDNLjBIFBPrf8YFBBFRCBFJAffEDDDJAFHANGFDJLNP7doXFGTJNDNGFiB4BYqBiBsBUmBEQIkBCeHLBMFHtgByaNDdBdCZI4BCsBFHggBnaXDPCGEFCUCUFzC6U_ayCK0DA-BHvDFoCDSCKBLFqCIeBGFtCJWATNCLMFfDSFCHJAMJVAMDDDbAMHADXCaJEHRBTKEFLFoBA1BRnBBXP3BLHFFNPHEFJTNANITAhBcFQNKCGFEKMQEGMZHLECMeBZKRAKKZWLCAGZGpCBbKuBE_BGAEqCKEEZE6BMDE2BEqBDaG6BHVGAEF9mBvGQFDFNACMD1vB2MYEXJG2ezJEGGHKBOGAkBJnfmKKJAJIASQIDOCQSWQC3gB0KSBDghBzKIVBNFjhBhKHADJGDIECkhB8JIAKohB8JFTnBnBXLfCZJPGDQCKReG1gBxJJCJJMHMODCL-MjSFhBUjBOFeGGEGSgBGCHJZDECrO_QJHHmO7QRAAFDAKLNADNc3NrQPOHCTFjCaPMHKGKHOfcAILIBGPMJWPGCPejBKXMHFFVUBMZSEAEINKPeGkTrJGAgBRGHDDCFE5T5IPLbGFEGzThKESLADQVEBSMhT9KIUHKAKTADYlBOJIASLBPJNALoRrMJACQJFRGCEJOIKEOUKKAJnRtNEeFSIAAEFAAIWCIHL2RoOEDIAOGIIHCBODCSBUICGH0S8OIBEJDLEJKFUGEpTrOGAAIOBDzTuOQBOUciU3OCAIVGBAHFHCBSBAJIGcJGFBDMCiBDcTQDIVDPhBnBFvBRpBJJZDdNHJDbtBzBEhT9KJIZBHZFoRqLGKDQIYJQHkRmL3BmBlBqCNKCGDIKOHyPxNAJMFOUMEKKCOHrQhOSJGLWCIFFJIDErQhOHGLANKG6PpOEMMMBCASDOD_PmPGIBGIhQtPSICMEEQCQMGBBDM_Q9PPNDLGBITUAGHUBDNELDFKPJ_PmPFICEJGLHEFDDNKLADlPrPAMECEnPyPMHYIQJFlPrPTSBDDEBKC3O5PWACiP5PKND3O5PRUCADvOjQYSSCCkPtQDnBCvOjQDEDtOlQAEPGClOqQMODrOxQgBCSJDtOlQFBPGCiOnQGGCmO7QCTCnOxQIACiOnQVIDrO_QBTFHQ_Q9PFDEXGIDMMECISPUAOFEGaCJDUJCHIBG5SsPHFEHJDBFGHC5SsPaXDmTgPHTOVCmTgPgBBE2T_ODJELFLD2T_OMDMLDjd5VSDFNGpdwVFAHHAFECEDGmdoVCFBDCHGABFFpd8UHDTCNDBFDzc2UZCXIM6b7UGGCURQNEBGeADMKDYICIKCCxciWePCgd6VGBFwd3UGEBPDCAKIyPxNGIBEDDFEAMKSMGF5R_QGDPBCGIAFgQ-QOFJALEICMpP2RmBFcROFjBDIGLEFIhBIECfHcOF3gB0KNGBKPMJOEigBpLSBUUMEF7gB0LCBYJBjBNRHnfmKAeKACkBWEEDOGChgBqLCBF2ezJLQJwBXqBAGH_drLQEGDqBAIDYBSEC4fqLSADwZmQHMMODyZzQSEYTCnarQGVCqagQTCCgahQdBCxZgQBIEwZkQeELCRBFnarQGI8BCH-COAErb_RyC1BAFKCE5ciRAXFLfFGmctQNAVNHBLPBNCpb2PZBF8a1PLWJFLCBEC5arSkBXDyZzQCmBHKCxchPHAEtchPBeHMAGCoc5POKDvc-PGCIFE2c8PCPJNBXCseiQBDKregQLMFFNETFLGJBNGLBFTEvc-PAGLCFWC5ciRuCqBDge3RWJGEIregQCHHHRlBHDHEJFFPEvd6ObFNURAEwenPFLBNQZD0etOADdECletORAC8dtOPAD0dtOCILSCtchPHBCpcgPJyBCkc5PIADpcgPdLHCE2b7ODMGUBOD2byPBOeADpb2PKHQAD2b7ORCfHE9a4OCOJGCME6aoPGKFMEEE6aoPHBFMDBExasPJQLBHHCiavPTUD4Z5POICIC4Z5PNOD9a4OLEXUCrakPMQDrakPPKBMDgf0OLCLPC_frPcdDleqNDEFFCgepNJKM7duNIGDGKECEODCECOFGEMJCBID7duNVcGWDzdnOSAAMCzdnOCMEohB0MGNHfGBDqhB8LdHAHF4fqLNQCgBUBAUIxhBoMATKJCLHJFGAQLGKuiBuMEpBDHJNTHZVInBFFXNCJCkhB8JBKChelNBIE_drLEeQgBN0BC1gB0NOEC3hBmTBDE2hBkTDCBLEAC1hB_SDRCzhB2SHQCvhB-SKSC0hBnTGCC3hBoTADC0hBnTIQD4hBvTGDHJT8jBkMIhBHACJbxCPFNGFWAOECGSDUEMUEOMAKEBKSEDC2hBkTBJCwZkQAEEzd6SDSNMIkBJud7TMEGBADICDFCPFDMLF9doTAHNJAHFBH5asSAMiBMQIAIWGHeD5byTkBOmCEHzd6SENAXDFKPECMLD3hBmTKDUKCmiBpTELGoiBjTVFKJDFPHJCCzhB1SACDmkB7RYAUSC8kBkSCBC9kBjSCHF-kB_RFACHDBDLD4kB0RfCDMEikB-RAGEICPClkB9RFCC0jB4SENC2jBxSREDtjBzSIKGAEmiBpTWKCUMIC4iB8TYAIkjB8TMPFPIJMFEFBHKJC3jB4SFAEtjBzSRCdUZKM-kB_RKLOBKLNTFBBLJDDHFAHHPDCukB1QLYEokBhReKGUDIEm2B0LBKGLDCElsB_PBMGIWAEysBpQIDEIKDF9sBpQARPHEFRFDusB2PJCHQHlsB_PRECIJAHhBMZSLEjsBhPJFBGJCE4rBiPNUBFCWIxrB0PKSFUHOIKPWIOUGK5rBoREHGBBRWIIBIHAJIHDNC5rBoRKKE-rBtRGBBMGAIjsByRKPMAEJJFMFYZARIxrB0PAgBNmBRLLCCWHQLICyqBpRCOJzqBwRGCCSIBEIGUMGIBCMNrrBvSGCGHAPHJBLKCCHIBDHMFICADGjsByRgBKOFBFEDKBJgtBuRLJLPgBlBEjBnBdDGCIFEGywB1ULFCHVJBFKFCmwBjUVHE7vB_TNEGMLGHxvBqUaSODBGQEEGGFHmwBjUKRDRZFBYGAFKWruB7VLPEDWCSJBDVAnBRPEDHEFNJ1BLpBKrBCJOrBKDGEKHIVKBGNzqBwRDQDFFGMOXCBILEDFIFJFGDEVXhqBwRBDRBAFFFNHbXADRHF1BDAFHEDJBFJJKdmCJ2BVFLMEEBELIP5mB4RGIWAHUFGKKMAaeAGIGHGFQEEaBKIHpoBzTMJCNAFHCEJYNF6oB5SLNiBNuBJCOD9pBtSGCAHEgqBqSKDWADKHuqBtSeOIBIEEFDDMBFyqBpRJWJABJLCDgqBqSMKQDE6oB5SMAiBTYDE5mB4RHEJOxBDF3lB_REMQGFOTQM0lB3SSDmBEGQYGBGMIDGIAIMDIoBMD8nB8TKNQDH3mB8TOAQMGBENOGSAC7nB9TCBG0lB3SKKBGFCDOGaG2lB0TSBQKCIKEIBEnnBrUNABFqBBE0nBnUEHIBCJG1oB2UTLLBDFRALJF2lB0TAIlBQRAPHLykB8TBSFCCIHAEISCJMHDBFBGDkjB8TFWGECkjBpUOJCrjBkUEAFtjBkUOIEDDDIDF4jBiUEHQHOASEK3lB_RnBIDMFCPHNERKNYLCDDC4hBvTCME5hB1TGKcAcEDrjBkUDGJEDkjBpULEAIC-iBvUOCFljBwUIJBDIDCFDrf8YeLETO8fsYRBJHCFjBPFNQNJJJBJZLAFHJATiBFjhBnWHBDFzBGRDE6fkWDIGCDOE5fwWWCKKBECogB4WSGEjiBuVXFHDADFrhBoVPEBEHBLNC4gBkVNCFxgBlVGKMCNQTADpgBzVRDTAC2fxVHGCyf0VGGE1f3VAEOKDMC1f3VlBECif5VlBSCveiWHaDrevWiBKUDC2fyWGDE5ezVADFABJC1esVXBDperVPGRDD4dsVJECEE0dwViBBBIIGCoe2ViBBC5e1VADD2fxVRNHBCpfpVNBCifoVVGC3erVDCE5ezVIDeIMBDxgBlVAOPOD4gBkVHBBLFzgB9UNEPFZCDEE1f_UCELCNOCuf2WBIDtf6WmBEQHGtf6WGOKEIHIACIC-fjXcDF-fjXAGJCAGuBCDveiWbJONC0dwVVACjd5VBICid9VCGEjdgWBKIECMDndtWSGBKCvd1WOAE2d1WKJQEQFDzgB9UJLEFCwgB0URBDngBzUADfAC3fxUFKE0f2UGIFECGFngBzTNDLCCGYDDngBzUEBFHPmgBuUVBGDFBLCIJDBKHAFHECFFAEJPENcCpfoUIMCtfuUUGV5hB1TDEEENCHFNAHEVDTELQEIFEKKQAEIUBYKQAgBJUAMGC0iByUUFFwgB0UIJLALHDGDpfoUHGAQDlfzUEICACof3UGHCrfzUEJDifoVGHDDEjfiVdEBDcVChf3UBBGgf2UXMJOHCBDBGEpelVQAEIIEF4dsVADLABDVACgd6VEGCxciWICD1cjWQAMFD1cjWOQWEK3azUIECDOACDDBBNDBEPDJG_a7TNBAOHGIUBKE3azUDMOI8BDLzc2UAFJFLBJPEFXVVAJFLKHAIlbvWCFHJRFNCIKDKUOD-a2WALOBGh2B5KOLDBNINOSHEi1B6MEFRMOFT43B6HHLHDFEGINIIIAOTcSFKTAGEBCHODMEFPHADHN02BoHgBgBEJIECDNTCDPDHRLFbEEKaQJmzB2HGABXDCHFHALcQDMEyC7vBhJTHFHlBBRJNAPIAGIEAKHcPgBEDDKIFHSEUEGAHEIWKoBMOOCKGIEHECBECEEBCIMOOEOJMBBGMSUEAGHEGAcJMEGFJJFPwBbGEEKEoBKSOnBGEIHKnBYNITMACJSRIdHhBRbJdPDTLPGCGNJdIJSNGAMDFJBKQAIRTHEJSbMzBHG9oBoPBLLDHWGQQVHntB9QHEAIWGCDFJJDbxvBqUfLMQFGnBVWPKGQDCDNDTPKFSbBFFDIHDPDAZjBbRPFDEdLDJFBAMRCGlvB8RJXFQMQGBBFCperVCJUqemVPBCNaTIABDaNBDNGDFIDBDHJFAGKHKpBYJQNENHGuehUIADPbKCGWAHwduUEEGFBNHBFUGBIvd1WDGAMYKDJIDNJEDGie7WCFFHJGAEOED-a2WUFFHc1btWAGFGNECGBCFDFOMSUAJJUALPMAINIBINMBFJEFHD_BFYMRGKEFECGQAR7ZuYBFMFNHjBJpBGKEVESGVCIGOCQFQEMBQGQBE3jBzUSPHAHRDljBwUOBAID0iByUBKNIFgvBiQDGMDDHDGIpvB0PEIECAHGKAJJLDKS8vBsPCLDJDKDDALLGAMFEPJAEEIKGEDQIAIIFCHF1uBxPNJYeAHJLQovB9QCLJJCPWFALJKDDFGNAEIDCADFKIgBQDFmvB7PBEOBLLAKK4vB_PCLHECJDBDMEAAEFIODHjsBhPMNCTGPFAVQNkBFotBsOQBCIQGMOE_tB5OEFIEAKFluB9OSQEJQFNLC_tB5OMICpelVCCJwgBxXzBHNKCKFIGGmBUBELEC5e1VSIDkiB8QITmBhBC7iBhQFAG4iBhQXUNAFEDHLCXpyBmUHJBXFFdFNLFEBInBHKFFRHDDECKJIgBWeCMSGFUOKeKCEVN3yB-UIECLPBHJPGFJJABKGIKAGWaPI6wBpTQKIFFFJABDFCAEJukB1QHBBHjBPrBNHABGFUCMF6iB0QGMkBFWQcEE2jBxSEJOJGRClkB9RCDI6iB0QReRSHYJGVmBFAEOJxU8BUCaFGPlCJlBECEeGYQH5RxBsBBMIKDFJpBARIMyQ-CUACQQISZDHVDNCGEfAAEKEFkM7C4BBGFtBAPIF_IyCCCkBANFXEEoIzCGCaFfEGxC5BGEUBUJTBZKnFAaKGuBDsBIeH6CHcEiCF2BGEEnCEjBGKMBEnBI-BBqBKfK5BEZKDMOF4BA0BKBGCEMCGD8CM6EA6BGSJKEkBHmCBEGJGNAJQsBDcFgCCIIoBHmBDMGoBHoCKSKNWKMBMGGqBW0BOGDRHdDFFEHPDRNYLOPKbjBP9BNhCBkBLrBDAHaJ-EVOH0COmCBUG6DKJM7BBBKmCSgCEwBKSIECJEKGgBIUMcDGGYDmBCEDwCSSBMHaISDoBGWBMFsBCyBISKwBLiBM2BIoCUSBYLaHaGwBFILADRHCBKAJLSDMCcWmBEQKkBMoBAMKQJ-BBoBCeQiBNoBEiBIUHqBFiBI4BD8BGCIQNIBwCAMHWFmBDQCyBJYJ6BBmBHTTfHXRBHOLSBEDzBDTRoBNyBJGDqDJvwDADohByTSEFFCuhBxTLCEuhBxTJDHGGAKvZtRawBSSKCUSBMMUQKKQmBFDhgBwRBwCEQFigBgTmBHUIKFWCGzhB2SJTPWgB5BAHMLJ9doTmBJGHgBLKIBIKKUBYJE0hB-OLQJGKIE4iBhQHJCFKAE6iB5PBDKNqBLE7iBhQCFDBEDC8iB7PDDD8iB7PKJwBKC8gB8NHBD-gB0OaCGEDjfiVGHDDCkf8UFJCrfzUKECwf1UICEwf1UCEJGFDCpf4UJIClfzUJGCpf4UBBFwS4PIABFJBEIxFCBBABBCBBJEGIKMOQSUBBEWYacdBEegBiBkBBBmBBBoBBBqBBBsBBBuBBBwBBByBBB0BBB2BBB4BBB6BBB8BBB-BBBgCBBiCBBkCBBmCBBoCBBqCBBsCBBuCBBwCBByCBB0CBB2CBB4CBB6CBB8CGBElB-CgDiDBBkDBBmDBBoDBChBqDBBsDBBGuDwDyD0D2D4DBBFzD6D8D-DgEEBCiEkEBBmEBBoEBBqELBClEsEBCuEwEBCyE0EBB2EBB4EBB6EBB8EBB-EBBgFBBiFBBkFCBCmFoFBGqFsFuFwFyF0FCBCpF2FBE4FvF6F8FBBLP-FgGiGkGmGoGqGsGuGwGBBEyG0G2G4GBBGF6G8G-GzGgHBBIiHkHmHoHqHsHuHwHBBFlHyH0H2H4HBBC6H8HBBC7H-HMBBgIBBiIBBkIBBmIBBoIBBqIBDsIuIwIBByIBB0IBR2I4I6I8I5D-IgJiJkJmJoJqJsJuJwJyJ0JBB2JBC4J6JBBB8JBBB-JEBBgKBEzJiKkKmKBBoKBBqKBBBsKBBBuKBBCwKvEBCHyK0K2K4K6K8K-KBgLBBBhLBBFhDiLkLmLoLBBDqLsLrFBBLrL1FuLwLyL0L2L4L6L8L-LBBFxLgMxF5FiMBBGzLjM9FkMmMoMBBH1LpMqMsMuMwMyMBBEvM0M2M4MBBE3M6M8M-MBBE9MgNiNkNBBFjNmNoNqNsNBBDpNuNwNBBGnLyN0NrNxN2NBBDlL4NzNBBE3LzM6N8NBBE5L9N-NgOBBE7LhOiOkODBD9LlOmOBIoOqOsOuOwOyO0O2OBB4OBBDnM6OrMBBB8OBBB-OBBBgPBBE3KiPkPmPBBE1KoPqPjPBBFzKsPuPwPpPBBHyP0P2P4P6P8P-PBBH3PgQiQkQmQoQqQBBFZsQhQ1PuQBBFwQyQ0Q2Q4QBBI3H6Q8Q3Q-QlQgRiRBBE5Q9QkRmRBBI1HoRqRsRuRwRlR7QBBEzQyR0R2RBBE1R4R6R8RBBGpQ-R7RgSiSkSBBH5PrQlSmSoSqSsSBBD7PtSuSBBEjSwSySnSBBDpSzS0SBBGnQ_Q1Q3R9R_RBBGpG2SpRzHjH4SBBGnG6S8S-SrR3SBBEtR_SgTiTBBDvRjTkTBBINmToTlPrPxPqT_FBBDLsTnTBBIJuT9KwT5KnPpTtTBBC7KxTCBDlGyT7SBEhGrTvP0TBBDRxG2TBBH4T6T8T-TgUiUkUBBDjUmUoUBBBqUBBC7TsUBBC_PuUBBDwUyU0UBBIX2U4UxU6UhRjQtQBBH5T8U-UgViV9TtUBBFkVmVoVqVsVBBCuVwVBBDyV0V2VBBH_U4V6V8V-V3VgWBBErViWkWmWBBBoWBBEqWsWuWwWBBGrWyW0W2W4W6WBBFtW7W8W-WgXBBG5WiXkXmXoX9WBBEvWhXqXsXBBF3IuXwXyX0XBBCxX2XBBC7I4XBBJnX6X8X-XgYiYkYmYoYBBDlXqY7XBBCnYsYBBCjYuYBBF_XwYyY0Y2YBBG_D4Y6Y1Y8Y-YBBE9DgZiZ5YBBExDkZhZ7DBBF1DhE_YmZoZBBK9VqZsZuZwZyZnZ9YzY0ZBBGlUpU2Z4Z5V9UBBFvZ6Z8Z-ZgaBBDlKiakaBBFpJmaoaqasaBBLnJua5Jwaya0a2a4a6a8anaBBIpa9a-agbibkbtImbBBHobqbsbubwbyb0bBBH5a2b4b6b8bpb-bBBC1agcBBHzaickcmc3b3ahcBBFranbxIocqcBBFrJtarcscucBBDtJvcwcBBLjbycxb0cpO2c4c6c8c-cgdBBGlcidkdmdodqdCBBsdBFndudwdyd0dCBG7V5Z2d4d9ZrZBDld6dvdBBFzd8d-dgeieBBG7bkemeoeqeseBBEvbuerO1cBBD3c3OweBBF5cxe1Oye0eBBD7c1e2eBBC4e6eBBE5e8exO-eBBCgfifBBBkfBBBmfCBBofBBqfCBBsfBBufBBBwfCBByfBSvD9I5X5I1X0frX_WpXpYtYlYvYhY3Y7YjZlZBBB2fDBFtb4f6ftOveBB8fBB-fCBC_cggBBBigBCBCjfkgBBBmgBBBBogBBBFhJqgBxZhasgBBBFjJtgB_Z5dugBHBBwgBBBygBBB0gBBB2gBBB4gBBB6gBBB8gBCBC1W-gBBE1EghBihBkhBBBCjhBmhBBBFrb9bteohB5fBBExJqhBjajKBBF7a_b1bshB_aBBEhbthBzbzcBBEtHuhBwhByhBDBB0hBBB2hBBB4hBBBDvLzFhMBBDlW6hB8hBBBKhVhW1V-hBxVgiBtVnW9hBiiBIBBkiBBBmiBBBoiBBBqiBBBsiBBBuiBBBwiBBByiBBBC0iB2iBBBC3iB4iBBBD3Ud6iBBBFpH8iB-iB_TgjBBBHnH5HjR7U1UijB9iBBBH1G_GkjBvHzhBmjBojBBBExhBqjBsjBnjBBBE3GpjBtjBujBBBFVwjBtGyjB7GBBET3TvGxjBBBDne0jB2jBBBFpd1dje4jB6jBBBI5bncrd7jB8jB-jB1jBleBBG_dgkBpe3jB_jBikBBBEhejkB9jB5jBBBBkkBBBGrG5SxHljB9GzjB';
}
Contour_Map.instance = new Contour_Map();
document.addEventListener("jazu:background-ready", () => { Contour_Map.instance?.apply_colors(); Contour_Map.instance?.sync_loop(); });

export function mount(layer, options) {
    // The theme switcher replaces the whole background layer, so after Memory -> Default the old instance still draws on a detached canvas.
    const canvas = layer.querySelector('.background_canvas');
    if (Contour_Map.instance?.canvas !== canvas) {
        Contour_Map.instance?.destroy();
        Contour_Map.instance = new Contour_Map();
    }
    Contour_Map.instance.sync_loop();
    return {
        async fade_in(ms) { },
        async fade_out(ms) { },
        pause() { cancelAnimationFrame(Contour_Map.instance?.frame_request); },
        resume() { Contour_Map.instance?.sync_loop(); },
        dispose() {
            if (Contour_Map.instance) {
                cancelAnimationFrame(Contour_Map.instance.frame_request);
            }
        }
    };
}