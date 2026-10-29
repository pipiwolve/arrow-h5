const TOPICS = [
  { model: 'iot_calls', test: /调用了多少|调用次数|多少次|失败了几次|成功了几次|安排检修|检修报告|生成报告/ },
  { model: 'usage_duration', test: /用得最久|使用时长|用了多久|用了多少分钟/ },
];

/** 数据统计话题。命中后交给适配层，不送进 BRTC 房间。 */
export function topicModel(text) {
  const value = String(text || '');
  return TOPICS.find((item) => item.test.test(value))?.model || '';
}

const IMAGE_SAY = '图片已生成。';

/** 话题生图的口头句。文件编号放在响应的 image.id，不进播报。 */
export function topicImage(text) {
  return String(text || '').replace(/\s+/g, '') === IMAGE_SAY;
}

/** 适配层把可展示页面包在 html 代码块里，其余文字仍是口头结论。 */
export function topicView(content) {
  const text = String(content || '');
  const fenced = text.match(/```html\s*([\s\S]*?)```/i);
  const html = fenced ? fenced[1].trim() : '';
  const page = /<!doctype html>|<html[\s>]/i.test(html) ? html : '';
  const say = text.replace(/```html[\s\S]*?```/i, '').trim();
  return { say, html: page };
}
