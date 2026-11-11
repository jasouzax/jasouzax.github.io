/*
 * Entry point of the generated git hooks: `node hook_main.ts <pre-receive|post-receive> <project>`.
 *
 * Responsibility: read the pushed ref updates from stdin, apply the policy in git_hooks.ts, and either exit 1
 * with a message (shown to the pusher as `remote: ...`) or queue a pipeline job. Needs only server.json.
 * Scope: deliberately tiny and dependency-free so a hook starts in milliseconds under plain node.
 */
import { readFileSync } from "node:fs"
import { check_push, jobs_for_push, parse_updates } from "./git_hooks.ts"
import { enqueue } from "./queue.ts"
import { load_server_config } from "./server_config.ts"
import type { Role } from "./server_config.ts"

const [kind, project] = process.argv.slice(2)
const file = process.env.JAZU_SERVER_CONFIG
if (!file || !project || (kind !== "pre-receive" && kind !== "post-receive")) {
    console.error("jazu hook: missing JAZU_SERVER_CONFIG, project or hook kind")
    process.exit(1)
}
const config = load_server_config(file)
const updates = parse_updates(readFileSync(0, "utf8"))
const role = process.env.JAZU_ROLE as Role | undefined
if (kind === "pre-receive") {
    const refusal = check_push(config, project, role, updates)
    if (refusal) { console.error(`jazu: push refused: ${refusal}`); process.exit(1) }
} else {
    for (const job of jobs_for_push(config, project, process.env.JAZU_USER ?? "local", updates)) {
        enqueue(config.state_dir, job)
        console.error(`jazu: queued CI/CD for ${job.commit?.slice(0, 8)} on ${job.ref}`)
    }
}
