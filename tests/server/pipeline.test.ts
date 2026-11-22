/* Nested log points and continued failures retain observable results without launching empty commands. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { parse_xml } from "../../shared/content/xml.ts"
import { parse_pipeline } from "../../shared/content/pipeline.ts"
import { run_command } from "../../server/pipeline/process.ts"

test("nested pipeline steps flatten in author order and log points run without an executable", async () => {
    const node = parse_xml('<pipeline><step name="group"><step name="check" command="node" args=\'["-e","process.exit(3)"]\' continue="true"/></step><step name="done"/></pipeline>', "fixture.xml")[0]
    const pipeline = parse_pipeline(node)
    assert.deepEqual(pipeline.steps.map(step => step.name), ["group", "check", "done"])
    let log = ""
    const result = await run_command(pipeline.steps[0], process.cwd(), {}, text => { log += text })
    assert(result.result.ok)
    assert.match(log, /group/)
    assert.equal(pipeline.steps[1].continue, true)
    assert.throws(() => parse_pipeline(parse_xml('<pipeline><step name="bad" args="[]"/></pipeline>', "fixture.xml")[0]), /require command/)
    assert.throws(() => parse_pipeline(parse_xml('<pipeline poll_seconds="60"/>', "fixture.xml")[0]), /removed/)
})
