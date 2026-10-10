// 页面只做三件事：进 BRTC 房间、把字幕交回编排层、渲染闸门卡。
// 不读 AK/SK，不拼授权帧。

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
let turnBusy = false;

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
  const shown = visibleReply(text, lastAsk);
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
      turnBusy = true;
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
    turnBusy = true;
    el.innerHTML = `<div class="lv">选择设备</div><div>${data.say || '有多台设备符合，选一台再下发。'}</div>`;
    const row = document.createElement('div');
    row.className = 'actions';
    for (const choice of data.choices || []) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = [choice.room, choice.deviceTagName].filter(Boolean).join(' ');
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
  turnBusy = true;
  const out = await api('/api/choose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, action, deviceName }),
  });
  el.remove();
  for (const card of out.cards || []) addCard(card);
  if (!document.querySelector('.card.confirm, .card.choose')) turnBusy = false;
}

async function confirm(pendingId, decision, el) {
  const out = await api('/api/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, pendingId, decision }),
  });
  el.querySelector('.actions')?.remove();
  for (const card of out.cards || []) addCard(card);
  turnBusy = false;
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
    if (passed) armSound();
    return;
  }
  if (data.startsWith('[F]:')) {
    if (/"result"\s*:/.test(data) && !data.includes('function_name')) return;
    const hold = agentBubble;
    agentBubble = null;
    paintAgent('正在处理。');
    if (agentBubble) agentBubble.classList.add('thinking');
    const finished = await api('/api/frame', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, frame: data, userText: lastAsk }),
    });
    clearThinking();
    agentBubble = hold;
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
    turnBusy = false;
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
  clearThinking();
  if (partial) {
    agentBuf += text;
    paintAgent(agentBuf);
    return;
  }
  // 最终帧是整句。中间态是分段，不能把最终帧再接到已累积的片段后面。
  const finalText = text || agentBuf;
  const finished = await api('/api/frame', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, frame: data, finalText, userText: lastAsk }),
  });
  agentBuf = '';
  paintAgent(finished.parsed?.text || '');
  agentBubble = null;
  lastAsk = '';
  turnBusy = false;
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

function unlockSound() {
  if (soundOn) return;
  soundOn = true;
  const root = $('therevideo');
  root?.querySelectorAll('audio,video').forEach((el) => {
    el.muted = false;
    el.volume = 1;
    el.play?.().catch(() => {});
  });
}

function armSound() {
  const once = () => {
    unlockSound();
    document.removeEventListener('pointerdown', once, true);
  };
  document.addEventListener('pointerdown', once, true);
}

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
    error: (error) => setStatus('进房失败：' + error),
    onmessage: (msg) => { onAgentFrame(msg).catch((e) => setStatus(e.message)); },
  }));
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
    unlockComposer();
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

const OPERATE = /打开|关闭|开一下|关一下|冲水|大冲|进水|放水|夜灯|翻盖|脚触|润瓷|报修|维修|定时|每天|自动/;
const REPAIR = /报修|维修/;
const REPAIR_LINK = 'arrowhome://repair/create?from=ai_assistant';
const STATS = /多少次|几次|用得最久|使用时长|用了多久|统计|调用|失败了/;

function showThinking() {
  // 上一轮的等待或回答先收掉，避免第二次统计写进旧气泡。
  agentBubble = null;
  agentBuf = '';
  paintAgent('已转发到 DuMate。');
  if (agentBubble) agentBubble.classList.add('thinking');
}

function clearThinking() {
  if (agentBubble?.classList.contains('thinking')) {
    agentBubble.remove();
    agentBubble = null;
  }
}

function showRepair() {
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
}

function showIntent(out) {
  if (out.say) {
    addBubble('agent', out.say);
    if (typeof window.BRTC_SendMessageToUser === 'function') {
      window.BRTC_SendMessageToUser('[E]:[CMD]:[TEXT]:' + out.say);
    }
  }
  for (const card of out.cards || []) addCard(card);
}

async function sendText(text) {
  const value = String(text || '').trim();
  if (!value || !sessionId) return;
  if (REPAIR.test(value)) {
    addBubble('user', value);
    showRepair();
    return;
  }
  if (OPERATE.test(value)) {
    addBubble('user', value);
    try {
      showIntent(await api('/api/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, text: value }),
      }));
    } catch (e) {
      addBubble('agent', e.message);
    }
    return;
  }
  if (turnBusy || typeof window.BRTC_SendMessageToUser !== 'function') {
    micNote('上一条还没结束', true);
    return;
  }
  turnBusy = true;
  window.BRTC_SendMessageToUser('[T]:' + value);
  sentText = value;
  lastAsk = value;
  userBubble = addBubble('user', value);
  userBubble.dataset.local = '1';
  if (STATS.test(value)) showThinking();
  setTimeout(() => { turnBusy = false; }, 20000);
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
  if (!vv || window.innerWidth > 760) {
    document.documentElement.style.setProperty('--kb', '0px');
    return;
  }
  const gap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  document.documentElement.style.setProperty('--kb', gap + 'px');
  if (document.activeElement === $('textInput')) {
    $('dock')?.scrollIntoView?.({ block: 'end' });
  }
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
