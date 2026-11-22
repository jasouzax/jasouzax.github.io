// Real Electron regression for manual input into cross-process frames. No external sites.
const { app } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const { Web } = require(path.join(root, 'dist/server/browser/web'));
const { Window_Registry } = require(path.join(root, 'dist/server/browser/windows'));
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'jazu-interaction-')));
app.commandLine.appendSwitch('site-per-process');
Web.keep_alive = true;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
    const deadline = Date.now() + 15000;
    while (!await check()) { assert.ok(Date.now() < deadline, `Timed out: ${label}`); await pause(30); }
}

async function main() {
    await app.whenReady();
    const server = http.createServer((request, response) => {
        response.setHeader('content-type', 'text/html; charset=utf-8');
        if (request.url === '/frame') response.end(`<style>body{margin:20px}button,input{font-size:20px}#scroll{height:80px;overflow:auto;margin-top:15px}#scroll>div{height:600px}</style>
            <label><input id="check" type="checkbox">Embedded checkbox</label><br><button id="start">Start</button><input id="field">
            <div id="drag" style="height:40px;background:lightblue">Drag here</div><div id="scroll"><div>Scrollable content</div></div>
            <script>window.clicks=0;window.trusted=true;document.getElementById('start').onclick=e=>{clicks++;trusted=trusted&&e.isTrusted};window.drags=0;document.getElementById('drag').onpointermove=e=>{if(e.buttons===1)drags++};</script>`);
        else response.end(`<title>Interaction fixture</title><button id="top" style="position:absolute;left:30px;top:30px;width:150px;height:40px" onclick="window.clicked=true">Top button</button>
            <iframe style="position:absolute;left:40px;top:120px;width:500px;height:300px;border:0" src="http://127.0.0.2:${server.address().port}/frame"></iframe>`);
    });
    await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
    const windows = new Window_Registry(root);
    const web = new Web(`http://127.0.0.1:${server.address().port}`);
    windows.track('', web);
    const contents = await web.contents();
    await until(() => contents.mainFrame.frames.some(frame => frame.url.endsWith('/frame')), 'embedded frame');
    const frame = contents.mainFrame.frames.find(frame => frame.url.endsWith('/frame'));
    await until(() => frame.executeJavaScript("Boolean(document.getElementById('field'))"), 'embedded controls');
    assert.notEqual(frame.processId, contents.mainFrame.processId, 'fixture must exercise an out-of-process iframe');
    const click = async (x, y) => {
        for (const action of ['move', 'down', 'up']) await windows.input(1, { kind: 'mouse', action, x, y, button: 'left', clicks: 1 });
    };
    const point = async id => {
        const rect = await frame.executeJavaScript(`(()=>{const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        return { x: 40 + rect.x, y: 120 + rect.y };
    };
    const click_frame = async id => { const p = await point(id); await click(p.x, p.y); };
    await click(100, 50);
    await until(() => contents.executeJavaScript('window.clicked===true'), 'top-level button');
    await click_frame('check');
    await until(() => frame.executeJavaScript("document.getElementById('check').checked"), 'embedded checkbox');
    await click_frame('start');
    await until(() => frame.executeJavaScript('clicks===1&&trusted'), 'trusted embedded button');
    await windows.input(1, { kind: 'key', action: 'down', key: 'Enter' });
    await windows.input(1, { kind: 'key', action: 'up', key: 'Enter' });
    await until(() => frame.executeJavaScript('clicks===2&&trusted'), 'embedded keyboard activation');
    const drag = await point('drag');
    await windows.input(1, { kind: 'mouse', action: 'down', ...drag, button: 'left' });
    await windows.input(1, { kind: 'mouse', action: 'move', x: drag.x + 10, y: drag.y });
    await windows.input(1, { kind: 'mouse', action: 'up', x: drag.x + 10, y: drag.y, button: 'left' });
    await until(() => frame.executeJavaScript('drags>0'), 'embedded dragging');
    await click_frame('field');
    await windows.input(1, { kind: 'text', text: 'manual input' });
    await until(() => frame.executeJavaScript("document.getElementById('field').value==='manual input'"), 'embedded text input');
    const scroll = await point('scroll');
    await windows.input(1, { kind: 'mouse', action: 'wheel', ...scroll, dx: 0, dy: 100 });
    await until(() => frame.executeJavaScript("document.getElementById('scroll').scrollTop>0"), 'embedded scrolling');
    console.log('PASS top-level input, cross-process checkbox/button, trusted clicks, keyboard, drag, text and scrolling');

    const frames = new Set();
    windows.on('frame', id => frames.add(id));
    await windows.devtools(1, true);
    const tools = windows.list()[0].devtools;
    assert.ok(tools, 'DevTools surface exists');
    await windows.watch(1, 800, false);
    await until(() => frames.has(tools.id), 'real DevTools screencast');
    await click_frame('check');
    await until(() => frame.executeJavaScript("!document.getElementById('check').checked"), 'embedded input with DevTools open');
    await until(() => frames.has(1), 'page screencast beside DevTools');
    console.log('PASS DevTools feed and embedded input while DevTools is open');
    await windows.devtools(1, false);
    await web.close();
    server.close();
    app.exit(0);
}
main().catch(error => { console.error(error); app.exit(1); });
setTimeout(() => { console.error('Interaction smoke timeout'); app.exit(2); }, 45000).unref();
