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
    querySelectorAll() { return []; },
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === '.bubble.user') {
        return this.children.filter((node) => String(node.className || '').includes('bubble user'));
      }
      return [];
    },
    remove() {
      const list = el('stream').children;
      const at = list.indexOf(this);
      if (at >= 0) list.splice(at, 1);
    },
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
  if (path === '/api/frame') {
    return { parsed: { kind: 'agent', text: body.finalText || '', partial: false }, cards: [] };
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
    isSecureContext: true,
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
vm.runInContext(appSrc + '\nglobalThis.__sendText = sendText;\nglobalThis.__startHold = startHold;\nglobalThis.__stopHold = stopHold;\nglobalThis.__finishDictation = finishDictation;\nglobalThis.__onAgentFrame = onAgentFrame;\nglobalThis.__session = () => { sessionId = "hs_test"; licPassed = true; };', context);
context.__session();

function nodeText(node) {
  const textNode = node.children?.find((child) => child.className === 'text');
  const own = textNode ? textNode.textContent : node.textContent;
  const nested = (node.children || []).map(nodeText).filter(Boolean).join(' ');
  return [own, nested].filter(Boolean).join(' ');
}

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

el('stream').children.length = 0;
sent.length = 0;
await context.__sendText('AKB1357对水压和进水温度有什么要求？');
assert.ok(sent.includes('[T]:AKB1357对水压和进水温度有什么要求？'), sent.join(' | '));
assert.equal(agentLines().some((line) => line.includes('选一台')), false);

el('stream').children.length = 0;
sent.length = 0;
await context.__sendText('三款的额定功率分别是多少？');
assert.ok(sent.includes('[T]:三款的额定功率分别是多少？'), sent.join(' | '));
assert.equal(agentLines().some((line) => line.includes('选一台')), false);

for (const ask of [
  'FLM0814S-Q落座超过1分钟，灵动智慧冲会大冲还是小冲？',
  'NiL125做完妇洗后离座，自动冲水是大冲还是小冲？',
  'NiL125自动冲水关掉之后，到底冲不冲水？',
]) {
  el('stream').children.length = 0;
  sent.length = 0;
  await context.__sendText(ask);
  assert.ok(sent.includes(`[T]:${ask}`), sent.join(' | '));
  assert.equal(agentLines().some((line) => line.includes('选一台')), false, ask);
}

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
const savedApi = context.__api;
context.__api = async (path, opts) => {
  if (path === '/api/choose') {
    clicks.push(path);
    return { cards: [] };
  }
  return savedApi(path, opts);
};
const one = button.onclick();
const two = button.onclick();
await Promise.all([one, two]);
assert.equal(clicks.length, 1, clicks.join('\n'));
assert.equal(card.dataset.sent, '1');
context.__api = savedApi;

// 本地意图还在等设备结果时，下一句报修仍要出卡和播报，不能被标成房间句后丢掉。
el('stream').children.length = 0;
sent.length = 0;
claimDelay = 80;
const flushing = context.__sendText('大冲');
await new Promise((resolve) => setTimeout(resolve, 30));
await context.__sendText('我家坐便器不出水了，要报修');
await flushing;
const after = el('stream').children.map((node) => `${node.className}:${nodeText(node)}`).join(' || ');
assert.ok(after.includes('已准备好报修入口'), after);
assert.ok(after.includes('打开报修页'), after);
assert.equal(after.includes('查看报修进度'), false);
assert.ok(sent.some((frame) => frame.includes('[E]:[CMD]:[TEXT]:已准备好报修入口')), sent.join(' | '));

el('stream').children.length = 0;
sent.length = 0;
await context.__sendText('查一下报修进度');
const progress = el('stream').children.map((node) => `${node.className}:${nodeText(node)}`).join(' || ');
assert.ok(progress.includes('已准备好进度入口'), progress);
assert.ok(progress.includes('查看报修进度'), progress);
assert.equal(progress.includes('打开报修页'), false);

// 本地卡片结束后再问产品，必须把原话送进房间。卡片不能先发打断帧。
for (const [cardAsk, follow] of [
  ['我家坐便器不出水了，要报修', 'AKB1357有哪些功能'],
  ['查一下报修进度', 'AKB1357保修几年'],
  ['大冲', 'AKB1357有哪些功能'],
]) {
  el('stream').children.length = 0;
  sent.length = 0;
  claimDelay = 0;
  await context.__sendText(cardAsk);
  await context.__sendText(follow);
  const spokenAt = sent.findIndex((frame) => frame.startsWith('[E]:[CMD]:[TEXT]:'));
  const askedAt = sent.indexOf(`[T]:${follow}`);
  assert.ok(askedAt > spokenAt, `${cardAsk} -> ${sent.join(' | ')}`);
  assert.equal(sent.slice(spokenAt + 1, askedAt).includes('[B]'), false, sent.join(' | '));
  assert.ok(users().includes(follow));
  await context.__onAgentFrame({ data: `[Q]:[M]:${follow.slice(0, 2)}` });
  await context.__onAgentFrame({ data: `[Q]:用户：${follow}` });
  await context.__onAgentFrame({ data: '[A]:说明书里的回答' });
  assert.equal(sent.filter((frame) => frame === `[T]:${follow}`).length, 1, sent.join(' | '));
  assert.equal(users().filter((line) => line === follow).length, 1, users().join(' | '));
  assert.ok(agentLines().includes('说明书里的回答'), agentLines().join(' | '));
}

// 进度卡的播报尾巴晚于下一句到达。空的 [A] 不能再发 [B]，否则房间里的下一句被打断。
el('stream').children.length = 0;
sent.length = 0;
claimDelay = 0;
await context.__sendText('查一下报修进度');
await context.__sendText('AKB1357有哪些功能');
const beforeTail = sent.length;
await context.__onAgentFrame({ data: '[A]:' });
assert.equal(sent.slice(beforeTail).includes('[B]'), false, sent.join(' | '));
assert.equal(sent.filter((frame) => frame === '[T]:AKB1357有哪些功能').length, 1, sent.join(' | '));
await context.__onAgentFrame({ data: '[A]:说明书里的功能' });
assert.ok(agentLines().includes('说明书里的功能'), agentLines().join(' | '));

el('stream').children.length = 0;
sent.length = 0;
await context.__sendText('我要保修');
const warranty = el('stream').children.map((node) => `${node.className}:${nodeText(node)}`).join(' || ');
assert.ok(warranty.includes('已准备好报修入口'), warranty);
assert.ok(warranty.includes('打开报修页'), warranty);
assert.equal(sent.includes('[T]:我要保修'), false, sent.join(' | '));
el('stream').children.length = 0;
sent.length = 0;
await context.__sendText('我马桶坏了');
const broken = el('stream').children.map((node) => `${node.className}:${nodeText(node)}`).join(' || ');
assert.ok(broken.includes('打开报修页'), broken);
assert.equal(sent.includes('[T]:我马桶坏了'), false, sent.join(' | '));
el('stream').children.length = 0;
sent.length = 0;
await context.__sendText('AKB1357保修几年');
assert.ok(sent.includes('[T]:AKB1357保修几年'), sent.join(' | '));
assert.equal(agentLines().some((line) => line.includes('报修入口')), false);
el('stream').children.length = 0;
sent.length = 0;
await context.__sendText('1357滤芯坏了算不算保修，一般多久得换一次');
assert.ok(sent.includes('[T]:1357滤芯坏了算不算保修，一般多久得换一次'), sent.join(' | '));
assert.equal(agentLines().some((line) => line.includes('报修入口')), false);
el('stream').children.length = 0;
sent.length = 0;
await context.__sendText('AKB1357喷枪不出水先查什么？');
assert.ok(sent.includes('[T]:AKB1357喷枪不出水先查什么？'), sent.join(' | '));
assert.equal(agentLines().some((line) => line.includes('报修入口')), false);
el('stream').children.length = 0;
sent.length = 0;
await context.__sendText('AKB1357整机保修几年？客服电话是多少？');
assert.ok(sent.includes('[T]:AKB1357整机保修几年？客服电话是多少？'), sent.join(' | '));
assert.equal(agentLines().some((line) => line.includes('报修入口')), false);
el('stream').children.length = 0;
sent.length = 0;
await context.__sendText('NiL125自动冲水关掉之后，到底冲不冲水？');
assert.ok(sent.includes('[T]:NiL125自动冲水关掉之后，到底冲不冲水？'), sent.join(' | '));
assert.equal(agentLines().some((line) => line.includes('选择设备')), false);

el('stream').children.length = 0;
await context.__onAgentFrame({ data: '[A]:[M]:正在处理。' });
await context.__onAgentFrame({ data: '[A]:您好，我是箭牌智家助手。请问有什么可以帮您？' });
assert.equal(agentLines().includes('正在处理。'), false, agentLines().join(' | '));
assert.ok(agentLines().some((line) => line.includes('请问有什么可以帮您')), agentLines().join(' | '));

// 按住期间识别结果已经发出时，松手不能再把「识别中」盖回去。
el('stream').children.length = 0;
el('composerNote').textContent = '';
el('composerNote').hidden = true;
claimDelay = 0;
context.__startHold();
context.__finishDictation('关掉马桶的夜灯。');
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(el('composerNote').hidden, true, el('composerNote').textContent);
context.__stopHold();
assert.equal(el('composerNote').hidden, true);
assert.equal(el('composerNote').textContent, '');
assert.ok(users().includes('关掉马桶的夜灯。'), users().join(' | '));
assert.ok(agentLines().includes('有多台设备符合，选一台再下发。'), agentLines().join(' | '));
assert.equal(agentLines().includes('正在确认设备…'), false, agentLines().join(' | '));

// 房间最终识别句晚于松手到达，也要进入设备确认，不能只留一条用户气泡。
await context.__onAgentFrame({ data: '[Q]:关掉马桶的夜灯。' });
el('stream').children.length = 0;
await context.__onAgentFrame({ data: '[Q]:关掉马桶的夜灯。' });
assert.deepEqual(users(), ['关掉马桶的夜灯。']);
assert.ok(agentLines().includes('有多台设备符合，选一台再下发。'), agentLines().join(' | '));
assert.equal(el('stream').children.some((node) => String(node.className).includes('choose')), true);

// 领代号被下一句作废后，这句设备确认的失败也要留在对话里。
el('stream').children.length = 0;
let releaseClaim = null;
let intentCalls = 0;
const savedFail = context.__api;
context.__api = async (path, opts) => {
  if (path === '/api/turn') {
    if (!releaseClaim) {
      return new Promise((resolve) => {
        releaseClaim = () => resolve({ turnGen: 7 });
      });
    }
    return { turnGen: 8 };
  }
  if (path === '/api/intent') {
    intentCalls += 1;
    throw new Error('设备列表没有取到');
  }
  return savedFail(path, opts);
};
const hung = context.__sendText('关掉马桶的夜灯。');
await new Promise((resolve) => setTimeout(resolve, 10));
const next = context.__sendText('现在几点');
await new Promise((resolve) => setTimeout(resolve, 10));
releaseClaim();
await Promise.all([hung, next]);
assert.equal(intentCalls, 1);
assert.ok(agentLines().some((line) => line.includes('设备列表没有取到')), agentLines().join(' | '));
assert.equal(agentLines().includes('正在确认设备…'), false, agentLines().join(' | '));
context.__api = savedFail;

// 识别中间结果先出用户气泡，最终句再替换并进入设备确认。
el('stream').children.length = 0;
claimDelay = 0;
context.__startHold();
await context.__onAgentFrame({ data: '[Q]:[M]关掉马桶' });
assert.deepEqual(users(), ['关掉马桶']);
await context.__onAgentFrame({ data: '[Q]:关掉马桶的夜灯。' });
assert.deepEqual(users(), ['关掉马桶的夜灯。']);
assert.ok(agentLines().includes('有多台设备符合，选一台再下发。'), agentLines().join(' | '));

// 设备确认的占位在领代号之前就出现。
el('stream').children.length = 0;
claimDelay = 80;
const early = context.__sendText('关掉马桶的夜灯。');
await new Promise((resolve) => setTimeout(resolve, 10));
assert.ok(agentLines().includes('正在确认设备…'), agentLines().join(' | '));
await early;
assert.ok(agentLines().includes('有多台设备符合，选一台再下发。'), agentLines().join(' | '));
assert.equal(agentLines().includes('正在确认设备…'), false);

// 本机接手后，房间的 control_device 得到不播报的结果。
sent.length = 0;
await context.__onAgentFrame({
  data: '[F]:' + JSON.stringify({
    session_id: 'room-1',
    content: JSON.stringify({ function_name: 'control_device', parameter_list: [{}] }),
  }),
});
assert.equal(sent.length, 1, sent.join(' | '));
assert.equal(sent[0].includes('"result":"ok"'), true);
assert.equal(sent[0].includes('post_function'), false);
assert.equal(sent[0].includes('room-1'), true);

console.log('send-text ok');
