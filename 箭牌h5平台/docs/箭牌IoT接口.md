# 当前支持的箭牌 IoT 接口

当前环境是箭牌 UAT：

```text
https://api-uatiot.arrowgroup.com.cn
```

H5 服务端调用这三个接口。浏览器只访问 H5 自己的 `/api/choose`、`/api/confirm`，不会直接请求下面的地址。当前家庭编号是 `933`。

## 公共请求头

| 名称 | 当前值 |
| --- | --- |
| Authorization | `bearer <IOT_TOKEN>` |
| appPlatform | `arrow` |
| Accept | `application/json` |
| ArrowDeviceSystemPlatform | `0` |
| Content-Type | `application/json`，仅 POST 请求携带 |

`401` 或 `403` 表示 token 无效或已过期。

平台返回 HTTP 200 只表示接口可达。业务是否成功看 JSON 里的 `code` 和 `success`。`code` 为 `500` 且 `msg` 为「设备离线」时，指令已到达平台，但设备没有执行。

## 1. 查询设备

```http
GET /ext/v3/ai/device-list?homeId=933
```

H5 在打开页面的设备页，以及处理设备指令前，用这个接口读取设备号、房间、名称和在线状态。

## 2. 下发设备指令

```http
POST /ext/v3/ai/control
```

```json
{
  "homeId": 933,
  "cmdList": [
    {
      "deviceName": "ARROWToilet17419421020631",
      "cmd": "switch_watering",
      "param": "switch",
      "value": "on"
    }
  ]
}
```

| 字段 | 含义 |
| --- | --- |
| homeId | 家庭编号 |
| deviceName | 平台设备号，必须与设备列表中的值一致 |
| cmd | 指令名 |
| param | 指令参数名 |
| value | 参数值 |

当前实际下发过的一条是主卫 AKB1332-P 智能坐便器的大冲：`switch_watering`，`switch=on`。平台返回：

```json
{
  "success": false,
  "code": 500,
  "msg": "设备离线",
  "data": null
}
```

中风险指令选中唯一设备后直接调用这个接口。高风险指令先在页面确认，确认后才调用。

## 3. 创建场景

```http
POST /ext/v3/ai/scene
```

```json
{
  "homeId": 933,
  "conditionList": [],
  "actionList": []
}
```

`conditionList` 是触发条件，`actionList` 是要执行的设备动作。H5 已接入这个接口，但当前开场示例里没有定时场景。

## 不走 IoT 的操作

报修只打开 `arrowhome://repair/create?from=ai_assistant`，不调用上述三个接口，也不创建工单。产品问答和闲聊只进入 BRTC 房间。
