import { test } from "node:test"
import assert from "node:assert/strict"
import { image_dimensions } from "../../../desk/conversion/image.ts"
test("image sizes preserve ratio for one dimension and enforce allocation limits", () => {
    assert.deepEqual(image_dimensions(100, 50, { image_width: "200", image_rotation: "-90" }), { width: 200, height: 100, rotation: 270, quality: .92 })
    assert.throws(() => image_dimensions(10000, 10000, {}), /megapixels/)
    assert.throws(() => image_dimensions(100, 50, { image_width: "NaN" }), /Invalid/)
    assert.throws(() => image_dimensions(100, 50, { image_rotation: "45" }), /Invalid/)
})
