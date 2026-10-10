// 场景配置。指令、风险、人设与 Agent API demo 共用同一份口径，
// 设备清单直接读「箭牌demo打通」，避免两套名单漂开。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './src/env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = __dirname;
export const SCENARIO = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'scenario.json'), 'utf8'));

for (const k of ['id', 'brand', 'iot', 'agent', 'policy', 'commands', 'repair']) {
  if (!SCENARIO[k]) throw new Error(`config/scenario.json 缺字段：${k}`);
}

const ENV = loadEnv(ROOT);
const FIXTURE = (process.env.IOT_FIXTURE || ENV.IOT_FIXTURE) === 'real' ? 'real' : 'demo';
const fixtureName = FIXTURE === 'real' ? 'devices.real.json' : 'devices.json';
const fixtureFile = path.join(ROOT, '..', '箭牌demo打通', 'iot', fixtureName);
if (!fs.existsSync(fixtureFile)) throw new Error(`找不到设备清单：${fixtureFile}`);

export const DEVICES = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
export const FIXTURE_NAME = FIXTURE;
