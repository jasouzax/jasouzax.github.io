// Native shell regression: run in the built Linux image, without a Worker or browser.
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { Pty_Channel } = require('../dist/server/src/pty_channel');
const { to_base64, from_base64 } = require('../dist/shared/protocol/codec');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
    let output = '', code;
    const channel = new Pty_Channel({ shim: path.resolve(__dirname, '../assets/pty_shim.py'), buffered: () => 0, send(message) {
        if (message.t === 'pty_out') output += Buffer.from(from_base64(message.data)).toString();
        if (message.t === 'pty_exit') code = message.code;
        if (message.t === 'pty_err') throw new Error(message.message);
        return true;
    } });
    const until = async check => {
        const deadline = Date.now() + 10000;
        while (!check()) { if (Date.now() > deadline) throw new Error('Timed out; PTY output: ' + output); await pause(20); }
    };
    const line = text => output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '').split('\n').includes(text);
    const write = text => channel.handle({ t: 'pty_input', peer: 'test', id: 1, data: to_base64(Buffer.from(text)) });
    try {
        const home = os.homedir(), user = os.userInfo().username, host = os.hostname().split('.')[0];
        assert.equal(user, 'jason'); assert.equal(home, '/home/jason');
        channel.handle({ t: 'pty_open', peer: 'test', id: 1, cols: 100, rows: 30 });
        await until(() => output.includes(`${user}@${host}:${home}$ `));
        write(`printf '<STDOUT:%s>\\n' "$((20+22))"; printf '<STDERR:%s>\\n' "$((21+22))" >&2; read -r reply; printf '<STDIN:%s>\\n' "$reply"; if command -v fastfetch >/dev/null 2>&1; then printf '<FASTFETCH:installed>\\n'; else fastfetch; printf '<FASTFETCH_EXIT:%s>\\n' "$?"; fi\nnative-input\n`);
        await until(() => line('<STDOUT:42>') && line('<STDERR:43>') && line('<STDIN:native-input>'));
        await until(() => line('<FASTFETCH:installed>') || line('<FASTFETCH_EXIT:127>'));
        if (output.includes('<FASTFETCH_EXIT:127>')) assert.match(output, /fastfetch: command not found/);
        output = ''; write('cd /tmp\n');
        await until(() => output.includes(`${user}@${host}:/tmp$ `));
        output = ''; write('sleep 30\n'); await pause(150); write('\x03');
        await until(() => output.includes(`${user}@${host}:/tmp$ `));
        write('exit 7\n'); await until(() => code !== undefined); assert.equal(code, 7);
        console.log('PASS native identity/prompt, stdin, stdout, stderr, command availability, chdir, Ctrl+C and exit status');
    } finally { channel.close_all(); }
}
main().catch(error => { console.error(error); process.exit(1); });
