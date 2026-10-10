// 不连 BRTC、不连真实 IoT 的模块自测。验闸门、字幕摘动作、授权帧拼接。
import assert from 'node:assert/strict';
import { SCENARIO, DEVICES } from '../scenario.mjs';
import { createGate } from './policy.mjs';
import { actionFromCall, extractAction, classifyFrame, functionResultFrame, parseFunction } from './frames.mjs';
import { buildRole, userEcho, visibleReply } from './roster.mjs';
import { completeItem, narrowDevices } from './resolve.mjs';
import { agentConfig, licActiveFrame } from './aiagent.mjs';
import { createTurn } from './turn.mjs';

const gate = createGate({ scenario: SCENARIO, devices: DEVICES.devices });

const night = gate.evaluate({
  action: 'device.control',
  targets: [{ deviceName: 'ARROW0617696743520408', cmd: 'switch_night_light', param: 'switch', value: 'on' }],
});
assert.equal(night.decision, 'allow');
assert.equal(night.level, 'M');

const valve = gate.evaluate({
  action: 'device.control',
  targets: [{ deviceName: 'ARROW0417663939524510', cmd: 'switch_water_in', param: 'switch', value: 'on' }],
}, { dryRun: true });
assert.equal(valve.decision, 'confirm');
assert.equal(valve.level, 'H');

const unknown = gate.evaluate({ action: 'device.delete', targets: [] });
assert.equal(unknown.decision, 'deny');

const sample = '好，准备打开夜灯。\n```iot\n{"action":"device.control","targets":[{"deviceName":"ARROW0617696743520408","cmd":"switch_night_light","param":"switch","value":"on"}],"say":"打开夜灯"}\n```';
const picked = extractAction(sample);
assert.equal(picked.action.action, 'device.control');
assert.equal(picked.clean.includes('iot'), false);

const bare = extractAction('请确认。\n{"action":"device.control","targets":[{"deviceName":"ARROW01179421020631","cmd":"switch_watering","param":"switch","value":"on"}],"say":"准备冲水"}');
assert.equal(bare.action.targets[0].deviceName, 'ARROW01179421020631');
assert.equal(bare.clean.includes('action'), false);
assert.equal(bare.clean, '请确认。');

assert.equal(classifyFrame('[E]:[LIC]:[MUST]:x').kind, 'lic-must');
assert.equal(classifyFrame('[A]:[M]:你好').partial, true);
assert.equal(classifyFrame('[A]:你好').kind, 'agent');

const frame = licActiveFrame({ devId: 'DEVID-ARROW-H5-0001', licKey: 'LIC-TEST', uid: '42' });
assert.equal(frame.startsWith('[E]:[LIC]:[ACTIVE]:'), true);
const body = JSON.parse(frame.slice('[E]:[LIC]:[ACTIVE]:'.length));
assert.equal(body.devId, 'DEVID-ARROW-H5-0001');
assert.equal(body.licKey, 'LIC-TEST');
assert.equal(body.uId, '42');

const calls = [];
const turn = createTurn({
  scenario: SCENARIO,
  devices: DEVICES.devices,
  gate,
  iot: { control: async (_home, cmdList) => { calls.push(cmdList); return { ok: true, httpStatus: 200, ms: 3, request: { body: cmdList }, response: { code: 200, success: true } }; } },
  audit: { append: async () => {} },
});
const done = await turn.finish({
  sessionId: 'hs_test',
  action: picked.action,
});
assert.equal(done.cards[0].event, 'demo.gate');
assert.equal(done.cards[1].event, 'demo.result');
assert.equal(calls.length, 1);
assert.equal(calls[0][0].cmd, 'switch_night_light');

const role = buildRole({
  scenario: SCENARIO,
  devices: DEVICES.devices,
  live: { ok: true, rows: [{ deviceName: 'ARROW0617696743520408', deviceTagName: 'QN-PRO智能镜柜', categoryCode: '06', onlineStatus: 1 }] },
});
assert.equal(role.includes('ARROW0617696743520408'), true);
assert.equal(role.includes('主卫'), true);
assert.equal(role.includes('switch_night_light'), true);
assert.equal(role.includes('【家庭设备】'), true);
assert.equal(role.includes('不要把这段清单'), true);
const echoed = '把主卫的浴缸进水打开\n【家庭设备】deviceName、cmd、param、value 必须逐字使用。\n- 客卫 马桶 离线\nswitch_watering,switch_night_light';
assert.equal(visibleReply(echoed, '把主卫的浴缸进水打开'), '');
assert.equal(visibleReply('把主卫的浴缸进水打开 【家庭', '把主卫的浴缸进水打开'), '把主卫的浴缸进水打开 【家庭');
assert.equal(
  visibleReply('主卫没有在线的浴缸，这一次没有下发。\n【家庭设备】后面是清单', '把主卫的浴缸进水打开'),
  '主卫没有在线的浴缸，这一次没有下发。',
);
assert.equal(visibleReply('好，准备打开夜灯。', '把夜灯打开'), '好，准备打开夜灯。');

const replay = '把主卫的浴缸进水打开\n【家庭设备】下面是本轮设备事实。\n- 客卫 马桶 ARROWToilet17332949200780 离线\nswitch_watering,switch_night_light';
const matched = userEcho(replay, '把主卫的浴缸进水打开');
assert.equal(matched.echo, true);
assert.equal(matched.text, '把主卫的浴缸进水打开');
assert.equal(matched.text.includes('ARROWToilet'), false);
assert.equal(userEcho('把灯打开', '把主卫的浴缸进水打开').echo, false);
assert.equal(userEcho(replay, '').text, '把主卫的浴缸进水打开');
const blind = buildRole({ scenario: SCENARIO, devices: DEVICES.devices, live: { ok: false, error: '鉴权失败' } });
assert.equal(blind.includes('不要编造设备'), true);

const toilets = narrowDevices({
  devices: DEVICES.devices,
  live: { rows: DEVICES.devices },
  userText: '把主卫坐便器的大冲打开',
  cmd: 'switch_watering',
});
assert.equal(toilets.length, 2);
assert.equal(toilets.every((d) => d.room === '主卫'), true);
const tub = narrowDevices({
  devices: DEVICES.devices,
  live: { rows: DEVICES.devices },
  userText: '把主卫的浴缸进水打开',
  cmd: 'switch_water_in',
});
assert.equal(tub.length, 1);
assert.equal(tub[0].deviceName, 'ARROW0417663939524510');
const filled = completeItem(
  { deviceName: '', cmd: '', param: '', value: '' },
  '把主卫的浴缸进水打开',
  SCENARIO.commands,
);
assert.equal(filled.cmd, 'switch_water_in');
assert.equal(filled.param, 'switch');
assert.equal(filled.value, 'on');
const vague = completeItem({ cmd: '', value: '' }, '把设备打开', SCENARIO.commands);
assert.equal(vague.cmd, '');

const cfg = agentConfig(SCENARIO);
assert.equal(cfg.role, undefined);
assert.equal(cfg.sceneRoleCfg, undefined);
assert.equal(cfg.asr_long_audio_mode, true);
assert.equal(cfg.asr, undefined);
assert.equal(role.includes('你是箭牌'), false);

const f = '[F]:' + JSON.stringify({
  session_id: '1754555833139',
  content: JSON.stringify({
    function_name: 'control_device',
    parameter_list: [{
      deviceName: 'ARROW0617696743520408',
      cmd: 'switch_night_light',
      param: 'switch',
      value: 'on',
    }],
  }),
});
const call = parseFunction(f);
assert.equal(classifyFrame(f).kind, 'function');
assert.equal(actionFromCall(call).targets[0].cmd, 'switch_night_light');
const echo = functionResultFrame({ sessionId: call.sessionId, result: 'ok', message: '平台已受理。', speak: '平台已受理。' });
assert.equal(parseFunction(echo), null);
assert.equal(echo.includes('"post_function"'), true);

const offline = await turn.finish({
  sessionId: 'hs_offline',
  action: {
    action: 'device.control',
    targets: [{ deviceName: 'ARROW0617696743520408', cmd: 'switch_night_light', param: 'switch', value: 'on' }],
  },
});
assert.equal(offline.cards.at(-1).data.result, 'SUCCEEDED');

const failing = createTurn({
  scenario: SCENARIO,
  devices: DEVICES.devices,
  gate,
  iot: {
    control: async () => ({
      ok: true, httpStatus: 200, ms: 1,
      request: {}, response: { success: false, code: 500, msg: '设备离线' },
    }),
  },
  audit: { append: async () => {} },
});
const rejected = await failing.finish({
  sessionId: 'hs_offline',
  action: picked.action,
});
assert.equal(rejected.cards.at(-1).data.result, 'FAILED');
assert.equal(rejected.receipt.includes('离线'), true);

console.log('selfcheck ok');
