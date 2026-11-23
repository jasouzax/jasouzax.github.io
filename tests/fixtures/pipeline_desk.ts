/* Compile under the engine's tsx loader; Playwright's transformer does not preserve its JSX factory imports. */
import { parse_xml } from "../../shared/content/xml.ts"
import { load_config } from "../../shared/config.ts"
import { new_diagnostics } from "../../shared/diag.ts"
import { expand_objects } from "../../engine/tags/objects.ts"
import { render_desk } from "../../engine/tags/desk.tsx"
import type { site_model } from "../../engine/load/model.ts"
import { to_html } from "../../shared/vnode/vnode.tsx"
import { icon_map } from "../../engine/style/icons.ts"

const config = await load_config(process.cwd())
const model = { config, diag: new_diagnostics(), root: process.cwd(), pages: [], resources: new Map(), icons: { start: "E000", icons: icon_map(config.icons) }, objects: parse_xml(`<project id="example" name="Example" date="2026" lang="en">
    <window type="text/plain" data="Outside pipeline" view/>
    <pipeline branch="staging"><step name="Private step" command="private-executable"/>
        <menu name="Build docs"><entry name="Authored entry" data="Published description"/></menu>
        <window type="text/plain" data="Inline pipeline draft" edit/>
        <window split="1" edit/>
        <action text="Build reference" link="https://example.com/build"/>
    </pipeline></project>`, "fixture.xml") } as unknown as site_model
expand_objects(model)
const page = model.pages.find(page => page.path === "/projects/example")!
process.stdout.write(to_html(render_desk({ model, page, lang: "en", expertise: null }, page.node.children[0])))
