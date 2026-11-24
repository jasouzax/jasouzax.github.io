import { test } from "node:test"
import assert from "node:assert/strict"
import * as tools from "pdf-lib"
import { page_indices, transform_pdf } from "../../../desk/conversion/pdf.ts"
test("PDF page ranges reorder, reverse, duplicate, and reject invalid pages", () => {
    assert.deepEqual(page_indices("3,1-2,2", 3), [2, 0, 1, 1])
    assert.deepEqual(page_indices("3-1", 3), [2, 1, 0])
    for (const input of ["0", "4", "1,,2", "1.5", "-1"]) assert.throws(() => page_indices(input, 3))
})
test("PDF extraction produces selected native pages in requested order", async () => {
    const source = await tools.PDFDocument.create()
    source.addPage([100, 200]); source.addPage([300, 400]); source.addPage([500, 600])
    const file = new Blob([new Uint8Array(await source.save())], { type: "application/pdf" })
    const output = await transform_pdf(file, { pdf_pages: "3,1" }, new AbortController().signal, tools)
    const loaded = await tools.PDFDocument.load(await output.arrayBuffer())
    assert.deepEqual(loaded.getPages().map(page => page.getSize()), [{ width: 500, height: 600 }, { width: 100, height: 200 }])
    assert.equal((await tools.PDFDocument.load(await file.arrayBuffer())).getPageCount(), 3)
})
