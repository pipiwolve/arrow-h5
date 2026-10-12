// 模型没填 deviceName 时，用设备列表和用户原话收窄到一台。
// 多台都对得上就返回 choices，由页面让用户点。deviceName 只取列表里的值。

const CATEGORY = { '01': '马桶', '04': '浴缸', '06': '镜柜' };
const HINTS = [
  [/坐便器|马桶|大冲|小冲|翻盖|脚触|润瓷/, '01'],
  [/浴缸|进水|放水/, '04'],
  [/镜柜|夜灯/, '06'],
];
// 客户指令集里的说法。长说法放前面，避免「小冲」被「冲水」截走。
const COMMAND_HINTS = [
  [/小冲|小便冲水|冲小/, 'switch_watering_small'],
  [/大冲|冲水|冲一下|^冲$/, 'switch_watering'],
  [/自动翻盖|翻盖/, 'switch_auto_closing'],
  [/脚触感应|脚触/, 'switch_kicking'],
  [/自动润瓷|润瓷/, 'switch_auto_oiling_porcelain'],
  [/夜灯/, 'switch_night_light'],
  [/进水|放水/, 'switch_water_in'],
];

export function narrowDevices({ devices, live, userText, cmd }) {
  const rows = Array.isArray(live?.rows) && live.rows.length ? live.rows : devices;
  const text = String(userText || '');
  const room = /主卫/.test(text) ? '主卫' : /客卫/.test(text) ? '客卫' : '';
  const hinted = HINTS.find(([re]) => re.test(text))?.[1] || '';
  const specCategory = cmd ? categoryFor(cmd, devices) : '';
  const category = hinted || specCategory;
  const capable = new Set(
    cmd ? rows.filter((row) => {
      const known = devices.find((d) => d.deviceName === row.deviceName) || row;
      return Array.isArray(known.capability) && known.capability.includes(cmd);
    }).map((row) => row.deviceName) : [],
  );
  const matched = rows.filter((row) => {
    const known = devices.find((d) => d.deviceName === row.deviceName) || row;
    if (room && known.room && known.room !== room) return false;
    if (category && known.categoryCode && known.categoryCode !== category) return false;
    if (cmd && capable.size && Array.isArray(known.capability) && !known.capability.includes(cmd)) return false;
    return true;
  });
  return matched.map((row) => {
    const known = devices.find((d) => d.deviceName === row.deviceName) || {};
    return {
      deviceName: row.deviceName,
      deviceTagName: row.deviceTagName || known.deviceTagName || '',
      room: known.room || '',
      category: CATEGORY[row.categoryCode || known.categoryCode] || '',
      onlineStatus: row.onlineStatus ? 1 : 0,
    };
  });
}

function categoryFor(cmd, devices) {
  const codes = new Set(
    devices.filter((d) => (d.capability || []).includes(cmd)).map((d) => d.categoryCode),
  );
  return codes.size === 1 ? [...codes][0] : '';
}

/** 模型填了不在这户设备里的名字时，丢掉，改由原话重新匹配。 */
export function trustedName(name, devices) {
  const value = String(name || '');
  return devices.some((d) => d.deviceName === value) ? value : '';
}

/** 只补空着或不在清单里的 deviceName。清单里已有的不改。 */
export function fillTargets(list, deviceName, devices) {
  return (list || []).map((item) => (
    item && trustedName(item.deviceName, devices || []) ? item : { ...item, deviceName }
  ));
}

export function commandFromText(text, commands) {
  const known = new Set((commands || []).map((c) => c.cmd));
  const cmd = COMMAND_HINTS.find(([re]) => re.test(String(text || '')))?.[1] || '';
  return known.has(cmd) ? cmd : '';
}

export function valueFromText(text) {
  const src = String(text || '');
  if (/关闭|关掉|关上|关了|停用|别/.test(src)) return 'off';
  if (/大冲|小冲|冲水|冲一下|^冲$|冲小|翻盖|脚触|润瓷|夜灯|进水|放水|打开|开启|开一下|启动|启用|开始/.test(src)) return 'on';
  return '';
}

/** 补空着的 cmd、param、value。模型已经填了的不改，对不上的留空给闸门拒绝。 */
export function completeItem(item, userText, commands) {
  if (!item) return item;
  const next = { ...item };
  if (!next.cmd) next.cmd = commandFromText(userText, commands);
  if (!next.param) next.param = 'switch';
  if (!next.value) next.value = valueFromText(userText);
  return next;
}

export function completeList(list, userText, commands) {
  return (list || []).map((item) => completeItem(item, userText, commands));
}
