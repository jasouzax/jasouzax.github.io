// Entry of the lazily loaded shell runtime (one script, like client_theme_switch.ts): the shell and every utility in a single bundle, so
// the first `pid:` fetches it once and nothing else is requested when a program is started. The page's kernel (client_desk_proc.ts) loads it
// and starts programs from `programs`.

import type { program } from "./proc_types.ts"
import { sh_program, set_programs } from "./desk_sh.ts"
import { utility_programs } from "./desk_utils.ts"

const programs: Record<string, program> = { ...utility_programs, sh: sh_program, bash: sh_program }
programs.egrep = async p => programs.grep({ ...p, argv: ["grep", "-E", ...p.argv.slice(1)] })
programs.fgrep = async p => programs.grep({ ...p, argv: ["grep", "-F", ...p.argv.slice(1)] })
set_programs(programs)

;(window as Window & { jazu_desk_shell?: unknown }).jazu_desk_shell = { programs }
