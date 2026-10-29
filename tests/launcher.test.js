import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('Mac启动入口先构建再打开页面，即使旧服务已经运行', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mashangdong-launcher-'));
  try {
    mkdirSync(join(dir, 'bin'));
    mkdirSync(join(dir, 'node_modules/vite/bin'), { recursive: true });
    writeFileSync(join(dir, 'node_modules/vite/bin/vite.js'), '');
    copyFileSync(new URL('../启动.command', import.meta.url), join(dir, '启动.command'));
    const fake = {
      node: 'exit 0',
      npm: 'echo build >> events',
      curl: 'echo 码上动',
      open: 'echo open >> events',
    };
    for (const [name, body] of Object.entries(fake)) writeFileSync(join(dir, 'bin', name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    const result = spawnSync('/bin/zsh', [join(dir, '启动.command')], { env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(join(dir, 'events'), 'utf8').trim().split('\n'), ['build', 'open'], '已有服务也必须先更新构建文件，避免用户一直看到旧功能');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
