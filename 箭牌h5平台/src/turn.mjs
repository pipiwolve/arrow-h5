// 一轮字幕收尾：从回答里取动作，过闸门，放行的才打到 IoT。
// 高危动作停在待确认，等 /api/confirm。

import { completeList, fillTargets, narrowDevices } from './resolve.mjs';

export function createTurn({ scenario, devices, gate, iot, audit, liveDevices }) {
  function execControl(rec) {
    const cmdList = rec.items.map(({ deviceName, cmd, param, value }) => ({ deviceName, cmd, param, value }));
    return iot.control(scenario.iot.homeId, cmdList);
  }

  function execScene(rec) {
    const pick = (i) => ({
      deviceName: i.deviceName, cmd: i.cmd, param: i.param, value: i.value,
      ...(i.time ? { time: i.time } : {}),
    });
    return iot.createScene(
      scenario.iot.homeId,
      (rec.action.conditionList || []).map(pick),
      (rec.action.actionList || []).map(pick),
    );
  }

  async function execute(rec, { trigger, actor = 'app-user', sessionId }) {
    const isScene = rec.action.action === 'scene.create';
    const res = isScene ? await execScene(rec) : await execControl(rec);
    const body = res.response && typeof res.response === 'object' ? res.response : null;
    const accepted = !!res.ok && !!body
      && body.success !== false
      && (body.code === undefined || body.code === 200 || body.code === 10000);
    const source = isScene
      ? [...(rec.action.conditionList || []), ...(rec.action.actionList || [])]
      : rec.action.targets || [];
    const targets = source.map((t) => {
      const dev = devices.find((d) => d.deviceName === t.deviceName) || {};
      return {
        deviceName: t.deviceName, deviceTagName: dev.deviceTagName || '',
        room: dev.room || '', cmd: t.cmd, param: t.param, value: t.value,
      };
    });
    const entry = {
      kind: isScene ? 'scene.create' : 'device.control',
      actor, sessionId, homeId: scenario.iot.homeId,
      level: rec.level, reasons: rec.reasons, decision: 'EXECUTED', trigger, targets,
      iotRequest: res.request, iotResponse: res.response,
      result: accepted ? 'SUCCEEDED' : 'FAILED',
      httpStatus: res.httpStatus ?? null, error: res.error || null, ms: res.ms,
    };
    await audit.append(entry);
    return { ...entry, ok: accepted };
  }

  function receipt(card) {
    const data = card?.data || {};
    if (card?.event === 'demo.repair') return data.note || '已给出报修入口。';
    if (card?.event !== 'demo.result') return '';
    const body = data.iotResponse && typeof data.iotResponse === 'object' ? data.iotResponse : null;
    const msg = body?.msg || body?.message || data.error || '';
    const accepted = body && (body.code === 200 || body.code === 10000) && body.success !== false;
    if (accepted) return '平台已受理。';
    if (/设备离线/.test(msg)) return '平台返回设备离线，这一次没有执行。';
    return msg ? `平台返回：${msg}` : '平台没有受理。';
  }

  /**
   * @param {{sessionId: string, action: object|null, userText?: string}} input
   * @returns 给前端渲染的卡片列表
   */
  async function finish(input) {
    const { sessionId, action } = input;
    const cards = [];
    if (!action) return { cards };

    if (action.action === 'repair.open') {
      const which = action.kind === 'progress' ? 'progress' : 'report';
      const deeplink = scenario.repair.deeplink[which];
      await audit.append({
        kind: 'repair.open', actor: 'app-user', sessionId, level: 'L',
        decision: 'ALLOW', result: 'SUCCEEDED', deeplink,
      });
      cards.push({
        event: 'demo.repair',
        data: {
          kind: which,
          deeplink,
          title: scenario.repair.cardTitle || '报修',
          body: scenario.repair.cardBody || scenario.repair.note,
          note: scenario.repair.note,
          say: action.say || '',
        },
      });
      return { cards, receipt: scenario.repair.note };
    }

    const completed = completeAction(action, input.userText);
    const chosen = await chooseDevice(completed, input.userText);
    if (chosen.choices) {
      cards.push({
        event: 'demo.choose',
        data: { action: chosen.action, choices: chosen.choices, say: '有多台设备符合，选一台再下发。' },
      });
      return { cards, spoken: '有多台设备符合，选一台再下发。' };
    }
    const verdict = gate.evaluate(chosen.action);
    cards.push({
      event: 'demo.gate',
      data: {
        decision: verdict.decision, level: verdict.level,
        reasons: verdict.reasons, pendingId: verdict.pendingId || null,
        say: action.say || '',
      },
    });
    if (verdict.decision === 'allow') {
      const out = await execute(verdict, { trigger: 'auto', sessionId });
      cards.push({ event: 'demo.result', data: out });
    }
    const last = cards[cards.length - 1];
    const line = (action.say || '').trim();
    return { cards, verdict, receipt: receipt(last), spoken: line || receipt(last) };
  }

  function completeAction(action, userText) {
    const commands = scenario.commands;
    if (action.action === 'device.control') {
      return { ...action, targets: completeList(action.targets, userText, commands) };
    }
    if (action.action === 'scene.create') {
      return {
        ...action,
        conditionList: completeList(action.conditionList, userText, commands),
        actionList: completeList(action.actionList, userText, commands),
      };
    }
    return action;
  }

  async function chooseDevice(action, userText) {
    const lists = action.action === 'scene.create'
      ? [action.actionList]
      : action.action === 'device.control' ? [action.targets] : [];
    const missing = lists.flat().some((item) => item && !item.deviceName);
    if (!missing) return { action };
    const live = liveDevices ? await liveDevices(false) : { rows: [] };
    const cmd = lists.flat().find((item) => item?.cmd)?.cmd || '';
    const choices = narrowDevices({ devices, live, userText, cmd });
    if (choices.length === 1) {
      const name = choices[0].deviceName;
      return {
        action: {
          ...action,
          targets: fillTargets(action.targets, name),
          actionList: fillTargets(action.actionList, name),
        },
      };
    }
    if (choices.length > 1) return { action, choices };
    return { action };
  }

  async function confirm({ sessionId, pendingId, decision }) {
    if (decision === 'cancel') {
      const rejected = gate.reject(pendingId);
      if (!rejected.ok) return { ok: false, error: rejected.error };
      await audit.append({
        kind: rejected.rec.action.action, actor: 'app-user', sessionId,
        level: rejected.rec.level, decision: 'REJECTED', pendingId, result: 'CANCELLED',
      });
      return { ok: true, cards: [{ event: 'demo.gate', data: { decision: 'cancel', pendingId, level: rejected.rec.level } }] };
    }
    const claimed = gate.claim(pendingId);
    if (!claimed.ok) return { ok: false, error: claimed.error };
    const out = await execute(claimed.rec, { trigger: 'confirm', sessionId });
    gate.settle(pendingId, out.ok ? 'SUCCEEDED' : 'FAILED');
    return { ok: true, cards: [{ event: 'demo.result', data: out }] };
  }

  return { finish, confirm, execute, chooseDevice };
}
