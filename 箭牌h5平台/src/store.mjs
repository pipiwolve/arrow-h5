// 本地 JSONL / JSON 文件存储。这一版先把模块边界立住，不接 KV。
import fs from 'node:fs';

export function createStore({ file }) {
  return {
    kind: 'file',
    async append(line) {
      fs.appendFileSync(file, line.endsWith('\n') ? line : line + '\n');
    },
    async all() {
      if (!fs.existsSync(file)) return [];
      return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    },
    async tail(n = 100) {
      const lines = fs.existsSync(file)
        ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
        : [];
      return lines.slice(-n).reverse();
    },
    async readJson(fallback) {
      if (!fs.existsSync(file)) return fallback;
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
    },
    async writeJson(obj) {
      fs.writeFileSync(file, JSON.stringify(obj, null, 2));
    },
  };
}
