/* Pipeline syntax is validated without starting servers or contacting deployment services. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { expand_steps, step_order } from "../../src/pipeline.ts"

test("CLI composes steps, aliases, typed checks and forward ranges", () => {
    assert.deepEqual(expand_steps(["test:content", "make-host"]), ["test:content", "make", "watch", "serve", "host"])
    assert.deepEqual(expand_steps(["build", "deploy", "node"]), ["make", "cloud", "server"])
    assert.deepEqual(expand_steps(["all"]), step_order)
    assert.throws(() => expand_steps(["host-make"]), /forward/)
})
