/* Existing CLI graph behavior, owned by its step. */
import { dependency_graph } from "../../engine/build/graph.ts"
import { run_build } from "../step/make.ts"
import type { flags } from "../config.ts"

export async function graph_command(root: string, flags: flags): Promise<void> {
    const result = await run_build(root, flags, true)
    console.log(JSON.stringify(dependency_graph(result.model), null, 4))
    return
}
