// 页面只做三件事：进 BRTC 房间、把字幕交回编排层、渲染闸门卡。
// 不读 AK/SK，不拼授权帧。

import { createTurnGate } from './turn-gate.js';

const $ = (id) => document.getElementById(id);
let sessionId = null;
let licFrame = '';
let agentBuf = '';
let agentBubble = null;
let userBubble = null;
let sentText = '';
let connectPromise = null;
let licPassed = false;
// 按住期间房间回的 [Q] 只进输入框，松手后的最终句也不当作用户已经发出。
let holding = false;
let dictating = false;
let lastAsk = '';
let roomTimer = 0;
let localIntentAt = 0;

function stopSpeech() {
  const media = $('therevideo');
  media?.querySelectorAll('audio,video').forEach((el) => {
    try {
      el.pause();
      el.currentTime = 0;
    } catch {}
  });
  if (typeof window.BRTC_SendMessageToUser === 'function') {
    window.BRTC_SendMessageToUser('[B]');
  }
}

const turns = createTurnGate({
  claim: () => api('/api/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  }),
  breakTurn: stopSpeech,
});

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function setStatus(text) {
  $('status').textContent = text;
  document.body.dataset.live = text === '已连接' ? '1' : '0';
}

function addBubble(role, text) {
  const el = document.createElement('div');
  el.className = 'bubble ' + role;
  if (role === 'agent') {
    const mark = document.createElement('img');
    mark.className = 'mark';
    mark.src = 'favicon.png';
    mark.alt = '';
    const body = document.createElement('div');
    body.className = 'text';
    body.textContent = text;
    el.append(mark, body);
  } else {
    el.textContent = text;
  }
  $('stream').append(el);
  el.scrollIntoView({ block: 'end' });
  return el;
}

function bubbleText(el) {
  return el?.querySelector?.('.text') || el;
}

function sameText(a, b) {
  return String(a || '').replace(/\s+/g, '') === String(b || '').replace(/\s+/g, '');
}

// 与 src/roster.mjs 的 ROSTER_MARK、visibleReply、userEcho 一致。
const ROSTER_MARK = '【家庭设备】';
const PARAM_CHASE = /device\s*ID|deviceId|deviceName|CMD|请提供|执行动作|具体指令|其余参数可选|其他参数可选/i;

function visibleAgent(text) {
  const value = String(text || '').trim();
  if (PARAM_CHASE.test(value)) return '';
  return value;
}

function visibleReply(text, userText) {
  let src = String(text || '').trim();
  const at = src.indexOf(ROSTER_MARK);
  if (at >= 0) src = src.slice(0, at).trim();
  if (userText && sameText(src, userText)) return '';
  return src;
}

function userEcho(text, sent) {
  let src = String(text || '').trim();
  const at = src.indexOf(ROSTER_MARK);
  if (at >= 0) src = src.slice(0, at).trim();
  if (!sent) return { text: src, echo: false };
  const got = src.replace(/\s+/g, '');
  const want = String(sent).replace(/\s+/g, '');
  return { text: src, echo: got === want || (want.startsWith(got) && got.length > 0) };
}

function paintAgent(text) {
  const shown = visibleAgent(visibleReply(text, lastAsk));
  if (!shown) {
    agentBubble?.remove();
    agentBubble = null;
    return;
  }
  if (!agentBubble) agentBubble = addBubble('agent', shown);
  else bubbleText(agentBubble).textContent = shown;
}

const DECISION_LABEL = { allow: '已放行', confirm: '等你确认', deny: '已拒绝' };
const RESULT_LABEL = {
  SUCCEEDED: '已执行', FAILED: '未成功', REJECTED: '已拒绝', CANCELLED: '已取消',
};

function addCard(card) {
  const data = card.data || {};
  const el = document.createElement('div');
  const decision = data.decision || 'allow';
  el.className = 'card ' + (card.event === 'demo.choose' ? 'choose' : decision);
  if (card.event === 'demo.gate') {
    el.innerHTML = `<div class="lv">${data.level || ''} · ${DECISION_LABEL[decision] || decision}</div><div>${(data.reasons || []).join('；') || data.say || ''}</div>`;
    if (decision === 'confirm' && data.pendingId) {
      const row = document.createElement('div');
      row.className = 'actions';
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'yes';
      ok.textContent = '确认执行';
      ok.onclick = () => confirm(data.pendingId, 'confirm', el);
      const no = document.createElement('button');
      no.type = 'button';
      no.textContent = '取消';
      no.onclick = () => confirm(data.pendingId, 'cancel', el);
      row.append(ok, no);
      el.append(row);
    }
  } else if (card.event === 'demo.result') {
    const body = data.response;
    const msg = (body && typeof body === 'object' && (body.msg || body.message)) || data.error || '';
    const label = RESULT_LABEL[data.result] || data.result || '';
    el.innerHTML = `<div class="lv">${label}</div><div>${msg}</div>`;
  } else if (card.event === 'demo.choose') {
    el.innerHTML = `<div class="lv">选择设备</div><div>${data.say || '有多台设备符合，选一台再下发。'}</div>`;
    const row = document.createElement('div');
    row.className = 'actions';
    const sameName = new Map();
    for (const choice of data.choices || []) {
      const key = [choice.room, choice.deviceTagName].filter(Boolean).join(' ');
      sameName.set(key, (sameName.get(key) || 0) + 1);
    }
    const seen = new Map();
    for (const choice of data.choices || []) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const key = [choice.room, choice.deviceTagName].filter(Boolean).join(' ');
      const nth = (seen.get(key) || 0) + 1;
      seen.set(key, nth);
      const suffix = sameName.get(key) > 1 ? ` ${nth}` : '';
      btn.textContent = key + suffix;
      btn.onclick = () => chooseDevice(data.action, choice.deviceName, el);
      row.append(btn);
    }
    el.append(row);
  } else if (card.event === 'demo.repair') {
    el.innerHTML = `<div class="lv">${data.title || '报修'}</div><div>${data.body || data.note || ''}</div>`;
    if (data.deeplink) {
      const row = document.createElement('div');
      row.className = 'actions';
      const go = document.createElement('a');
      go.href = data.deeplink;
      go.textContent = '打开报修页';
      row.append(go);
      el.append(row);
    }
  }
  $('stream').append(el);
  el.scrollIntoView({ block: 'end' });
}

async function chooseDevice(action, deviceName, el) {
  const out = await api('/api/choose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, action, deviceName, userText: lastAsk }),
  });
  el.remove();
  for (const card of out.cards || []) addCard(card);
}

async function confirm(pendingId, decision, el) {
  const out = await api('/api/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, pendingId, decision }),
  });
  el.querySelector('.actions')?.remove();
  for (const card of out.cards || []) addCard(card);
}

function stale(gen) {
  return turns.stale(gen);
}

async function onAgentFrame(msg) {
  const data = msg?.data || '';
  if (data.startsWith('[E]:[LIC]:[MUST]')) {
    setStatus('正在激活授权');
    if (licFrame) {
      window.BRTC_SendMessageToUser(licFrame);
      return;
    }
    const out = await api('/api/session/lic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, frame: data }),
    });
    window.BRTC_SendMessageToUser(out.frame);
    return;
  }
  if (data.startsWith('[E]:[LIC]:[RES]:')) {
    const out = await api('/api/session/lic-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, frame: data }),
    });
    const passed = data.includes('[PASS]');
    licPassed = passed;
    setStatus(passed ? '已连接' : '授权未通过');
    if (passed) {
      armSound();
      setTimeout(readyToTalk, 8000);
    } else {
      $('booting').hidden = true;
    }
    return;
  }
  if (data.startsWith('[F]:')) {
    if (/"result"\s*:/.test(data) && !data.includes('function_name')) return;
    // 设备指令已由本机处理。房间随后交来的同一次调用没有原话，会把全部设备列出来。
    if (data.includes('control_device') && Date.now() - localIntentAt < 15000) return;
    const hold = agentBubble;
    const gen = turns.snapshot().turnGen;
    agentBubble = null;
    paintAgent('正在处理。');
    if (agentBubble) agentBubble.classList.add('thinking');
    const finished = await api('/api/frame', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, frame: data, userText: lastAsk, turnGen: gen }),
    });
    agentBubble = hold;
    if (stale(gen) || finished.superseded) return;
    if (finished.ignored || finished.parsed?.ignored) return;
    if (finished.reply && typeof window.BRTC_SendMessageToUser === 'function') {
      window.BRTC_SendMessageToUser(finished.reply);
    }
    for (const card of finished.cards || []) {
      if (card.event === 'demo.repair') continue;
      addCard(card);
    }
    const spoken = String(finished.reply || '').match(/"content":"([^"]*)"/);
    if (spoken?.[1]) paintAgent(spoken[1]);
    releaseRoom(gen);
    return;
  }
  if (!data.startsWith('[A]:') && !data.startsWith('[Q]:')) return;
  const partial = data.includes('[M]');
  const corrected = data.includes('[C]');
  const text = data
    .replace(/^\[(A|Q)\]:/, '')
    .replace(/^\[M\]:?/, '')
    .replace(/^\[C\]:?/, '')
    .replace(/^\[M\]:\[C\]:?/, '');
  if (data.startsWith('[Q]:')) {
    // 按住说话时，房间 ASR 的中间态和最终句都回填输入框，不进对话。
    // 最终句可能晚于松手到达，所以用 dictating 守住这一轮。
    if (dictating) {
      if (!partial) finishDictation(userEcho(text, '').text);
      return;
    }
    // 文字和快捷句已经在本地画过。房间回放整段 [T]，含设备清单。
    // 清单从标记起丢掉。对上用户原话就改这一条，不再追加绿色长气泡。
    if (sentText && userBubble?.dataset.local) {
      const echo = userEcho(text, sentText);
      if (echo.echo) {
        if (sameText(echo.text, sentText)) bubbleText(userBubble).textContent = sentText;
        if (!partial && sameText(echo.text, sentText)) {
          sentText = '';
          userBubble = null;
        }
        return;
      }
      sentText = '';
      userBubble = null;
    }
    const spoken = userEcho(text, '').text;
    if (!spoken) return;
    // [Q] 的中间态是当前整句，不是增量。同一条气泡上改字。
    if (partial || corrected || userBubble?.dataset.live) {
      if (!userBubble) userBubble = addBubble('user', spoken);
      bubbleText(userBubble).textContent = spoken;
      userBubble.dataset.live = partial ? '1' : '';
      if (!partial) userBubble = null;
      return;
    }
    addBubble('user', spoken);
    return;
  }
  if (!data.startsWith('[A]:')) return;
  readyToTalk();
  const gen = turns.snapshot().turnGen;
  if (partial) {
    if (stale(gen)) return;
    agentBuf += text;
    paintAgent(agentBuf);
    return;
  }
  // 最终帧是整句。中间态是分段，不能把最终帧再接到已累积的片段后面。
  const finalText = text || agentBuf;
  const finished = await api('/api/frame', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, frame: data, finalText, userText: lastAsk, turnGen: gen }),
  });
  if (stale(gen) || finished.superseded) return;
  agentBuf = '';
  const shown = finished.parsed?.text || '';
  if (!shown) stopSpeech();
  paintAgent(shown);
  agentBubble = null;
  lastAsk = '';
  releaseRoom(gen);
  for (const card of finished.cards || []) {
    if (card.event === 'demo.repair') continue;
    addCard(card);
  }
}

function sendCmd(frame) {
  if (typeof window.BRTC_SendMessageToUser === 'function') window.BRTC_SendMessageToUser(frame);
}

function setRoomMic(on) {
  if (typeof window.BRTC_MuteMicphone === 'function') window.BRTC_MuteMicphone(!on);
}

let soundOn = false;

function playRoomAudio() {
  $('therevideo')?.querySelectorAll('audio,video').forEach((el) => {
    el.muted = false;
    el.volume = 1;
    el.play?.().catch(() => {});
  });
}

function unlockSound() {
  soundOn = true;
  playRoomAudio();
}

function armSound() {
  document.addEventListener('pointerdown', unlockSound, true);
}

new MutationObserver(() => { if (soundOn) playRoomAudio(); })
  .observe($('therevideo'), { childList: true, subtree: true });

function startRtc(join) {
  window.BRTC_Start(Object.assign({}, join, {
    aspublisher: true,
    usingdatachannel: true,
    usingvideo: false,
    usingaudio: true,
    autosubscribe: true,
    autopublish: true,
    userevent: true,
    sessionevent: true,
    autoplaymuted: true,
    success: () => {
      setStatus('已进房，等待授权');
      setRoomMic(false);
    },
    localvideopublished_ok: () => { if (!holding) setRoomMic(false); },
    error: (error) => {
      setStatus('进房失败：' + error);
      $('booting').hidden = true;
    },
    onmessage: (msg) => { onAgentFrame(msg).catch((e) => setStatus(e.message)); },
  }));
}

let greeted = false;

function readyToTalk() {
  if (greeted) return;
  greeted = true;
  $('booting').hidden = true;
  unlockComposer();
}

function unlockComposer() {
  $('textInput').disabled = false;
  $('textSend').disabled = false;
  $('btnMic').disabled = false;
  enableStarters();
}

async function startCall() {
  if (sessionId) return;
  if (connectPromise) return connectPromise;
  connectPromise = (async () => {
    setStatus('正在创建实例');
    const opened = await api('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '箭牌对话' }),
    });
    sessionId = opened.session.id;
    licFrame = opened.licFrame || '';
    if (typeof window.BRTC_Start !== 'function') {
      setStatus('BRTC SDK 未加载，连接未建立');
      throw new Error('BRTC SDK 未加载');
    }
    startRtc(opened.join);
  })();
  try {
    await connectPromise;
  } catch (e) {
    setStatus(e.message);
    $('credHint').textContent = e.message;
    $('booting').hidden = true;
  } finally {
    connectPromise = null;
  }
}

async function stopCall() {
  holding = false;
  dictating = false;
  licPassed = false;
  try { if (typeof window.BRTC_Stop === 'function') window.BRTC_Stop(); } catch {}
  if (sessionId) {
    try { await api('/api/session/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) }); } catch {}
  }
  sessionId = null;
  licFrame = '';
}

$('prompts').onclick = (e) => {
  const btn = e.target.closest('button');
  if (!btn || btn.disabled) return;
  sendText(btn.dataset.text || btn.textContent);
};

$('nav').onclick = (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('on', b === btn));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === 'view-' + btn.dataset.view));
  if (btn.dataset.view === 'devices') loadDevices();
  if (btn.dataset.view === 'audit') loadAudit();
};

const OPERATE = /打开|关闭|关掉|关上|开一下|关一下|启动|启用|停用|别|冲水|大冲|小冲|进水|放水|夜灯|翻盖|脚触|润瓷|报修|维修|定时|每天|自动/;
const REPAIR = /报修|维修/;
const TOPIC = /调用了多少|调用次数|多少次|失败了几次|成功了几次|用得最久|使用时长|用了多久|用了多少分钟/;
const REPAIR_LINK = 'arrowhome://repair/create?from=ai_assistant';

function releaseRoom(gen) {
  if (!turns.release(gen)) return;
  clearTimeout(roomTimer);
  micNote('');
}

async function openTurn(kind) {
  agentBuf = '';
  agentBubble?.remove();
  agentBubble = null;
  clearTimeout(roomTimer);
  const gen = await turns.openTurn(kind);
  if (kind === 'room') roomTimer = setTimeout(() => releaseRoom(gen), 20000);
  return gen;
}

async function sayToRoom(value) {
  const gen = await openTurn('room');
  if (stale(gen)) return;
  window.BRTC_SendMessageToUser('[T]:' + value);
  sentText = value;
  lastAsk = value;
  userBubble = addBubble('user', value);
  userBubble.dataset.local = '1';
  userBubble.dataset.gen = String(gen);
}

async function showRepair() {
  const gen = await openTurn('local');
  const say = '已准备好报修入口。';
  addBubble('agent', say);
  if (typeof window.BRTC_SendMessageToUser === 'function') {
    window.BRTC_SendMessageToUser('[E]:[CMD]:[TEXT]:' + say);
  }
  addCard({
    event: 'demo.repair',
    data: {
      title: '报修',
      body: '助手不创建工单。点击后进入箭牌 App 的报修页，填写设备和问题。',
      deeplink: REPAIR_LINK,
    },
  });
  return gen;
}

function showIntent(out) {
  if (out.superseded) return;
  localIntentAt = Date.now();
  if (out.say) {
    addBubble('agent', out.say);
    if (typeof window.BRTC_SendMessageToUser === 'function') {
      window.BRTC_SendMessageToUser('[E]:[CMD]:[TEXT]:' + out.say);
    }
  }
  for (const card of out.cards || []) addCard(card);
}

function rememberAsk(text) {
  lastAsk = text;
}

async function sendText(text) {
  const value = String(text || '').trim();
  if (!value || !sessionId) return;
  if (TOPIC.test(value)) {
    const gen = await openTurn('topic');
    addBubble('user', value);
    try {
      const out = await api('/api/topic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: value }),
      });
      if (stale(gen)) return;
      const answer = out.text || '适配层没有返回结论。';
      addBubble('agent', answer);
      if (typeof window.BRTC_SendMessageToUser === 'function') {
        window.BRTC_SendMessageToUser('[E]:[CMD]:[TEXT]:' + answer);
      }
    } catch (e) {
      if (!stale(gen)) addBubble('agent', e.message);
    } finally {
      turns.finishLocal(gen);
    }
    return;
  }
  if (REPAIR.test(value)) {
    addBubble('user', value);
    const gen = await showRepair();
    turns.finishLocal(gen);
    return;
  }
  if (OPERATE.test(value)) {
    const gen = await openTurn('intent');
    rememberAsk(value);
    addBubble('user', value);
    try {
      const out = await api('/api/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, text: value, turnGen: gen }),
      });
      if (!stale(gen)) showIntent(out);
    } catch (e) {
      if (!stale(gen)) addBubble('agent', e.message);
    } finally {
      turns.finishLocal(gen);
    }
    return;
  }
  if (typeof window.BRTC_SendMessageToUser !== 'function') return;
  await sayToRoom(value);
}

$('textForm').onsubmit = (e) => {
  e.preventDefault();
  const value = $('textInput').value;
  $('textInput').value = '';
  sendText(value);
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

async function loadDevices() {
  const data = await api('/api/devices?fresh=1');
  const rooms = new Map();
  for (const row of data.devices || []) {
    const room = row.room || '未分配房间';
    if (!rooms.has(room)) rooms.set(room, []);
    rooms.get(room).push(row);
  }
  if (!data.ok && !rooms.size) {
    $('devPane').innerHTML = `<p class="empty">${esc(data.error || '设备列表没有取到')}</p>`;
    return;
  }
  if (!rooms.size) {
    $('devPane').innerHTML = '<p class="empty">家里还没有设备。</p>';
    return;
  }
  $('devPane').innerHTML = [...rooms].map(([room, rows]) => `
    <section class="room">
      <h2>${esc(room)}</h2>
      ${rows.map((d) => `
        <article class="device">
          <div>
            <div class="name">${esc(d.deviceTagName || d.deviceName)}</div>
            <div class="meta">${esc(d.deviceName)}</div>
          </div>
          <div class="state ${d.onlineStatus ? 'on' : 'off'}">${d.onlineStatus ? '在线' : '离线'}</div>
        </article>`).join('')}
    </section>`).join('');
}

function clock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '';
  return date.toLocaleString('zh-CN', { hour12: false });
}

async function loadAudit() {
  const data = await api('/api/audit');
  const items = data.items || [];
  $('auditPane').innerHTML = items.length
    ? `<div class="ledger">${items.map((r) => `
        <article class="entry">
          <time>${esc(clock(r.at))}</time>
          <div>${esc(r.kind || '')}${r.level ? ` · ${esc(r.level)}` : ''}</div>
          <div class="decision ${esc(r.decision || '')}">${esc(DECISION_LABEL[r.decision] || RESULT_LABEL[r.result] || r.decision || r.result || '')}</div>
        </article>`).join('')}</div>`
    : '<p class="empty">还没有设备操作。</p>';
}
$('btnDev').onclick = loadDevices;
$('btnAudit').onclick = loadAudit;

let micTimer = 0;
let micStopTimer = 0;
let heard = false;
const MISHEARD = /没有听清|没听清|没有听清楚|请再说一遍/;

function asrUtterance(text) {
  const value = String(text || '').trim();
  if (!value || MISHEARD.test(value)) return '';
  return value;
}

function finishDictation(text) {
  dictating = false;
  const spoken = asrUtterance(text);
  if (!spoken) {
    micNote('没听清，按住说完再松开', true);
    return;
  }
  heard = true;
  micNote('');
  sendText(spoken);
}

function micNote(text, err) {
  const el = $('composerNote');
  el.hidden = !text;
  el.textContent = text || '';
  el.classList.toggle('err', !!err);
}

function startHold() {
  if (!window.isSecureContext) {
    micNote('当前地址是 http，浏览器不允许使用麦克风。请用 https 域名打开。', true);
    return;
  }
  if (holding || $('btnMic').disabled || !sessionId || !licPassed) {
    if (!licPassed) micNote('还在连接，稍等一下', true);
    return;
  }
  holding = true;
  dictating = true;
  heard = false;
  $('btnMic').classList.add('rec');
  micNote('正在听…');
  clearTimeout(micStopTimer);
  setRoomMic(true);
  // 先打开麦克风，再开始识别。反过来房间会录到一段静音。
  micStopTimer = setTimeout(() => {
    if (holding) sendCmd('[E]:[CMD]:[ASR_START_LONGTEXT_REC]');
  }, 200);
  clearTimeout(micTimer);
  micTimer = setTimeout(() => { if (holding) stopHold(); }, 55000);
}

function stopHold() {
  if (!holding) return;
  holding = false;
  clearTimeout(micTimer);
  clearTimeout(micStopTimer);
  $('btnMic').classList.remove('rec');
  sendCmd('[E]:[CMD]:[ASR_STOP_LONGTEXT_REC]');
  micNote('识别中…');
  // 先结束识别，再关麦克风，避免尾音被截掉。
  micStopTimer = setTimeout(() => { if (!holding) setRoomMic(false); }, 600);
  setTimeout(() => { if (dictating && !heard) finishDictation(''); }, 8000);
}

const micBtn = $('btnMic');
micBtn.addEventListener('touchstart', (e) => {
  if (micBtn.disabled) return;
  e.preventDefault();
}, { passive: false });
micBtn.addEventListener('selectstart', (e) => e.preventDefault());
micBtn.addEventListener('dragstart', (e) => e.preventDefault());
micBtn.addEventListener('pointerdown', (e) => {
  if (micBtn.disabled || e.button > 0) return;
  e.preventDefault();
  try { micBtn.setPointerCapture(e.pointerId); } catch {}
  startHold();
});
micBtn.addEventListener('pointerup', (e) => {
  if (!holding) return;
  e.preventDefault();
  stopHold();
});
micBtn.addEventListener('pointercancel', () => { if (holding) stopHold(); });
micBtn.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('blur', () => { if (holding) stopHold(); });

function pinKeyboard() {
  const vv = window.visualViewport;
  const dock = $('dock');
  if (!vv || !dock || window.innerWidth > 760) {
    document.documentElement.style.setProperty('--kb', '0px');
    if (dock) dock.style.transform = '';
    return;
  }
  const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  document.documentElement.style.setProperty('--kb', covered + 'px');
  dock.style.transform = covered ? `translateY(${-covered}px)` : '';
}
window.visualViewport?.addEventListener('resize', pinKeyboard);
window.visualViewport?.addEventListener('scroll', pinKeyboard);
window.addEventListener('pagehide', () => { stopCall(); });

function enableStarters() {
  document.querySelectorAll('#prompts button').forEach((btn) => { btn.disabled = false; });
}

api('/api/config').then((cfg) => {

  $('credHint').textContent = cfg.ready ? '' : `还不能连接，缺 ${cfg.missing.join('、')}`;
  if (cfg.ready) startCall();
}).catch((e) => { $('credHint').textContent = e.message; });
