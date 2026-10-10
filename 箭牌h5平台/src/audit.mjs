// 审计留痕。需求 3.4：设备控制与场景操作记录操作人、时间、设备与动作。

export function redact(v) {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = /^(authorization|token|api[_-]?key|sk|ak|lickey)$/i.test(k) ? '***' : redact(val);
    }
    return out;
  }
  if (typeof v === 'string') return v.replace(/bearer\s+\S+/gi, 'bearer ***');
  return v;
}

export function createAudit(store) {
  async function append(rec) {
    const line = JSON.stringify(redact({ at: new Date().toISOString(), ...rec }));
    await store.append(line);
    return rec;
  }

  async function tail(n = 100) {
    const lines = await store.tail(n);
    return lines.map((l) => {
      try { return JSON.parse(l); } catch { return { at: '', raw: l }; }
    });
  }

  return { append, tail };
}
