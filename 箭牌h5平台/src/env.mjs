// .env 读取。文件给默认值，命令行里的同名变量可以覆盖。
import fs from 'node:fs';
import path from 'node:path';

const ALWAYS_FROM_PROCESS = ['IOT_FIXTURE', 'BRTC_DIRECT'];

export function loadEnv(root) {
  const p = path.join(root, '.env');
  if (!fs.existsSync(p)) {
    if (process.env.VERCEL) return { ...process.env };
    throw new Error('缺少 .env（照 .env.example 建一份）');
  }
  const out = {};
  for (const raw of fs.readFileSync(p, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  for (const k of Object.keys(out)) {
    if (process.env[k] !== undefined && process.env[k] !== '') out[k] = process.env[k];
  }
  for (const k of ALWAYS_FROM_PROCESS) {
    if (process.env[k] !== undefined && process.env[k] !== '') out[k] = process.env[k];
  }
  return out;
}
