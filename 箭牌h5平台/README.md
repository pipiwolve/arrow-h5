# 箭牌智家 · BRTC H5 平台版

Domestic Agent API 那条链路要求偏高。这一版改走百度智能云 BRTC 互动智能体的 H5 通道，业务模块仍对齐箭牌需求：设备控制、场景、报修引导、安全闸门、审计。

官方示例在 `../BRTC.Agent.H5.SDK.V1.0.10`。它把 AK/SK 放进浏览器去调 `generateAIAgentCall`。这里不这么做。鉴权激活对齐唯创那套服务端建实例：密钥留在 Node，页面只拿进房参数。

## 和 Agent API demo 的分工

| 模块 | Agent API demo（`箭牌demo打通`） | 本目录 |
| --- | --- | --- |
| 听和说 | 半双工，百度短语音，按住才转写 | 进页自动建连。开场白由 `tts_sayhi` 播报并写入对话。打字用 `[T]` 发送。按住说话在本地转写，识别完成后直接以 `[T]` 发送 |
| 智能体 | DuMate Agent，要建会话、挂技能、收文件 | BRTC 互动实例，`role` 写进人设 |
| 授权 | DuMate API Key | AppID + AK/SK 建实例，lickey 激活 |
| 能不能控设备 | 本地闸门 + 箭牌 IoT | 同一套闸门和 IoT 客户端 |
| 技能 / 产物 / 知识库文件 | 有 | 这一版没有。BRTC 通道不提供那三个平台对象 |

未搬过来的是 FR-04 多智能体，以及 Agent API 上的技能库和产物中心。需求里的设备、场景、报修、闸门、审计先落在这个骨架上。

## 目录

```
config/scenario.json    人设、指令表、风险、报修地址
scenario.mjs            读配置，设备清单指向 ../箭牌demo打通/iot/
src/aiagent.mjs         建实例、停实例、拼 LIC ACTIVE
src/session.mjs         一次通话：进房参数与激活状态
src/frames.mjs          字幕帧分类，从回答里摘 iot 块
src/policy.mjs          安全闸门
src/turn.mjs            放行后下发，高危等确认
src/iot-client.mjs      设备列表 / 控制 / 建场景
src/audit.mjs           审计
src/journal.mjs         闸门卡回放
server.mjs              HTTP
public/                 通话、设备、审计三个视图
```

## 鉴权怎么走

1. `POST /api/session` 在服务端调用 `https://rtc-aiagent.baidubce.com` 的 `generateAIAgentCall`，用 AK/SK 做 BCE v3 签名。示例网关 `ai.agent.kaywang.cn` 对这个 AppID 会回 `No such app`。
2. 建实例不传 `sceneRoleCfg`。人设用百度控制台绑定到这个 AppID 的自定义角色。角色名称不要用「箭牌智家助手」，它和预置角色重名。
3. 响应里的 `token`、`uid`、实例 ID 交给页面，页面用官方 `BRTC_Start` 进房。
4. 网关推 `[E]:[LIC]:[MUST]`。页面把原文交给 `POST /api/session/lic`。
5. 服务端用固定 `BRTC_DEVID` 和 `BRTC_LICKEY` 拼 `[E]:[LIC]:[ACTIVE]`，页面原样发回数据通道。
6. `[E]:[LIC]:[RES]:[PASS]` 之后才处理字幕。

`BRTC_DEVID` 不要每次换。激活按 licenseKey + appId + deviceId 计次，换号会反复消耗额度。

## 一轮对话

```
用户说话 → SDK 字幕 [Q] / [A]，或意图 [F]
        → POST /api/frame
        → [F] 收成动作；[A] 里没有意图时再摘 iot JSON
        → 闸门：M 放行，H 等确认，C 与校验失败拒绝
        → 放行才打箭牌 IoT
        → [F] 用固定文本回执，页面发回数据通道
        → 审计追加一行
```

页面发出的文字和快捷句只画一次。房间把同一句作为 `[Q]` 送回来时，更新这一条，不再追加。流式 `[A]:[M]` 也写在同一条助手气泡上。开场白只保留 `tts_sayhi` 推回的那一条，页面不再预写同一句。

设备清单仍附在操作类 `[T]` 后面，供模型逐字选用 deviceName 和指令。房间会把整段 `[T]` 以 `[Q]` 回放。清单从「【家庭设备】」起不是用户说的话，用户气泡在这一标记处截断；已经按原话画过的那一条只更新，不再追加。模型若把清单照抄进 `[A]`，助手气泡同样从这一标记截断；截完只剩用户原话时，这一条助手气泡不显示。

按住说话不走房间。BRTC 按键模式在 `ASR_STOP_LONGTEXT_REC` 之后会把转写直接送进模型，页面拦不住。浏览器本地采集 16k PCM，`POST /api/asr` 调百度短语音。识别出文字后直接以 `[T]` 发送，不再停在输入框等确认。房间麦克风保持静音，授权通过后仍发 `[E]:[CMD]:[ASR_DISABLE_REALTIME]`，避免房间自己把这段语音送进对话。`ASR_API_KEY` 写在本目录 `.env`；没写时沿用 `箭牌demo打通` 的同一把。

IoT 下发优先走控制台意图，`callMode` 选 SDK 消息。需要三个：`control_device`（deviceName、cmd、param、value）、`create_scene`（conditionList、actionList，内容是 JSON 字符串）、`open_repair`（kind 取 report 或 progress）。意图没配上时，人设仍要求回答末尾给一个 `iot` 代码块。块进不了闸门就不会下发。

平台 HTTP 200 且 body 为「设备离线」时，审计记 FAILED。设备没有执行。

## 跑起来

```bash
cd 箭牌h5平台
cp .env.example .env
# 填 BRTC_APPID / BRTC_AK / BRTC_SK / BRTC_LICKEY
npm start
```

打开 `http://127.0.0.1:8900`。四件套齐了就自动建连。授权通过后，开场白由 `tts_sayhi` 播报并作为一条 `[A]` 写入对话。没配齐时输入框保持关闭。按住说话在本地转写，识别完成后直接发送。

窄屏（760px 以下，手机浏览器）改成上栏：标志在左，通话、设备、审计在右。对话区占满剩余高度，输入栏贴在底部并让出安全区。输入字号 16px，避免 iOS 聚焦时放大页面。按住麦克风用指针捕获，手指移出按钮再松开也会结束录音。键盘弹出时用 `visualViewport` 把输入栏抬到键盘上方。桌面宽度仍是左侧导航。

IoT 默认 `real`，打箭牌 UAT `https://api-uatiot.arrowgroup.com.cn`，凭证与 `箭牌demo打通` 的 `.env` 相同。设备列表、控制、建场景走接口文档的三个地址。设备号和在线状态不写进人设，只在用户要操作设备的那一轮附在文字后面。`IOT_MODE=mock` 才起本地网关 `127.0.0.1:18901`。

## 这一版还没接上的

- 真实 BRTC 房间的端到端联调。四件套到位后才能验进房和 LIC PASS。
- 控制台意图。三个 Function 要在「大模型实时互动」里建好并绑到这个 AppID，否则模型只能靠回答末尾的 iot 代码块。
- 产品百科走控制台知识库意图模板。本地不挂知识文件。
- 场景查询。平台没有查场景接口，设备页目前只列设备。
