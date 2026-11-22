/* Authoring contracts reject retired vocabulary before it reaches rendering or server catalogs. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { parse_xml } from "../../shared/content/xml.ts"
import { validate_roots } from "../../shared/content/schema.ts"
import { new_diagnostics } from "../../shared/diag.ts"

function errors(xml: string): string[] {
    const diag = new_diagnostics()
    validate_roots(parse_xml(xml, "schema.xml"), diag)
    return diag.errors
}

test("skills and stacks are independent vocabulary entries", () => {
    assert.deepEqual(errors('<page path="/" name="Home"><expertise><skill id="web" name="Web" group="Software"/><stack id="ts" name="TypeScript"/></expertise></page>'), [])
    for (const attribute of ['info="old"', 'stack="ts"']) assert(errors(`<page path="/" name="Home"><expertise><skill name="Web" ${attribute}/></expertise></page>`).some(error => error.includes("unknown attribute")))
    assert(errors('<page path="/" name="Home"><expertise><skill name="Web"><stack name="TS"/></skill></expertise></page>').some(error => error.includes("not allowed")))
    for (const attribute of ['link="https://example.com"', 'tag="TS"', 'icon="[web]"']) assert(errors(`<page path="/" name="Home"><expertise><stack name="TS" ${attribute}/></expertise></page>`).some(error => error.includes("unknown attribute")))
})

test("slides use featured_stack and inherit privacy from their project", () => {
    assert.deepEqual(errors('<project id="example" name="Example" date="2026" private><slide skill="web" info="Example" stack="ts,css" featured_stack="ts"/></project>'), [])
    for (const attribute of ['feature_stack="ts"', 'description="old"', 'private="true"']) assert(errors(`<project id="example" name="Example" date="2026"><slide skill="web" ${attribute}/></project>`).some(error => error.includes("unknown attribute")))
})

test("research uses similar and history wording comes from event dates", () => {
    assert.deepEqual(errors('<project id="example" name="Example" date="2026"><research><similar><point name="Prior art"/></similar></research></project>'), [])
    assert(errors('<project id="example" name="Example" date="2026"><research><literature_review/></research></project>').some(error => error.includes("unknown element")))
    for (const attribute of ['resume_start="old"', 'resume_end="old"']) assert(errors(`<event id="example" name="Example" date="2026" ${attribute}/>`).some(error => error.includes("unknown attribute")))
})

test("retired page tags cannot silently discard authored content", () => {
    for (const tag of ["landing", "contact", "error", "resume"]) assert(errors(`<page path="/" name="Home"><${tag}/></page>`).some(error => error.includes(`unknown element <${tag}>`)))
})
