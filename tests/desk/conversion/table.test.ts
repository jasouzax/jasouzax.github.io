import { test } from "node:test"
import assert from "node:assert/strict"
import { parse_table, write_table, table_converters } from "../../../desk/conversion/table.ts"
import { route, execute } from "../../../desk/conversion/graph.ts"
test("tables round-trip delimiters, escaped quotes, multiline fields, Unicode and prototype keys", () => {
    const records = [{ name: 'A, "B"', note: "line1\nline2", unicode: "日本語", ["__proto__"]: "safe" }]
    assert.deepEqual(parse_table(write_table(records, ","), ","), records)
    assert.deepEqual(parse_table("a,b\r\n1,\r\n", ","), [{ a: "1", b: "" }])
    for (const text of ['a,a\n1,2', 'a,b\n1', 'a\n"unfinished', 'a\n"closed"x']) assert.throws(() => parse_table(text, ","))
})
test("CSV to TSV executes through JSON when no direct converter exists", async () => {
    const path = route(table_converters, "text/csv", "text/tab-separated-values")!
    assert.deepEqual(path.map(step => step.id), ["csv-json", "json-tsv"])
    const output = await execute(path, new Blob(['name,note\nAlice,"a,b"\n']), {}, new AbortController().signal)
    assert.equal(output.type, "text/tab-separated-values")
    assert.equal(await output.text(), "name\tnote\r\nAlice\ta,b\r\n")
    assert.throws(() => write_table({ a: 1 }, ","), /array of records/)
})
