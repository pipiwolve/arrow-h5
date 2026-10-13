// 一轮对话的临界点。页面和新句打断测试共用这一份。
// 新一句先打断上一句的播报，再领取新代号。代号对不上的结果不进入对话。
// 领代号期间又来一句时，旧领取作废，只保留最后一句。

function createTurnGate({ claim, breakTurn }) {
  let turnGen = 0;
  let claimTicket = 0;
  let turnOpening = false;
  let turnBusy = false;
  let turnKind = '';
  let pending = [];

  function stale(gen) {
    return turnOpening || gen !== turnGen;
  }

  async function openTurn(kind) {
    breakTurn();
    turnOpening = true;
    turnBusy = true;
    turnKind = kind;
    const ticket = ++claimTicket;
    try {
      const out = await claim();
      if (ticket !== claimTicket) return 0;
      turnGen = out.turnGen || turnGen + 1;
    } catch {
      if (ticket !== claimTicket) return 0;
      turnGen += 1;
    } finally {
      if (ticket === claimTicket) turnOpening = false;
    }
    return ticket === claimTicket ? turnGen : 0;
  }

  function next() {
    const text = pending.shift();
    return text || '';
  }

  function takeover(text) {
    const value = String(text || '').trim();
    if (!value) return false;
    pending = [value];
    claimTicket += 1;
    turnOpening = false;
    turnBusy = false;
    turnKind = '';
    return true;
  }

  function release(gen) {
    if (gen != null && stale(gen)) return false;
    if (turnKind !== 'room') return false;
    turnBusy = false;
    turnKind = '';
    return true;
  }

  function finishLocal(gen) {
    if (stale(gen)) return false;
    turnBusy = false;
    turnKind = '';
    return true;
  }

  return {
    openTurn,
    release,
    finishLocal,
    takeover,
    next,
    waiting: () => pending.length,
    stale,
    snapshot: () => ({ turnGen, turnBusy, turnKind, turnOpening }),
  };
}

export { createTurnGate };
