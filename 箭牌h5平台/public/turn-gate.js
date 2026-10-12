// 一轮对话的临界点。页面和新句打断测试共用这一份。
// 新一句先打断上一句的播报，再领取新代号。代号对不上的结果不进入对话。

function createTurnGate({ claim, breakTurn }) {
  let turnGen = 0;
  let turnOpening = false;
  let turnBusy = false;
  let turnKind = '';

  function stale(gen) {
    return turnOpening || gen !== turnGen;
  }

  async function openTurn(kind) {
    breakTurn();
    turnOpening = true;
    turnBusy = true;
    turnKind = kind;
    try {
      const out = await claim();
      turnGen = out.turnGen || turnGen + 1;
    } catch {
      turnGen += 1;
    } finally {
      turnOpening = false;
    }
    return turnGen;
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
    stale,
    snapshot: () => ({ turnGen, turnBusy, turnKind, turnOpening }),
  };
}

export { createTurnGate };
