/** Lazy public Version menu loading, merge nesting, immutable map, refs and offline snapshot retention. */
import { test, expect } from "./desk_fixture.ts"

test("Version displays merge groups, refs and a read-only graph; failed refresh preserves history", async ({ page }) => {
    const oid = (digit: string) => digit.repeat(40)
    const commits = [
        { id: oid("f"), parents: [oid("d"), oid("e")], timestamp: 1700000040, subject: "Merge feature" },
        { id: oid("d"), parents: [oid("a")], timestamp: 1700000030, subject: "Main change" },
        { id: oid("e"), parents: [oid("a")], timestamp: 1700000020, subject: "Feature change" },
        { id: oid("a"), parents: [], timestamp: 1700000010, subject: "Initial" },
    ]
    let requests = 0, offline = false
    await page.route('https://repo.jasouza.com/stesis/_/**', async route => {
        requests++
        const url = new URL(route.request().url())
        const headers = { 'access-control-allow-origin': '*' }
        if (offline) return route.fulfill({ status: 503, headers, json: { error: { code: 'offline' } } })
        if (url.pathname.endsWith('/refs')) return route.fulfill({ headers, json: { refs: [
            { name: 'refs/heads/main', hash: oid('f'), commit: oid('f') },
            { name: 'refs/heads/feature', hash: oid('e'), commit: oid('e') },
            { name: 'refs/tags/v1', hash: oid('b'), commit: oid('f') },
        ] } })
        return route.fulfill({ headers, json: { commits: url.searchParams.get('ref') === oid('e') ? commits.slice(2) : commits } })
    })
    await page.goto('/projects/stesis')
    expect(requests).toBe(0)
    const toggle = page.locator('#head_menu')
    if (!(await toggle.getAttribute('open') !== null)) await toggle.locator(':scope > summary').click()
    await page.locator('.desk_side_tabs_drop > summary').filter({ hasText: /Version$/ }).click()
    const panel = page.locator('.desk_side_page[data-version-url]'), options = page.locator('.version_tools')
    await expect(panel.locator('.version_entries > .desk_side_item')).toHaveCount(3)
    await expect(panel.locator('.version_entries > .desk_side_item').first().locator('.desk_side_item_sub .desk_side_item_name')).toHaveText('Feature change')
    await expect(options.getByLabel('Branch or tag')).toBeVisible()
    await page.locator('.desk_side_mode').click()
    const node = page.locator(`[data-map-id="${oid('f')}"]`)
    await expect(node).toHaveCSS('left', '30px')
    await node.locator('a').focus(); await page.keyboard.press('Shift+ArrowRight')
    await expect(node).toHaveCSS('left', '30px')
    await expect(node).toContainText('v1')
    await page.locator('.desk_side_mode').click()
    await options.getByLabel('Branch or tag').selectOption('refs/heads/feature')
    await expect(panel.locator('.version_entries > .desk_side_item')).toHaveCount(2)
    offline = true
    await options.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(options.getByRole('status')).toContainText('unavailable')
    await expect(panel.locator('.version_entries > .desk_side_item')).toHaveCount(2)
})
