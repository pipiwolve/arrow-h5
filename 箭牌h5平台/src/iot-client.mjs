// 箭牌 IoT 网关客户端。三个接口与 Agent API demo 相同。

export function createIotClient({ baseUrl, token, appPlatform, deviceSystemPlatform }) {
  async function call(method, p, { query, body } = {}) {
    const url = new URL(p, baseUrl);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));

    const headers = {
      Authorization: `bearer ${token}`,
      appPlatform,
      Accept: 'application/json',
    };
    if (deviceSystemPlatform !== undefined && deviceSystemPlatform !== null) {
      headers.ArrowDeviceSystemPlatform = String(deviceSystemPlatform);
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const started = Date.now();
    let res, text;
    try {
      res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      text = await res.text();
    } catch (e) {
      return { ok: false, ms: Date.now() - started, request: { method, url: url.href, body }, error: `网关不可达：${e.message}` };
    }

    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = null; }

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false, ms: Date.now() - started,
        request: { method, url: url.href, headers, body },
        response: parsed ?? text.slice(0, 500),
        error: `鉴权失败 HTTP ${res.status}：token 无效或已过期`,
      };
    }

    return {
      ok: res.ok,
      httpStatus: res.status,
      ms: Date.now() - started,
      request: { method, url: url.href, headers, body },
      response: parsed ?? text.slice(0, 500),
      error: res.ok ? null : `HTTP ${res.status}`,
    };
  }

  return {
    deviceList: (homeId) => call('GET', '/ext/v3/ai/device-list', { query: { homeId } }),
    control: (homeId, cmdList) => call('POST', '/ext/v3/ai/control', { body: { homeId, cmdList } }),
    createScene: (homeId, conditionList, actionList) => call('POST', '/ext/v3/ai/scene', { body: { homeId, conditionList, actionList } }),
  };
}
