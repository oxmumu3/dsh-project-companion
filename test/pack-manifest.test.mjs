import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function packFiles() {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  const parsed = JSON.parse(output);
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  return entry.files.map(file => file.path);
}

test('npm pack 清单不含临时补丁与备份文件', () => {
  const leaked = packFiles().filter(path => /^src\/_/.test(path) || /^src\/.*\.bak/.test(path));
  assert.deepEqual(leaked, [], `pack 清单不应包含临时文件：${leaked.join(', ')}`);
});
