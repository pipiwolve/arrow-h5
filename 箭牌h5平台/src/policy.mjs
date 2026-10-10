// 安全闸门。与箭牌 Agent API demo 同一套四道检查：
//   意图边界 → 参数合法性 → 家庭归属 → 风险分级。
// 模型只说想做什么。能不能下发由这里决定。

import crypto from 'node:crypto';

const ORDER = { L: 0, M: 1, H: 2, C: 3 };
const REJECTED = 'X';
const ACTIONS = new Set(['device.control', 'scene.create', 'repair.open']);

export function createGate({ scenario, devices }) {
  const byName = new Map(devices.map((d) => [d.deviceName, d]));
  const commands = new Map(scenario.commands.map((c) => [c.cmd, c]));
  const { homeId } = scenario.iot;
  const { maxTargetsPerCall, defaultRiskLevel } = scenario.policy;
  const pending = new Map();
  const TTL_MS = 5 * 60 * 1000;

  function riskOf(item) {
    for (const rule of scenario.riskRules) {
      const hit = Object.entries(rule.when).every(([k, v]) => item[k] === v);
      if (hit) return rule;
    }
    return { level: defaultRiskLevel, label: '默认等级', basis: '未命中任何高危规则' };
  }

  function inspect(item) {
    if (!item || typeof item !== 'object') throw new Error('指令项不是对象');
    for (const f of ['deviceName', 'cmd', 'param', 'value']) {
      if (item[f] === undefined || item[f] === null || item[f] === '') {
        throw new Error(`指令项缺少 ${f} 字段`);
      }
    }
    const dev = byName.get(item.deviceName);
    if (!dev) throw new Error(`设备不在该家庭：${item.deviceName}`);
    const spec = commands.get(item.cmd);
    if (!spec) throw new Error(`指令不在指令表内：${item.cmd}`);
    if (!spec.appliesTo.includes(dev.categoryCode)) {
      throw new Error(`${dev.deviceTagName} 不支持指令 ${item.cmd}`);
    }
    const allowed = spec.params[item.param];
    if (!allowed) throw new Error(`指令 ${item.cmd} 没有参数 ${item.param}`);
    if (!allowed.includes(String(item.value))) {
      throw new Error(`参数值非法：${item.param}=${item.value}，可选 ${allowed.join('/')}`);
    }
    return { ...riskOf(item), spec, device: dev };
  }

  function evaluate(action, { dryRun = false } = {}) {
    if (!ACTIONS.has(action?.action)) {
      return { decision: 'deny', level: REJECTED, reasons: [`未授权的动作类型：${action?.action}`] };
    }
    if (Number(action.homeId ?? homeId) !== Number(homeId)) {
      return { decision: 'deny', level: REJECTED, reasons: [`homeId 不匹配：${action.homeId}`] };
    }
    const act = { ...action, homeId: Number(homeId) };

    if (action.action === 'repair.open') {
      return {
        decision: 'allow', level: 'L', action: act,
        reasons: ['报修引导：只返回 deeplink，不下发任何设备指令'], items: [],
      };
    }

    const isScene = action.action === 'scene.create';
    const conds = isScene ? action.conditionList || [] : [];
    const acts = isScene ? action.actionList || [] : action.targets || [];
    if (!acts.length) return { decision: 'deny', level: REJECTED, action: act, reasons: ['动作列表为空'] };
    if (acts.length > maxTargetsPerCall) {
      return {
        decision: 'deny', level: REJECTED, action: act,
        reasons: [`一次操作涉及 ${acts.length} 台设备，超过阈值 ${maxTargetsPerCall} 台`],
      };
    }

    let level = 'L';
    const items = [];
    const reasons = [];
    const groups = isScene ? [['场景触发条件', conds], ['场景执行动作', acts]] : [['设备指令', acts]];
    for (const [groupName, list] of groups) {
      for (const item of list) {
        let info;
        try { info = inspect(item); } catch (e) {
          return { decision: 'deny', level: REJECTED, action: act, reasons: [`${groupName}校验未过：${e.message}`] };
        }
        if (ORDER[info.level] > ORDER[level]) level = info.level;
        if (info.level === 'H') reasons.push(`${info.label}（${info.basis}）`);
        items.push({
          ...item, group: groupName, level: info.level, label: info.label,
          deviceTagName: info.device.deviceTagName, room: info.device.room || '',
        });
      }
    }

    const { confirmAtOrAbove, denyAtOrAbove } = scenario.policy;
    const reasons2 = [...new Set(reasons)];
    if (ORDER[level] >= ORDER[denyAtOrAbove]) {
      return { decision: 'deny', level, action: act, reasons: reasons2.length ? reasons2 : ['触发严重级拦截'] };
    }
    if (ORDER[level] >= ORDER[confirmAtOrAbove]) {
      if (dryRun) return { decision: 'confirm', level, action: act, reasons: reasons2, items, dryRun: true };
      const pendingId = 'pa_' + crypto.randomBytes(5).toString('hex');
      pending.set(pendingId, {
        id: pendingId, action: act, level, reasons: reasons2, items,
        createdAt: Date.now(), status: 'PENDING',
      });
      return { decision: 'confirm', level, action: act, reasons: reasons2, items, pendingId };
    }
    return {
      decision: 'allow', level, action: act, items,
      reasons: reasons2.length ? reasons2 : [`${level} 级操作，闸门放行`],
    };
  }

  function claim(pendingId) {
    const rec = pending.get(pendingId);
    if (!rec) return { ok: false, error: '待确认动作不存在或已被处理' };
    if (rec.status !== 'PENDING') return { ok: false, error: `动作已是 ${rec.status}` };
    if (Date.now() - rec.createdAt > TTL_MS) {
      rec.status = 'EXPIRED';
      return { ok: false, error: '确认已超时，请重新发起' };
    }
    rec.status = 'EXECUTING';
    return { ok: true, rec };
  }

  function settle(pendingId, status) {
    const rec = pending.get(pendingId);
    if (rec) rec.status = status;
  }

  function reject(pendingId) {
    const rec = pending.get(pendingId);
    if (!rec) return { ok: false, error: '待确认动作不存在' };
    if (rec.status !== 'PENDING') return { ok: false, error: `动作已是 ${rec.status}` };
    rec.status = 'REJECTED';
    return { ok: true, rec };
  }

  return { evaluate, claim, settle, reject };
}
