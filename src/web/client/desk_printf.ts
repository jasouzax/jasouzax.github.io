// printf-style formatting shared by printf, echo -e, tr and awk.

export function unescape_text(text: string, stop_at_c: boolean = false): { value: string, stop: boolean } {
    let out = ""
    for (let i = 0; i < text.length; i++) {
        if (text[i] !== "\\" || i + 1 >= text.length) {
            out += text[i]
            continue
        }
        const next = text[++i]
        if (next === "n") out += "\n"
        else if (next === "t") out += "\t"
        else if (next === "r") out += "\r"
        else if (next === "a") out += "\x07"
        else if (next === "b") out += "\b"
        else if (next === "f") out += "\f"
        else if (next === "v") out += "\v"
        else if (next === "e") out += "\x1b"
        else if (next === "\\") out += "\\"
        else if (next === "c" && stop_at_c) return { value: out, stop: true }
        else if (next === "x" && /^[0-9a-fA-F]{1,2}/.test(text.slice(i + 1))) {
            const hex = /^[0-9a-fA-F]{1,2}/.exec(text.slice(i + 1))![0]
            out += String.fromCharCode(parseInt(hex, 16))
            i += hex.length
        } else if (/[0-7]/.test(next)) {
            const oct = /^[0-7]{1,3}/.exec(text.slice(i))![0]
            out += String.fromCharCode(parseInt(oct, 8))
            i += oct.length - 1
        } else out += "\\" + next
    }
    return { value: out, stop: false }
}

export function format_printf(format: string, args: string[]): string {
    let out = ""
    let used = 0
    const next = (): string | undefined => args[used++]
    const has_conversion = /%[^%]/.test(format.replace(/%%/g, ""))
    do {
        const start = used
        for (let i = 0; i < format.length; i++) {
            const c = format[i]
            if (c === "\\") {
                const piece = /^\\(?:x[0-9a-fA-F]{1,2}|[0-7]{1,3}|.)/s.exec(format.slice(i))![0]
                out += unescape_text(piece).value
                i += piece.length - 1
                continue
            }
            if (c !== "%") {
                out += c
                continue
            }
            const spec = /^%([-+ 0#]*)(\d+|\*)?(?:\.(\d+))?([sdifeEgGxXocbu%])/.exec(format.slice(i))
            if (!spec) {
                out += c
                continue
            }
            i += spec[0].length - 1
            const [, flags, width_text, precision_text, kind] = spec
            if (kind === "%") {
                out += "%"
                continue
            }
            const width = width_text === "*" ? Number(next() ?? 0) : Number(width_text ?? 0)
            const arg = next()
            let value: string
            if (kind === "s") value = precision_text ? (arg ?? "").slice(0, Number(precision_text)) : (arg ?? "")
            else if (kind === "b") value = unescape_text(arg ?? "").value
            else if (kind === "c") value = (arg ?? "").slice(0, 1)
            else {
                const number = arg === undefined ? 0 : /^0[xX]/.test(arg) ? parseInt(arg, 16) : /^'./.test(arg) ? arg.charCodeAt(1) : Number(arg)
                if (kind === "d" || kind === "i" || kind === "u") value = String(Math.trunc(Number.isNaN(number) ? 0 : number))
                else if (kind === "x") value = Math.trunc(number).toString(16)
                else if (kind === "X") value = Math.trunc(number).toString(16).toUpperCase()
                else if (kind === "o") value = Math.trunc(number).toString(8)
                else if (kind === "f") value = number.toFixed(precision_text === undefined ? 6 : Number(precision_text))
                else if (kind === "e" || kind === "E") value = number.toExponential(precision_text === undefined ? 6 : Number(precision_text))
                else value = String(number)
                if (flags.includes("+") && number >= 0 && "difeEgG".includes(kind)) value = "+" + value
            }
            if (value.length < width) value = flags.includes("-") ? value.padEnd(width) : flags.includes("0") && kind !== "s" ? value.padStart(width, "0") : value.padStart(width)
            out += value
        }
        if (used === start) break
    } while (has_conversion && used < args.length)
    return out
}
