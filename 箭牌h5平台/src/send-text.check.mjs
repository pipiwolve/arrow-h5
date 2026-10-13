// 复现：上一轮还忙时只发 [B]，新句子不会成为新的一轮。
// 期望：本地意图已结束等待时，新句子立刻进入对话。
// 房间还在领代号时，新句子排队，领完后再单独发送。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sent = [];
const apiLog = [];
let turnGen = 0;
let claimDelay = 0;
const elements = new Map();

function makeEl(id) {
  return {
    id,
    hidden: false,
    disabled: false,
    textContent: '',
    value: '',
    className: '',
    dataset: {},
    style: {},
    children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    append(...nodes) { this.children.push(...nodes); },
    querySelector() { return null; },
    querySelectorAll: () => [],
    remove() {},
    scrollIntoView() {},
    addEventListener() {},
  };
}

function el(id) {
  if (!elements.has(id)) elements.set(id, makeEl(id));
  return elements.get(id);
}

const documentStub = {
  getElementById: el,
  createElement(tag) {
    return makeEl(tag);
  },
  body: { dataset: {} },
  addEventListener() {},
  querySelectorAll: () => [],
  documentElement: { style: { setProperty() {} } },
};

const api = async (path, opts) => {
  apiLog.push(path);
  const body = opts?.body ? JSON.parse(opts.body) : {};
  if (path === '/api/turn') {
    if (claimDelay) await new Promise((resolve) => setTimeout(resolve, claimDelay));
    turnGen += 1;
    return { turnGen };
  }
  if (path === '/api/intent') {
    return {
      say: '有多台设备符合，选一台再下发。',
      cards: [{
        event: 'demo.choose',
        data: {
          choiceId: 'ch_test',
          say: '有多台设备符合，选一台再下发。',
          action: body,
          choices: [{ room: '主卫', deviceTagName: '坐便器', deviceName: 'A' }],
        },
      }],
    };
  }
  if (path === '/api/config') return { ready: false, missing: [] };
  return {};
};

const context = {
  console,
  setTimeout,
  clearTimeout,
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  document: documentStub,
  window: {
    BRTC_SendMessageToUser: (frame) => sent.push(frame),
    innerWidth: 1200,
    addEventListener() {},
    visualViewport: null,
  },
  MutationObserver: class { observe() {} },
  __api: api,
};
vm.createContext(context);

const gateSrc = fs.readFileSync(new URL('../public/turn-gate.js', import.meta.url), 'utf8')
  .replace('export { createTurnGate };', 'globalThis.createTurnGate = createTurnGate;');
const appSrc = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
  .replace("import { createTurnGate } from './turn-gate.js';", '')
  .replace('async function api(path, opts) {', 'async function api(path, opts) { return globalThis.__api(path, opts); /*')
  .replace('  return data;\n}', '  return data;\n*/ }')
  .replace("api('/api/config').then((cfg) => {", 'Promise.resolve({ ready: false, missing: [] }).then((cfg) => {');
context.createTurnGate = null;
vm.runInContext(gateSrc, context);
vm.runInContext(appSrc + '\nglobalThis.__sendText = sendText;\nglobalThis.__session = () => { sessionId = "hs_test"; licPassed = true; };', context);
context.__session();

function users() {
  return el('stream').children.flatMap((node) => {
    if (!String(node.className || '').includes('bubble user')) return [];
    const textNode = node.children?.find((child) => child.className === 'text');
    return [textNode ? textNode.textContent : node.textContent];
  });
}

function agentLines() {
  return el('stream').children.flatMap((node) => {
    if (!String(node.className || '').includes('bubble agent')) return [];
    const textNode = node.children?.find((child) => child.className === 'text');
    return [textNode ? textNode.textContent : node.textContent];
  });
}

await context.__sendText('大冲');
assert.deepEqual(users(), ['大冲']);
assert.ok(agentLines().includes('有多台设备符合，选一台再下发。'));
assert.equal(el('stream').children.some((node) => String(node.className).includes('choose')), true);

await context.__sendText('AKB1357有哪些功能');
assert.deepEqual(users(), ['大冲', 'AKB1357有哪些功能']);
assert.ok(sent.includes('[T]:AKB1357有哪些功能'), sent.join(' | '));
assert.equal(el('stream').children.some((node) => String(node.className).includes('choose')), true);

// 房间还在领代号时，第二句不能丢，要在第一句领完后单独发出。
el('stream').children.length = 0;
sent.length = 0;
claimDelay = 40;
const first = context.__sendText('深圳明天天气');
await new Promise((resolve) => setTimeout(resolve, 5));
const second = context.__sendText('现在几点');
await Promise.all([first, second]);
const dump = el('stream').children.map((node) => `${node.className}:${node.textContent}`).join(' || ');
assert.deepEqual(users(), ['深圳明天天气', '现在几点'], dump + ' SENT ' + sent.join(' | '));
assert.equal(sent.includes('[T]:深圳明天天气'), false);
assert.ok(sent.includes('[T]:现在几点'), sent.join(' | '));

el('stream').children.length = 0;
await context.__sendText('大冲');
const card = [...el('stream').children].reverse().find((node) => String(node.className).includes('choose'));
assert.ok(card, el('stream').children.map((node) => node.className).join(','));
const button = card.children.flatMap((node) => node.children || []).find((node) => node.tag === 'button' || node.textContent === '主卫 坐便器');
assert.equal(card.dataset.choiceId, 'ch_test');
assert.equal(typeof button.onclick, 'function');
const clicks = [];
context.__api = async (path, opts) => {
  clicks.push(path + (opts?.body || ''));
  return { cards: [] };
};
const one = button.onclick();
const two = button.onclick();
await Promise.all([one, two]);
assert.equal(clicks.length, 1, clicks.join('\n'));
assert.equal(card.dataset.sent, '1');

console.log('send-text ok');
