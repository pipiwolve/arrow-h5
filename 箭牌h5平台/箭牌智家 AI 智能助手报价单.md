---
title: "箭牌智家 AI 智能助手报价单"
type: note
project: 箭牌
date: 2026-10-13
tags:
  - 报价
  - 箭牌
  - BRTC
status: draft
summary: "箭牌智家 AI 智能助手报价：前期开发与技术支持 10 万元，链路 0.05 元/分钟。方案基于百度全栈自研与 RTC 架构，端侧处理常规交互，复杂任务经意图识别路由至 DuMate Agent。"
---

## 一、智能搭建建议报价清单

<table border="1" cellpadding="8" cellspacing="0" width="100%">
  <thead>
    <tr>
      <th>序号</th>
      <th>服务</th>
      <th>配置</th>
      <th>数量</th>
      <th>单位</th>
      <th>单价</th>
      <th>小计</th>
      <th>备注</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center">1</td>
      <td>前期开发与技术支持</td>
      <td>智能体搭建、业务打通、测试与上线</td>
      <td align="center">1</td>
      <td align="center">项</td>
      <td align="right">100,000 元</td>
      <td align="right">100,000 元</td>
      <td>内容见以下分项</td>
    </tr>
    <tr>
      <td align="center">2</td>
      <td>链路使用</td>
      <td>ASR、TTS、大模型 Token、知识库。支持 1,000 路并发</td>
      <td align="center">按实际</td>
      <td align="center">分钟</td>
      <td align="right">0.05 元</td>
      <td align="center">按实际结算</td>
      <td>含 50 个知识库、50 种品类、50 个文件，容量上限 500 MB</td>
    </tr>
  </tbody>
</table>

## 二、智能体搭建

<table border="1" cellpadding="8" cellspacing="0" width="100%">
  <thead>
    <tr>
      <th width="22%">项目</th>
      <th>内容</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>产品知识问答</td>
      <td>接入知识库检索，配置文档切片与检索策略，编排问答流程和超范围兜底</td>
    </tr>
    <tr>
      <td>设备语音控制</td>
      <td>编排语音指令到设备动作的控制逻辑，区分多设备目标</td>
    </tr>
    <tr>
      <td>场景创建</td>
      <td>按条件与动作编排场景，支持语音触发</td>
    </tr>
    <tr>
      <td>一句话报修</td>
      <td>从用户描述中抽取故障信息，生成结构化报修内容</td>
    </tr>
  </tbody>
</table>

## 三、业务打通

<table border="1" cellpadding="8" cellspacing="0" width="100%">
  <thead>
    <tr>
      <th width="22%">项目</th>
      <th>内容</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>设备控制</td>
      <td>对接 IoT 设备控制接口，完成语音指令到设备执行的联调</td>
    </tr>
    <tr>
      <td>售后工单</td>
      <td>对接售后工单接口，把结构化报修内容送入工单流转</td>
    </tr>
  </tbody>
</table>

## 四、测试

<table border="1" cellpadding="8" cellspacing="0" width="100%">
  <thead>
    <tr>
      <th width="22%">项目</th>
      <th>内容</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>知识问答</td>
      <td>问答准确率，以及超出知识库范围时的兜底</td>
    </tr>
    <tr>
      <td>设备语音控制</td>
      <td>指令识别与多设备消歧</td>
    </tr>
    <tr>
      <td>场景创建</td>
      <td>场景是否按编排触发并执行</td>
    </tr>
    <tr>
      <td>一句话报修</td>
      <td>故障信息抽取与工单生成</td>
    </tr>
    <tr>
      <td>实时语音</td>
      <td>全双工对话、语音打断与静音识别</td>
    </tr>
    <tr>
      <td>主路径联调</td>
      <td>问答、控制、报修三条路径的联调，以及问题修复后的回归</td>
    </tr>
  </tbody>
</table>

## 五、上线

<table border="1" cellpadding="8" cellspacing="0" width="100%">
  <thead>
    <tr>
      <th width="22%">项目</th>
      <th>内容</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>生产部署</td>
      <td>生产环境部署、配置核对与上线前验证</td>
    </tr>
    <tr>
      <td>交付文档</td>
      <td>接口说明、操作说明、运维排查说明</td>
    </tr>
  </tbody>
</table>

## 六、费用测算

测算按 10 万台已接入的 IoT 设备。单次任务的回答一秒左右响应，一次交互的占用时间短。连接侧设置断开机制：15 秒内没有新的回复，自动断开本次连接，避免空闲连接继续计费。

测算口径：

1. 并发 1,000 路，按 1,000 个用户同时使用估算。
2. 平均每人每天使用 1 分钟。15 秒无回复即断开，用户有新的问题再重新发起。
3. 每天总时长 1,000 分钟，一年按 365 天。

<table border="1" cellpadding="8" cellspacing="0" width="100%">
  <thead>
    <tr>
      <th width="28%">项目</th>
      <th>测算</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>接入规模</td>
      <td>10 万台 IoT 设备</td>
    </tr>
    <tr>
      <td>并发</td>
      <td>1,000 路</td>
    </tr>
    <tr>
      <td>每人每天</td>
      <td>1 分钟</td>
    </tr>
    <tr>
      <td>断开机制</td>
      <td>15 秒内没有回复，自动断开本次连接</td>
    </tr>
    <tr>
      <td>每天总时长</td>
      <td>1,000 分钟</td>
    </tr>
    <tr>
      <td>一年总时长</td>
      <td>1,000 × 365 = 365,000 分钟</td>
    </tr>
    <tr>
      <td>链路单价</td>
      <td>0.05 元/分钟</td>
    </tr>
    <tr>
      <td>每天链路费用</td>
      <td>1,000 × 0.05 = 50 元</td>
    </tr>
    <tr>
      <td>一年链路费用</td>
      <td>365,000 × 0.05 = 18,250 元</td>
    </tr>
    <tr>
      <td>首年费用</td>
      <td>100,000 + 18,250 = 118,250 元</td>
    </tr>
  </tbody>
</table>

以上按给定使用量测算。实际链路费用按通话分钟结算。

## 七、方案优点

<table border="1" cellpadding="8" cellspacing="0" width="100%">
  <thead>
    <tr>
      <th width="24%">优点</th>
      <th>说明</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>百度全栈自研</td>
      <td>链路从算力到模型都在百度体系内。底层按芯、云、模、体四层建设：模型部署在百度自研昆仑芯上，经千帆平台调用。语音识别、语音合成、大模型和实时互动由同一方交付，算力与模型服务不跨供应商拼接，运行更稳，接口和计费口径也统一。</td>
    </tr>
    <tr>
      <td>RTC 实时互动架构</td>
      <td>以百度 RTC 实时通讯为传输层，上面接音视频增强、意图识别、知识库检索和设备指令。全链路做了音频优化，包括降噪、人声分离、VAD 增强和智能打断，支持全双工对话，弱网下仍可保持连续通话。端到端语音时延低至 1.3 秒，语音打断小于 0.8 秒。架构支持千万级设备接入，本期并发按 1,000 路提供。</td>
    </tr>
    <tr>
      <td>端侧与 DuMate 分工</td>
      <td>常规语音指令在端侧快速响应。遇到多意图、需要连续推理或跨步骤处理的复杂任务时，由意图识别路由到 DuMate Agent，在云端完成任务规划和执行。简单控制留在端侧，复杂任务交给 DuMate。</td>
    </tr>
  </tbody>
</table>
