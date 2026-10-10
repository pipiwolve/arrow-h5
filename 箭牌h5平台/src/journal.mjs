// 界面卡片流水。闸门卡、执行卡、报修卡不在 BRTC 字幕里，回放要靠这里。
import { redact } from './audit.mjs';

export function createJournal(store) {
  async function appendTurn({ sessionId, turnId, cards }) {
    if (!sessionId || !turnId || !cards?.length) return;
    await store.append(JSON.stringify(redact({
      at: new Date().toISOString(), sessionId, turnId, type: 'cards', cards,
    })));
  }

  async function appendResolve({ sessionId, pendingId, decision, out }) {
    if (!sessionId || !pendingId) return;
    await store.append(JSON.stringify(redact({
      at: new Date().toISOString(), sessionId, pendingId, decision, out: out || null,
    })));
  }

  async function bySession(sessionId) {
    const out = [];
    for (const line of await store.all()) {
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      if (rec.sessionId === sessionId) out.push(rec);
    }
    return out;
  }

  return { appendTurn, appendResolve, bySession };
}
