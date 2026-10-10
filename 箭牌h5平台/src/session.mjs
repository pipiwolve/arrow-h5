// 一次 BRTC 通话在编排层的记录。
// 页面不持有 AK/SK。开始通话时这里建实例，把进房参数交出去；
// 收到 LIC MUST 时这里拼激活帧。

import crypto from 'node:crypto';
import { agentConfig, generateCall, licActiveFrame, stopCall } from './aiagent.mjs';

export function createSessions({ brtc, scenario, store }) {
  const live = new Map();

  function publicView(rec) {
    return {
      id: rec.id,
      title: rec.title,
      lic: rec.lic,
      instanceId: rec.instanceId,
      createdAt: rec.createdAt,
      closedAt: rec.closedAt || null,
    };
  }

  async function open({ title = '新通话' } = {}) {
    const id = 'hs_' + crypto.randomBytes(6).toString('hex');
    const call = await generateCall({
      appid: brtc.appid,
      ak: brtc.ak,
      sk: brtc.sk,
      apiHost: brtc.apiHost,
      instanceType: brtc.instanceType,
      config: agentConfig(scenario),
    });
    const rec = {
      id,
      title: String(title).slice(0, 40),
      createdAt: new Date().toISOString(),
      lic: 'pending',
      instanceId: call.instanceId,
      appid: call.appid,
      uid: call.uid,
      token: call.token,
      devId: brtc.devId,
      lastUserText: '',
    };
    live.set(id, rec);
    const state = await store.readJson({ sessions: [] });
    state.sessions = [{ ...publicView(rec) }, ...(state.sessions || [])].slice(0, 40);
    store.writeJson(state).catch(() => {});
    return {
      session: publicView(rec),
      licFrame: licActiveFrame({ devId: rec.devId, licKey: brtc.licKey }),
      // 进房参数。token 是这一次通话的房间凭证，不是账号 SK。
      join: {
        appid: call.appid,
        token: call.token,
        roomname: call.instanceId,
        userid: call.uid,
        displayname: '箭牌用户',
        remotevideoviewid: 'therevideo',
        localvideoviewid: 'herevideo',
        usingvideo: false,
        usingaudio: true,
      },
    };
  }

  function get(id) {
    return live.get(id) || null;
  }

  function noteUserText(id, text) {
    const rec = live.get(id);
    const value = String(text || '').trim();
    if (rec && value) rec.lastUserText = value.slice(0, 200);
  }

  /** 网关推来 [E]:[LIC]:[MUST] 后，由服务端拼激活帧。 */
  function activate(id) {
    const rec = live.get(id);
    if (!rec) return { ok: false, error: '会话不存在或已结束' };
    if (!brtc.licKey) return { ok: false, error: '服务端未配置 BRTC_LICKEY' };
    const frame = licActiveFrame({ devId: rec.devId, licKey: brtc.licKey });
    rec.lic = 'activating';
    return { ok: true, frame };
  }

  async function markLic(id, status) {
    const rec = live.get(id);
    if (!rec) return null;
    rec.lic = status;
    const state = await store.readJson({ sessions: [] });
    state.sessions = (state.sessions || []).map((s) => (s.id === id ? { ...s, lic: status } : s));
    await store.writeJson(state);
    return publicView(rec);
  }

  async function close(id) {
    const rec = live.get(id);
    if (!rec) return { ok: false, error: '会话不存在或已结束' };
    const stopped = await stopCall({
      appid: rec.appid,
      ak: brtc.ak,
      sk: brtc.sk,
      apiHost: brtc.apiHost,
      instanceId: rec.instanceId,
    });
    rec.closedAt = new Date().toISOString();
    live.delete(id);
    return { ok: true, stopped, session: publicView(rec) };
  }

  async function list() {
    const state = await store.readJson({ sessions: [] });
    return state.sessions || [];
  }

  return { open, get, noteUserText, activate, markLic, close, list };
}
