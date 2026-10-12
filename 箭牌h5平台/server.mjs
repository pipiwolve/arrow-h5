// 箭牌智家 · BRTC H5 平台版
//
//   浏览器  --进房参数-->  BRTC（语音 / ASR / TTS，由官方 SDK 承接）
//        \--字幕与授权帧-->  本服务：激活、摘动作、安全闸门、IoT、审计
//
// AK/SK 与 lickey 只留在本进程。页面拿不到账号密钥。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { SCENARIO, DEVICES, ROOT, FIXTURE_NAME } from './scenario.mjs';
import { loadEnv } from './src/env.mjs';
import { createStore } from './src/store.mjs';
import { createAudit, redact } from './src/audit.mjs';
import { createJournal } from './src/journal.mjs';
import { createIotClient } from './src/iot-client.mjs';
import { createGate } from './src/policy.mjs';
import { createSessions } from './src/session.mjs';
import { createTurn } from './src/turn.mjs';
import { actionFromCall, classifyFrame, extractAction, functionResultFrame } from './src/frames.mjs';
import { topicModel } from './src/topic.mjs';
import { buildRole, visibleReply } from './src/roster.mjs';
import { createGateway } from '../箭牌demo打通/iot/mock-gateway.mjs';

const ENV = loadEnv(ROOT);
const PORT = Number(ENV.PORT || 8900);
const IOT_MODE = ENV.IOT_MODE || 'mock';
const IOT_PORT = Number(ENV.IOT_PORT || 18901);
const PUBLIC_DIR = path.join(ROOT, 'public');

const brtc = {
  appid: ENV.BRTC_APPID || '',
  ak: ENV.BRTC_AK || '',
  sk: ENV.BRTC_SK || '',
  licKey: ENV.BRTC_LICKEY || '',
  devId: ENV.BRTC_DEVID || 'DEVID-ARROW-H5-0001',
  apiHost: ENV.BRTC_API_HOST || 'https://rtc-aiagent.baidubce.com',
  instanceType: ENV.BRTC_INSTANCE_TYPE || 'VoiceChat',
  direct: ENV.BRTC_DIRECT !== '0',
};

const stateStore = createStore({ file: path.join(ROOT, 'state.json') });
const audit = createAudit(createStore({ file: path.join(ROOT, 'audit.jsonl') }));
const journal = createJournal(createStore({ file: path.join(ROOT, 'cards.jsonl') }));
const gate = createGate({ scenario: SCENARIO, devices: DEVICES.devices });

const gateway = IOT_MODE === 'mock'
  ? createGateway({
    commands: SCENARIO.commands,
    fixture: DEVICES,
    log: (kind, msg) => console.log(`[iot:${kind}] ${msg}`),
  })
  : null;

const iot = createIotClient({
  baseUrl: IOT_MODE === 'mock' ? `http://127.0.0.1:${IOT_PORT}` : ENV.IOT_BASE_URL,
  token: IOT_MODE === 'mock' ? (ENV.IOT_TOKEN || 'demo-token') : ENV.IOT_TOKEN,
  appPlatform: SCENARIO.iot.appPlatform,
  deviceSystemPlatform: SCENARIO.iot.deviceSystemPlatform,
});

const LIVE_TTL = 20_000;
let liveCache = { at: 0, rows: null, ok: false, error: null, ms: 0 };

async function liveDevices(force = false) {
  if (!force && liveCache.rows && Date.now() - liveCache.at < LIVE_TTL) return liveCache;
  const started = Date.now();
  try {
    const list = await iot.deviceList(SCENARIO.iot.homeId);
    const rows = Array.isArray(list.response?.data) ? list.response.data : [];
    liveCache = {
      at: Date.now(), rows, ok: !!list.ok, error: list.error || null,
      ms: list.ms ?? (Date.now() - started),
    };
  } catch (e) {
    if (liveCache.rows) return liveCache;
    liveCache = {
      at: Date.now(), rows: [], ok: false,
      error: String(e.message || e), ms: Date.now() - started,
    };
  }
  return liveCache;
}

function deviceRows(live) {
  const seen = new Set();
  const rows = [];
  const push = (d, onlineStatus) => {
    if (!d?.deviceName || seen.has(d.deviceName)) return;
    seen.add(d.deviceName);
    const fix = DEVICES.devices.find((x) => x.deviceName === d.deviceName) || {};
    rows.push({
      deviceName: d.deviceName,
      categoryCode: d.categoryCode || fix.categoryCode || '',
      deviceTagName: d.deviceTagName || fix.deviceTagName || '',
      onlineStatus: onlineStatus ? 1 : 0,
      room: fix.room || '',
    });
  };
  for (const d of live.rows || []) push(d, d.onlineStatus);
  for (const d of DEVICES.devices) push(d, 0);
  return rows;
}

const sessions = createSessions({ brtc, scenario: SCENARIO, store: stateStore });
const turn = createTurn({
  scenario: SCENARIO, devices: DEVICES.devices, gate, iot, audit, liveDevices,
});

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function credentialsReady() {
  return Boolean(brtc.appid && brtc.ak && brtc.sk && brtc.licKey);
}

const routes = {
  async 'GET /api/config'() {
    return {
      brand: SCENARIO.brand,
      starters: SCENARIO.starters.map((item) => (typeof item === 'string' ? item : item.text)).filter(Boolean),
      ready: credentialsReady(),
      missing: ['BRTC_APPID', 'BRTC_AK', 'BRTC_SK', 'BRTC_LICKEY'].filter((k) => !ENV[k]),
      iotMode: IOT_MODE,
      iotHost: IOT_MODE === 'mock' ? `127.0.0.1:${IOT_PORT}` : (ENV.IOT_BASE_URL || ''),
      sayhi: SCENARIO.agent.sayhi || '',
      fixture: FIXTURE_NAME,
      homeId: SCENARIO.iot.homeId,
      voice: true,
      topic: Boolean(ENV.TOPIC_API_KEY && ENV.TOPIC_ADAPTER_URL),
    };
  },

  async 'GET /api/roster'() {
    const live = await liveDevices(true);
    return { text: buildRole({ scenario: SCENARIO, devices: DEVICES.devices, live }) };
  },

  async 'POST /api/session'(req) {
    if (!credentialsReady()) {
      return { status: 400, body: { error: 'BRTC 四件套未配齐，见 .env.example' } };
    }
    const { title } = await readBody(req);
    const opened = await sessions.open({ title });
    return opened;
  },

  async 'GET /api/session'(req, _res, url) {
    const id = url.searchParams.get('id');
    if (id) {
      const rec = sessions.get(id);
      return rec
        ? { id: rec.id, title: rec.title, lic: rec.lic, instanceId: rec.instanceId }
        : { status: 404, body: { error: '会话不存在' } };
    }
    return { sessions: await sessions.list() };
  },

  async 'POST /api/session/lic'(req) {
    const { sessionId, frame } = await readBody(req);
    const kind = classifyFrame(frame).kind;
    if (kind !== 'lic-must') return { status: 400, body: { error: '只接受 [E]:[LIC]:[MUST] 帧' } };
    const out = sessions.activate(sessionId);
    if (!out.ok) return { status: 404, body: out };
    return out;
  },

  async 'POST /api/session/lic-result'(req) {
    const { sessionId, frame } = await readBody(req);
    const kind = classifyFrame(frame).kind;
    if (kind === 'lic-pass') return { session: await sessions.markLic(sessionId, 'pass') };
    if (kind === 'lic-fail') return { status: 403, body: { session: await sessions.markLic(sessionId, 'fail'), error: frame } };
    return { status: 400, body: { error: '不是授权结果帧' } };
  },

  async 'POST /api/session/stop'(req) {
    const { sessionId } = await readBody(req);
    const out = await sessions.close(sessionId);
    return out.ok ? out : { status: 404, body: out };
  },

  async 'POST /api/frame'(req) {
    const { sessionId, frame, finalText, userText } = await readBody(req);
    const parsed = classifyFrame(frame);
    if (parsed.kind === 'function') {
      if (!parsed.call) return { parsed: { kind: 'function', ignored: true }, cards: [] };
      const action = actionFromCall(parsed.call);
      if (!action) {
        const reply = functionResultFrame({
          sessionId: parsed.call.sessionId,
          result: 'error',
          message: `未接入的意图：${parsed.call.name || '空'}`,
        });
        return { parsed: { kind: 'function', name: parsed.call.name }, reply, cards: [] };
      }
      const spoken = String(userText || sessions.get(sessionId)?.lastUserText || '').trim();
      const finished = await turn.finish({ sessionId, action, userText: spoken });
      if (finished.cards?.length) {
        await journal.appendTurn({ sessionId, turnId: 't_' + Date.now(), cards: finished.cards });
      }
      const decision = finished.verdict?.decision;
      const executed = [...(finished.cards || [])].reverse().find((c) => c.event === 'demo.result');
      const accepted = executed
        ? executed.data?.result === 'SUCCEEDED'
        : decision === 'confirm' || action.action === 'repair.open';
      const reply = functionResultFrame({
        sessionId: parsed.call.sessionId,
        result: accepted ? 'ok' : 'error',
        message: finished.receipt || (finished.verdict?.reasons || []).join('；'),
        speak: decision === 'confirm'
          ? '这一步需要你在页面上确认后才会发给平台。'
          : (finished.receipt || (accepted ? '' : (finished.verdict?.reasons || []).join('；'))),
      });
      return redact({
        parsed: { kind: 'function', name: parsed.call.name },
        action, reply, cards: finished.cards,
      });
    }
    // 流式中间态只回分类，不进闸门。一轮结束时页面把最终 [A] 再交一次。
    if (parsed.partial || parsed.kind !== 'agent') {
      return { parsed: { kind: parsed.kind, text: parsed.text || '', partial: !!parsed.partial } };
    }
    const text = String(finalText || parsed.text || '');
    const { action, clean } = extractAction(text);
    const asked = String(userText || '').trim();
    if (asked) sessions.noteUserText(sessionId, asked);
    const finished = await turn.finish({ sessionId, action, userText: asked });
    if (finished.cards?.length) {
      await journal.appendTurn({ sessionId, turnId: 't_' + Date.now(), cards: finished.cards });
    }
    const spoken = String(finished.spoken || '').trim();
    const shown = visibleReply(clean, userText);
    return redact({
      parsed: { kind: 'agent', text: shown || spoken, partial: false },
      action, cards: finished.cards,
    });
  },

  async 'POST /api/topic'(req) {
    const { text } = await readBody(req);
    const model = topicModel(text);
    if (!model) return { status: 400, body: { error: '不是数据统计话题' } };
    if (!ENV.TOPIC_API_KEY || !ENV.TOPIC_ADAPTER_URL) {
      return { status: 400, body: { error: '数据统计适配层未配置' } };
    }
    const res = await fetch(ENV.TOPIC_ADAPTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ENV.TOPIC_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: String(text || '') }],
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { status: res.status, body: { error: body.error?.message || `适配层 HTTP ${res.status}` } };
    }
    const answer = body.choices?.[0]?.message?.content || '';
    return { model, text: answer };
  },

  async 'POST /api/intent'(req) {
    const { sessionId, text } = await readBody(req);
    const userText = String(text || '').trim();
    if (!userText) return { status: 400, body: { error: '没有要处理的话' } };
    const action = {
      action: 'device.control',
      targets: [{ deviceName: '', cmd: '', param: '', value: '' }],
    };
    const finished = await turn.finish({ sessionId, action, userText });
    if (finished.cards?.length) {
      await journal.appendTurn({ sessionId, turnId: 't_' + Date.now(), cards: finished.cards });
    }
    const card = finished.cards?.[0];
    const say = card?.event === 'demo.choose'
      ? '有多台设备符合，选一台再下发。'
      : card?.event === 'demo.gate' && card.data?.decision === 'confirm'
        ? '这一步需要你在页面上确认后才会发给平台。'
        : (finished.spoken || finished.receipt || '');
    return { cards: finished.cards || [], say };
  },

  async 'POST /api/choose'(req) {
    const { sessionId, action, deviceName, userText } = await readBody(req);
    if (!deviceName) return { status: 400, body: { error: '还没有选择设备' } };
    const name = String(deviceName);
    const filled = {
      ...action,
      targets: (action?.targets || []).map((item) => ({ ...item, deviceName: item.deviceName || name })),
      actionList: (action?.actionList || []).map((item) => ({ ...item, deviceName: item.deviceName || name })),
    };
    return turn.finish({ sessionId, action: filled, userText: userText || name });
  },

  async 'POST /api/confirm'(req) {
    const { sessionId, pendingId, decision } = await readBody(req);
    const out = await turn.confirm({ sessionId, pendingId, decision });
    if (!out.ok) return { status: 400, body: out };
    await journal.appendResolve({ sessionId, pendingId, decision, out });
    return redact(out);
  },

  async 'GET /api/devices'(_req, _res, url) {
    const live = await liveDevices(url.searchParams.get('fresh') === '1');
    return {
      homeId: SCENARIO.iot.homeId,
      ok: live.ok,
      error: live.error,
      ms: live.ms,
      devices: deviceRows(live),
    };
  },

  async 'GET /api/audit'() {
    return { items: await audit.tail(80) };
  },

  async 'GET /api/cards'(req, _res, url) {
    const id = url.searchParams.get('sessionId');
    return { items: id ? await journal.bySession(id) : [] };
  },
};

function matchRoute(method, pathname) {
  return routes[`${method} ${pathname}`] || null;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, ''));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=604800',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const handler = matchRoute(req.method, url.pathname);
  if (!handler) return serveStatic(req, res, url.pathname);
  try {
    const out = await handler(req, res, url);
    if (out && Object.prototype.hasOwnProperty.call(out, 'status')) return sendJson(res, out.status, out.body);
    sendJson(res, 200, out ?? {});
  } catch (e) {
    console.error('[http]', req.method, url.pathname, e.message);
    sendJson(res, 500, { error: String(e.message || e) });
  }
});

function listen() {
  server.listen(PORT, () => {
    const ready = credentialsReady() ? '四件套已配置' : '四件套未配齐，页面可开，通话会提示缺项';
    console.log(`[arrow-h5] http://127.0.0.1:${PORT}  IoT=${IOT_MODE} fixture=${FIXTURE_NAME}  ${ready}`);
  });
}

if (gateway) {
  gateway.listen(IOT_PORT, '127.0.0.1', () => {
    console.log(`[iot] mock http://127.0.0.1:${IOT_PORT}`);
    listen();
  });
} else {
  listen();
}
