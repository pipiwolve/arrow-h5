// 各类问题验收。不进 BRTC 房间。
// 设备类走真实闸门和模拟平台；产品、闲聊、连续提问里的房间回答只验路由，不验模型正文。
import assert from 'node:assert/strict';
import { SCENARIO, DEVICES } from '../scenario.mjs';
import { createGate } from './policy.mjs';
import { createTurn } from './turn.mjs';
import { asrUtterance, visibleAgent } from './frames.mjs';
import { topicModel } from './topic.mjs';
import { createTurnGate } from './turn-gate.mjs';

const calls = [];
const turn = createTurn({
  scenario: SCENARIO,
  devices: DEVICES.devices,
  gate: createGate({ scenario: SCENARIO, devices: DEVICES.devices }),
  liveDevices: async () => ({ ok: true, rows: DEVICES.devices }),
  iot: {
    control: async (_home, cmdList) => {
      calls.push(cmdList);
      return {
        ok: true, httpStatus: 200, ms: 4,
        request: { body: cmdList },
        response: { code: 200, success: true, msg: 'OK' },
      };
    },
  },
  audit: { append: async () => {} },
});

const blank = { action: 'device.control', targets: [{ deviceName: '', cmd: '', param: '', value: '' }] };
const rows = [];

function record(kind, input, pass, detail) {
  rows.push({ kind, input, pass, detail });
  assert.equal(pass, true, `${kind} / ${input} / ${detail}`);
}

async function ask(text) {
  return turn.finish({ sessionId: 'hs_accept', userText: text, action: blank });
}

async function pick(finished, text) {
  const card = finished.cards.find((c) => c.event === 'demo.choose');
  assert.ok(card, '应当先出选择卡');
  const name = card.data.choices[0].deviceName;
  const filled = {
    ...card.data.action,
    targets: card.data.action.targets.map((item) => ({ ...item, deviceName: name })),
  };
  return turn.finish({ sessionId: 'hs_accept', userText: text, action: filled });
}

function cmdOf(finished) {
  const result = [...finished.cards].reverse().find((c) => c.event === 'demo.result');
  const target = result?.data?.targets?.[0];
  return target ? `${target.cmd}/${target.value}` : '';
}

const product = 'AKB1357 有哪些功能';
record('产品问答', product, topicModel(product) === '' && !/打开|关闭|冲水|夜灯|报修/.test(product), '留给房间知识库，不进本地指令');

const repair = '我家坐便器不出水了，要报修';
record('报修', repair, /报修|维修/.test(repair) && topicModel(repair) === '', '页面本地出报修卡，不进房间');

const operate = [
  ['大冲', '来个大冲', '01', 'switch_watering/on'],
  ['小冲', '帮我小冲', '01', 'switch_watering_small/on'],
  ['关闭翻盖', '把自动翻盖关掉', '01', 'switch_auto_closing/off'],
  ['关闭夜灯', '别夜灯了', '06', 'switch_night_light/off'],
  ['进水', '进水', '04', 'switch_water_in/on'],
];

for (const [kind, input, category, expect] of operate) {
  const first = await ask(input);
  const choose = first.cards.find((c) => c.event === 'demo.choose');
  const rooms = new Set((choose?.data.choices || []).map((c) => c.category));
  const only = rooms.size === 1 && [...rooms][0] === { '01': '马桶', '04': '浴缸', '06': '镜柜' }[category];
  const after = await pick(first, input);
  if (kind === '进水') {
    const gate = after.cards.find((c) => c.event === 'demo.gate');
    record(kind, input, only && gate?.data.decision === 'confirm' && gate.data.level === 'H' && !after.cards.some((c) => c.event === 'demo.result'), `选择后停在 H 级确认，候选 ${choose.data.choices.length} 台`);
    continue;
  }
  record(kind, input, only && cmdOf(after) === expect && after.cards.some((c) => c.event === 'demo.result' && c.data.result === 'SUCCEEDED'), `${cmdOf(after)}，候选 ${choose.data.choices.length} 台`);
}

const chat = '你好';
record('闲聊', chat, topicModel(chat) === '' && !/打开|关闭|冲|夜灯|翻盖|进水|报修/.test(chat), '留给房间，不进本地指令');

const queue = ['来个大冲', '你好'];
const queueDevice = await ask(queue[0]);
record('连续提问', queue.join('、'), queueDevice.cards[0]?.event === 'demo.choose' && topicModel(queue[1]) === '', '第一句出设备选择，第二句留给房间');

record('语音', '我没有听清，请再说一遍', asrUtterance('我没有听清，请再说一遍') === '', '不进入对话');
record('语音', '来个大冲', asrUtterance('来个大冲') === '来个大冲', '识别结果进入对话');

const chase = '请提供 device ID、name 以及 CMD 操作指令';
record('字段追问', chase, visibleAgent(chase) === '', '不进入对话');

const sent = [];
let gen = 0;
const gate = createTurnGate({
  claim: async () => ({ turnGen: ++gen }),
  breakTurn: () => sent.push('[B]'),
});
const older = await gate.openTurn('room');
const newer = await gate.openTurn('room');
record('打断', '上一句未结束时发送新问题', sent.filter((f) => f === '[B]').length === 2 && gate.stale(older) && !gate.stale(newer), '新一句打断上一句');

const groups = new Map();
for (const row of rows) {
  if (!groups.has(row.kind)) groups.set(row.kind, []);
  groups.get(row.kind).push(row);
}
console.log('accept ok');
for (const [kind, items] of groups) {
  console.log(`${kind}\t${items.every((item) => item.pass) ? '通过' : '未通过'}\t${items.map((item) => item.detail).join('；')}`);
}
