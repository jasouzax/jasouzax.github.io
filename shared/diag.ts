export class jazu_error extends Error {
    code: number

    constructor(message: string, code: number = 1) {
        super(message)
        this.code = code
    }
}

export type diagnostics = {
    errors: string[]
    warnings: string[]
}

export function new_diagnostics(): diagnostics {
    return { errors: [], warnings: [] }
}

export function report_error(diag: diagnostics, where: string, message: string): void {
    diag.errors.push(`${where}: ${message}`)
}

export function report_warning(diag: diagnostics, where: string, message: string): void {
    diag.warnings.push(`${where}: ${message}`)
}

export function fail_on_errors(diag: diagnostics): void {
    if (diag.errors.length === 0) return
    throw new jazu_error(diag.errors.join("\n"), 1)
}
