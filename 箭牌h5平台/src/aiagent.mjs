// BRTC 互动实例。
//
// 官方 H5 SDK（agent.js V1.0.10）把 generateAIAgentCall 放在浏览器里，
// 请求体直接带 ak/sk。生产不能这么做。这里改成服务端建实例，只把
// appid、房间名、uid、进房 token 交给页面。AK/SK 与 lickey 不出本进程。
//
// 激活帧不在这个文件里发。SDK 进房后网关推 [E]:[LIC]:[MUST]，
// 页面把原文交给 /api/session/:id/lic，由 src/session.mjs 拼 ACTIVE。

import { createHmac } from 'node:crypto';

const DEFAULT_API_HOST = 'https://rtc-aiagent.baidubce.com';
const GENERATE_PATH = '/api/v1/aiagent/generateAIAgentCall';
const STOP_PATH = '/api/v1/aiagent/stopAIAgentInstance';
const HEADERS_TO_SIGN = ['host', 'content-type'];

export function agentConfig(scenario) {
  // 不传 sceneRoleCfg。人设由百度控制台「自定义角色」提供，避免每次建实例覆盖它。
  return {
    lang: 'zh',
    tag: 'H5.SDK',
    tts_end_delay_ms: 20,
    // 按键说话：按住才收音，松开后房间自己的 ASR 把这一段转成文字。
    // https://cloud.baidu.com/doc/RTC/s/9mj8k5zat
    asr_long_audio_mode: true,
    disable_voice_auto_int: true,
    tts_sayhi: scenario.agent.sayhi || '',
  };
}

function encodeHeader(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/** BCE v3。headers 必须显式签 host 和 content-type，否则会回 Signature does not match。 */
function bceAuthorization(ak, sk, method, path, headers) {
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const prefix = `bce-auth-v1/${ak}/${ts}/1800`;
  const signingKey = createHmac('sha256', sk).update(prefix).digest('hex');
  const canonicalHeaders = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort()
    .map((k) => `${encodeHeader(k)}:${encodeHeader(String(headers[k]).trim())}`)
    .join('\n');
  const signature = createHmac('sha256', signingKey)
    .update([method, path, '', canonicalHeaders].join('\n'))
    .digest('hex');
  return `${prefix}/${HEADERS_TO_SIGN.join(';')}/${signature}`;
}

async function signedPost({ ak, sk, apiHost, path, body }) {
  const host = new URL(apiHost).host;
  const headers = { host, 'content-type': 'application/json' };
  const res = await fetch(`https://${host}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: bceAuthorization(ak, sk, 'POST', path, headers),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { res, text, data };
}

/**
 * POST https://rtc-aiagent.baidubce.com/api/v1/aiagent/generateAIAgentCall
 * 用 AK/SK 做 BCE v3 签名。示例网关 ai.agent.kaywang.cn 不认这个 AppID。
 * @returns {Promise<{instanceId: string, token: string, appid: string, uid: string}>}
 */
export async function generateCall({
  appid, ak, sk, apiHost = DEFAULT_API_HOST, instanceType = 'VoiceChat', config,
}) {
  if (!appid) throw new Error('缺少 BRTC_APPID');
  if (!ak || !sk) throw new Error('缺少 BRTC_AK / BRTC_SK');

  const { res, text, data } = await signedPost({
    ak, sk, apiHost, path: GENERATE_PATH,
    body: {
      app_id: appid,
      instance_type: instanceType,
      config: JSON.stringify(config || {}),
    },
  });
  if (!res.ok || !data?.ai_agent_instance_id || !data.context?.token || (data.code !== undefined && data.code !== 0)) {
    const msg = data?.message || data?.error || text.slice(0, 180);
    throw new Error(`建实例失败，HTTP ${res.status}：${msg}`);
  }
  return {
    instanceId: String(data.ai_agent_instance_id),
    token: data.context.token,
    appid: data.context.appid || appid,
    uid: data.context.uid || String(data.ai_agent_instance_id),
  };
}

export async function stopCall({
  appid, ak, sk, apiHost = DEFAULT_API_HOST, instanceId,
}) {
  if (!instanceId) return { ok: true, skipped: true };
  const { res, text } = await signedPost({
    ak, sk, apiHost, path: STOP_PATH,
    body: { app_id: appid, ai_agent_instance_id: instanceId },
  });
  return { ok: res.ok, status: res.status, body: text.slice(0, 300) };
}

/**
 * 网关要求授权时回的那一帧。devId 固定，uId 每次随机，与唯创 handshake.mjs 一致。
 * lickey 只在服务端拼进这一帧，调用方拿到的是完整字符串，自己不持有密钥。
 */
export function licActiveFrame({ devId, licKey, uid }) {
  if (!devId) throw new Error('缺少 devId');
  if (!licKey) throw new Error('缺少 licKey');
  const uId = uid || String(Math.floor(Math.random() * 1000000000000) + 4000000000000000);
  return '[E]:[LIC]:[ACTIVE]:' + JSON.stringify({ devId, uId, licKey });
}
