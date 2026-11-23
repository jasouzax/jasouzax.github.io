/* Sway uses i3's tree and command protocol over its own socket. */
import type { Command } from "./command.ts"
import { I3_Manager } from "./i3.ts"
export class Sway_Manager extends I3_Manager {
    constructor(run: Command) { super(run, "swaymsg") }
}
