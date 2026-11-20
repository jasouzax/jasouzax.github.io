import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Remote_Input, type Input_Target } from '../src/input.ts';

function fixture() {
    const commands: { method: string; params: Record<string, unknown> }[] = [];
    let attached = false, destroyed = false, focused = 0;
    const target: Input_Target = {
        isDestroyed: () => destroyed,
        focus: () => { focused++; },
        debugger: {
            isAttached: () => attached,
            attach: () => { attached = true; },
            sendCommand: async (method, params) => { commands.push({ method, params }); },
        },
    };
    return { relay: new Remote_Input(), target, commands, destroy: () => { destroyed = true; }, focused: () => focused };
}

test('browser-level mouse dispatch preserves press, drag and release order and button state', async () => {
    const { relay, target, commands } = fixture();
    await Promise.all([
        relay.send(target, { kind: 'mouse', action: 'down', x: 10.4, y: 20.7, button: 'left', modifiers: ['ctrl', 'shift'] }),
        relay.send(target, { kind: 'mouse', action: 'move', x: 50, y: 60 }),
        relay.send(target, { kind: 'mouse', action: 'up', x: 50, y: 60, button: 'left' }),
    ]);
    assert.deepEqual(commands.map(command => command.method), Array(3).fill('Input.dispatchMouseEvent'));
    assert.deepEqual(commands.map(command => [command.params.type, command.params.buttons]), [['mousePressed', 1], ['mouseMoved', 1], ['mouseReleased', 0]]);
    assert.deepEqual([commands[0].params.x, commands[0].params.y, commands[0].params.modifiers], [10, 21, 10]);
    assert.equal(commands[1].params.button, 'left');
});

test('wheel direction, keyboard navigation and text reach Chromium without changing frame focus', async () => {
    const { relay, target, commands } = fixture();
    await relay.send(target, { kind: 'mouse', action: 'wheel', x: 5, y: 6, dx: 4, dy: 120 });
    await relay.send(target, { kind: 'key', action: 'down', key: 'Left', modifiers: ['alt'] });
    await relay.send(target, { kind: 'key', action: 'down', key: 'Enter' });
    await relay.send(target, { kind: 'key', action: 'up', key: 'Enter' });
    await relay.send(target, { kind: 'text', text: 'こんにちは' });
    assert.deepEqual([commands[0].params.deltaX, commands[0].params.deltaY], [4, 120]);
    assert.deepEqual(commands[1], { method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37, modifiers: 1 } });
    assert.equal(commands[2].params.text, '\r');
    assert.equal(commands[3].params.type, 'keyUp');
    assert.deepEqual(commands[4], { method: 'Input.insertText', params: { text: 'こんにちは' } });
});

test('failed dispatch does not block later input, and closed targets receive no commands', async () => {
    const { relay, target, commands, destroy } = fixture();
    const send = target.debugger.sendCommand;
    let first = true;
    target.debugger.sendCommand = async (method, params) => { if (first) { first = false; throw new Error('target changed'); } return send(method, params); };
    await assert.rejects(relay.send(target, { kind: 'text', text: 'first' }), /target changed/);
    await relay.send(target, { kind: 'text', text: 'second' });
    destroy();
    await relay.send(target, { kind: 'text', text: 'closed' });
    assert.deepEqual(commands, [{ method: 'Input.insertText', params: { text: 'second' } }]);
});
