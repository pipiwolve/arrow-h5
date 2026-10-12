// 验证：上一句还在播、还在等回复时，新一句会打断并独占后续结果。
import assert from 'node:assert/strict';
import { createTurnGate } from './turn-gate.mjs';
import { visibleAgent } from './frames.mjs';

const session = { turnGen: 0 };
function beginTurn() {
  session.turnGen += 1;
  return session.turnGen;
}

const sent = [];
const shown = [];
const spoken = [];
const gate = createTurnGate({
  claim: async () => ({ turnGen: beginTurn() }),
  breakTurn: () => sent.push('[B]'),
});

function acceptText(gen, text) {
  if (gate.stale(gen) || !text) return false;
  shown.push(text);
  return true;
}

function acceptSpeak(gen, frame) {
  if (gate.stale(gen) || !frame) return false;
  spoken.push(frame);
  sent.push(frame);
  return true;
}

const first = await gate.openTurn('room');
assert.equal(first, 1);
assert.equal(sent[0], '[B]');
assert.equal(acceptText(first, '可以下发'), true);

let releaseFirst = null;
const late = new Promise((resolve) => {
  setTimeout(() => {
    const kept = acceptText(first, '请提供 device ID、name 以及 CMD 操作指令');
    const speak = acceptSpeak(first, '[E]:[CMD]:[TEXT]:上一句还在播');
    releaseFirst = gate.release(first);
    resolve({ kept, speak });
  }, 30);
});

const second = await gate.openTurn('room');
assert.equal(second, 2);
assert.equal(sent.filter((f) => f === '[B]').length, 2);
const lateOut = await late;
assert.equal(lateOut.kept, false);
assert.equal(lateOut.speak, false);
assert.equal(releaseFirst, false);
assert.equal(visibleAgent('请提供 device ID、name 以及 CMD 操作指令'), '');

assert.equal(acceptText(second, 'AKB 1357 的产品内容在这里。'), true);
assert.equal(acceptSpeak(second, '[E]:[CMD]:[TEXT]:AKB 1357 的产品内容在这里。'), true);
assert.equal(gate.release(second), true);

const shot = gate.snapshot();
assert.deepEqual(shown, ['可以下发', 'AKB 1357 的产品内容在这里。']);
assert.deepEqual(spoken, ['[E]:[CMD]:[TEXT]:AKB 1357 的产品内容在这里。']);
assert.equal(shot.turnBusy, false);
assert.equal(session.turnGen, 2);

const third = await gate.openTurn('intent');
const during = acceptText(second, '上一句的选择卡说明');
assert.equal(during, false);
assert.equal(acceptText(third, '有多台设备符合，选一台再下发。'), true);
assert.equal(gate.finishLocal(second), false);
assert.equal(gate.finishLocal(third), true);
assert.equal(gate.snapshot().turnBusy, false);
assert.equal(session.turnGen, 3);

const slow = gate.openTurn('room');
assert.equal(gate.stale(third), true);
assert.equal(acceptText(third, '上一句在领新代号时回来了'), false);
const fourth = await slow;
assert.equal(fourth, 4);
assert.equal(acceptText(fourth, '新问题的回答'), true);
assert.equal(gate.release(fourth), true);

console.log('turn-gate ok');
