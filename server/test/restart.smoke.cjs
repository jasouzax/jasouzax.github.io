// Verify a killed process resumes saved scripts, and a manual Stop survives another boot.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { once, EventEmitter } = require('node:events');
const { Script_Runner } = require('../dist/server/src/runner');
const { Auto_Start } = require('../dist/server/src/autostart');
const { Api_Registry } = require('../dist/server/src/api');

async function child(folder) {
    const script = path.join(folder, 'service.auto.js');
    const first = !fs.existsSync(path.join(folder, 'initialized'));
    const runner = new Script_Runner({ root: path.resolve(__dirname, '..'), read_source: file => fs.promises.readFile(file, 'utf8'), web_class: EventEmitter, apis: new Api_Registry(), autostart: new Auto_Start(path.join(folder, 'autostart.json')) });
    if (first) { fs.writeFileSync(path.join(folder, 'initialized'), ''); await runner.start(script); }
    else await runner.restore();
    setInterval(() => {}, 1000);
    process.on('message', async message => { if (message === 'stop') { await runner.stop(script); process.send('stopped'); } });
    process.send({ running: runner.is_running(script) });
}
async function main() {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jazu-crash-'));
    const children = [];
    const script = path.join(folder, 'service.auto.js');
    const marker = path.join(folder, 'starts');
    fs.writeFileSync(script, `require('node:fs').appendFileSync(${JSON.stringify(marker)}, 'started\\n'); setInterval(() => {}, 100000);`);
    const boot = async () => {
        const process = fork(__filename, ['child', folder], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
        children.push(process);
        const [ready] = await once(process, 'message', { signal: AbortSignal.timeout(15000) });
        return { process, ready };
    };
    const kill = async process => { const exited = once(process, 'exit'); process.kill('SIGKILL'); await exited; };
    try {
        const first = await boot(); assert.equal(first.ready.running, true); await kill(first.process);
        const second = await boot(); assert.equal(second.ready.running, true);
        assert.equal(fs.readFileSync(marker, 'utf8'), 'started\nstarted\n');
        const stopped = once(second.process, 'message', { signal: AbortSignal.timeout(15000) }); second.process.send('stop');
        assert.equal((await stopped)[0], 'stopped');
        await kill(second.process);
        const third = await boot(); assert.equal(third.ready.running, false);
        assert.equal(fs.readFileSync(marker, 'utf8'), 'started\nstarted\n');
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, 'autostart.json'), 'utf8')).scripts, []);
        await kill(third.process);
        console.log('PASS: process crash restored the script; manual Stop survived the next boot');
    } finally { for (const process of children) if (process.exitCode === null && process.signalCode === null) process.kill('SIGKILL'); fs.rmSync(folder, { recursive: true, force: true }); }
}
(process.argv[2] === 'child' ? child(process.argv[3]) : main()).catch(error => { console.error(error); process.exit(1); });
