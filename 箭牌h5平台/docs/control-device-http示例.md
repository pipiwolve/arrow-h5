# control_device 两种出口

控制台里的 Function 表两边相同。名称、描述、例句、五个参数、样例槽位都不用改。唯一要改的是「请求地址」。

下面用控制台样例的同一句对照：**帮我把主卫坐便器的大冲打开**。

## 两边相同的配置

| 项 | 当前值 |
| --- | --- |
| Function 名称 | `control_device` |
| Function 描述 | 控制一台已接入的卫浴设备。用户要立刻开、关、冲水、进水时调用 |
| 执行前确认 | 否 |
| 是否定时执行 | 否 |

| 参数名 | 类型 | 必填 | 参数描述 |
| --- | --- | --- | --- |
| deviceName | String | 是 | 从用户这句话和【家庭设备】里选定唯一一台，逐字复制 deviceName。多台都可能命中时不要调用，先问是哪一台 |
| cmd | String | 是 | `switch_watering`、`switch_watering_small`、`switch_night_light`、`switch_auto_closing`、`switch_kicking`、`switch_auto_oiling_porcelain`、`switch_onoff`、`switch_water_in` |
| param | String | 否 | 固定填 `switch` |
| value | String | 是 | `on` 或 `off`。打开填 `on`，关闭、关掉、停用填 `off`。大冲和小冲只能填 `on` |
| say | String | 否 | 用一句话告诉用户准备做什么。不要向用户索要参数名 |

这一句填出的槽位：

```json
{
  "deviceName": "ARROW01179421020631",
  "cmd": "switch_watering",
  "param": "switch",
  "value": "on",
  "say": "准备冲水"
}
```

`say` 只给播报。箭牌 IoT 只要前四个字段。

## 只改请求地址

| | 发送 SDK 消息（当前） | HTTP |
| --- | --- | --- |
| 控制台请求地址 | 发送 SDK 消息 | `https://用户侧公网域名/ai/control-device` |
| 谁先拿到槽位 | 浏览器里的 H5 | 百度云端直接打到用户侧 |
| 经不经本地 H5 | 经。页面把 `[F]` 交给 `POST /api/frame` | 不经 |
| 谁打箭牌 IoT | 本机 `src/iot-client.mjs` | 用户侧服务 |
| 地址要求 | 不需要公网回调 | 必须是百度云端能访问的 HTTPS。`127.0.0.1` 和内网打不到 |

## SDK 消息：当前这条

模型填完槽后，房间数据通道推一帧。`content` 是字符串，本机 `parseFunction` 会再解析一次。

```text
[F]:{
  "session_id": "1754555833139",
  "content": "{\"function_name\":\"control_device\",\"parameter_list\":[{\"deviceName\":\"ARROW01179421020631\",\"cmd\":\"switch_watering\",\"param\":\"switch\",\"value\":\"on\",\"say\":\"准备冲水\"}]}"
}
```

H5 收成内部动作，再由本机打 IoT：

```json
{
  "action": "device.control",
  "targets": [
    {
      "deviceName": "ARROW01179421020631",
      "cmd": "switch_watering",
      "param": "switch",
      "value": "on"
    }
  ],
  "say": "准备冲水"
}
```

本机闸门对照 `config/scenario.json`。大冲是 M 级，选中唯一一台后直接下发。浴缸进水是 H 级，页面确认后才发。多台命中时页面出选择卡，这一帧不会直接打到平台。

下发成功后，页面把结果发回数据通道。`post_function` 用来固定播报：

```text
[F]:{
  "session_id": "1754555833139",
  "result": "ok",
  "message": "平台已受理。",
  "post_function": [{ "type": "text", "content": "平台已受理。" }]
}
```

审计记在本机 `audit.jsonl`。

## HTTP：同一槽位，云端直达用户侧

请求地址改成 HTTP 后，百度云端 POST 下面这份内容。不进 H5，也没有 `[F]` 帧。外壳字段以控制台实际回调为准；槽位和 SDK 模式是同一份。

```http
POST /ai/control-device HTTP/1.1
Host: 用户侧公网域名
Content-Type: application/json

{
  "session_id": "1754555833139",
  "content": {
    "function_name": "control_device",
    "parameter_list": [
      {
        "deviceName": "ARROW01179421020631",
        "cmd": "switch_watering",
        "param": "switch",
        "value": "on",
        "say": "准备冲水"
      }
    ]
  }
}
```

用户侧自己再打箭牌 UAT。这一条和本机现在发的相同，`say` 不要放进去：

```http
POST /ext/v3/ai/control HTTP/1.1
Host: api-uatiot.arrowgroup.com.cn
Authorization: bearer <IOT_TOKEN>
appPlatform: arrow
Accept: application/json
ArrowDeviceSystemPlatform: 0
Content-Type: application/json

{
  "homeId": 933,
  "cmdList": [
    {
      "deviceName": "ARROW01179421020631",
      "cmd": "switch_watering",
      "param": "switch",
      "value": "on"
    }
  ]
}
```

箭牌返回：

```json
{ "success": true, "code": 200, "msg": "OK", "data": null }
```

设备离线时 HTTP 仍是 200，业务结果在 body 里：

```json
{ "success": false, "code": 500, "msg": "设备离线", "data": null }
```

`code` 为 `200` 或 `10000`，且 `success` 不为 `false`，才算受理。

用户侧把结果回给百度，供模型播报：

```json
{ "result": "ok", "message": "平台已受理。" }
```

```json
{ "result": "error", "message": "设备当前离线，指令已送到平台，这一次没有执行。" }
```

这条路没有本机闸门。多台设备选择、高危确认、`audit.jsonl` 都不会发生，除非用户侧服务自己做。模型填错的 `deviceName` 或 `cmd` 会直接到达箭牌平台。

## 对照

| | SDK 消息 | HTTP |
| --- | --- | --- |
| 控制台除请求地址外 | 相同 | 相同 |
| 槽位 | 上面那五个字段 | 上面那五个字段 |
| 报文外壳 | 数据通道 `[F]`，`content` 常为字符串 | 云端 `POST` JSON |
| 本机入口 | `POST /api/frame` | 无 |
| IoT 报文 | `{ homeId, cmdList }` | `{ homeId, cmdList }` |
| 回执 | 再发一帧 `[F]`，可带 `post_function` | HTTP 响应 JSON |
| 页面选择卡、确认卡 | 有 | 无 |
| 审计 | 本机 `audit.jsonl` | 用户侧自己记 |
