const TOPICS = [
  { model: 'iot_calls', test: /调用了多少|调用次数|多少次|失败了几次|成功了几次/ },
  { model: 'usage_duration', test: /用得最久|使用时长|用了多久|用了多少分钟/ },
];

/** 数据统计话题。命中后交给适配层，不送进 BRTC 房间。 */
export function topicModel(text) {
  const value = String(text || '');
  return TOPICS.find((item) => item.test.test(value))?.model || '';
}
