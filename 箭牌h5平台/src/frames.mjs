// BRTC 数据通道帧。页面把 onmessage 原文交上来，这里只做分类，不发网络请求。
//
// 字幕约定来自官方 H5 示例：
//   [Q]: 用户说的话（ASR）   [A]: 智能体回答
//   [M] 流式中间态           [C] 纠错
//   [E]: 事件（授权、播报、闹钟）
//   [F]: function call

const IOT_RE = /```(?:iot|json)\s*\n([\s\S]*?)```/;

export function classifyFrame(raw) {
  const data = String(raw || '');
  if (data.startsWith('[E]:[LIC]:[MUST]')) return { kind: 'lic-must', data };
  if (data.startsWith('[E]:[LIC]:[RES]:[PASS]')) return { kind: 'lic-pass', data };
  if (data.startsWith('[E]:[LIC]:[RES]:[FAILED]')) return { kind: 'lic-fail', data };
  if (data.startsWith('[E]')) return { kind: 'event', data };
  if (data.startsWith('[F]')) return { kind: 'function', data, call: parseFunction(data) };
  if (data.startsWith('[Q]:')) return { kind: 'user', data, text: stripMarker(data, 'Q'), partial: data.includes('[M]') };
  if (data.startsWith('[A]:')) return { kind: 'agent', data, text: stripMarker(data, 'A'), partial: data.includes('[M]') };
  return { kind: 'other', data };
}

function stripMarker(data, who) {
  return data
    .replace(new RegExp(`^\\[${who}\\]:`), '')
    .replace(/^\[M\]:?/, '')
    .replace(/^\[C\]:?/, '')
    .replace(/^\[M\]:\[C\]:?/, '')
    .trim();
}

export function parseFunction(data) {
  const raw = String(data || '');
  const body = raw.startsWith('[F]:') ? raw.slice(4) : raw.startsWith('[F]') ? raw.slice(3) : raw;
  try {
    const outer = JSON.parse(body.trim());
    // 客户端回给服务端的执行结果也会以 [F] 回来，不能再当成一次新调用。
    if (outer && (outer.result === 'ok' || outer.result === 'error') && !outer.content) return null;
    let content = outer?.content ?? outer;
    if (typeof content === 'string') content = JSON.parse(content);
    if (!content || typeof content !== 'object' || !(content.function_name || content.name)) return null;
    const params = content.parameter_list || content.parameters || [];
    return {
      name: content.function_name || content.name || '',
      params: Array.isArray(params) ? params : [params],
      sessionId: outer.session_id || outer.sessionId || '',
    };
  } catch {
    return null;
  }
}

const FN_ACTION = {
  control_device: 'device.control',
  create_scene: 'scene.create',
  open_repair: 'repair.open',
};

/** 把 [F] 的 parameter_list 收成闸门认识的 action。未知意图返回 null。 */
export function actionFromCall(call) {
  const action = FN_ACTION[call?.name];
  if (!action) return null;
  const row = call.params?.[0] && typeof call.params[0] === 'object' ? call.params[0] : {};
  if (action === 'device.control') {
    return {
      action,
      targets: [{
        deviceName: String(row.deviceName || ''),
        cmd: String(row.cmd || ''),
        param: String(row.param || 'switch'),
        value: String(row.value || ''),
      }],
      say: String(row.say || ''),
    };
  }
  if (action === 'open_repair') {
    return { action, kind: row.kind === 'progress' ? 'progress' : 'report', say: String(row.say || '') };
  }
  return {
    action,
    conditionList: parseList(row.conditionList),
    actionList: parseList(row.actionList),
    say: String(row.say || ''),
  };
}

function parseList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 回给数据通道的函数结果。speak 不为空时用固定文本播报，不再让模型自由发挥。 */
export function functionResultFrame({ sessionId, result, message, speak }) {
  const body = {
    session_id: String(sessionId || ''),
    result: result === 'ok' ? 'ok' : 'error',
    message: String(message || ''),
  };
  if (speak) body.post_function = [{ type: 'text', content: String(speak).slice(0, 180) }];
  return '[F]:' + JSON.stringify(body);
}

function takeJsonObject(src, start) {
  let depth = 0;
  let quote = false;
  let esc = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') quote = false;
      continue;
    }
    if (ch === '"') quote = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return '';
}

/** 从一轮完整回答里摘出 iot 动作。代码块和裸 JSON 都摘，正文里不留。 */
export function extractAction(text) {
  const src = String(text || '');
  const fenced = IOT_RE.exec(src);
  if (fenced) {
    let obj;
    try { obj = JSON.parse(fenced[1].trim()); } catch { obj = null; }
    if (obj && typeof obj === 'object' && typeof obj.action === 'string') {
      return { action: obj, clean: tidy(src.replace(fenced[0], '')) };
    }
  }
  const marker = src.search(/\{\s*"action"\s*:/);
  if (marker >= 0) {
    const raw = takeJsonObject(src, marker);
    let obj;
    try { obj = raw ? JSON.parse(raw) : null; } catch { obj = null; }
    if (obj && typeof obj.action === 'string') {
      return { action: obj, clean: tidy(src.slice(0, marker) + src.slice(marker + raw.length)) };
    }
  }
  return { action: null, clean: src.trim() };
}

function tidy(text) {
  return String(text).replace(/\n{3,}/g, '\n\n').trim();
}
