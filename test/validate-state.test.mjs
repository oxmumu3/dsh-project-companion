import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script = fileURLToPath(new URL('../scripts/validate-state.mjs', import.meta.url));
const binding = 'a'.repeat(64);
const board = () => ({
  tables: {
    state: {
      profile: {
        id: 'profile', version: 1, revision: 'rev-1', accessRevision: null,
        projects: [], evidence: [], locks: [], standaloneIds: [], uncertainIds: [],
        scan: { phase: 'idle', at: null, coverage: [] },
      },
    },
  },
});

function run(dir) {
  const result = spawnSync(process.execPath, [script, dir], {encoding: 'utf8'});
  return {code: result.status, text: `${result.stdout}${result.stderr}`};
}

test('升级前自查：合法状态全部兼容并返回 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dot-state-ok-'));
  try {
    writeFileSync(join(dir, 'project_companion_goals.json'), JSON.stringify(board()));
    const {code, text} = run(dir);
    assert.equal(code, 0, text);
    assert.match(text, /project_companion_goals：兼容/);
    assert.match(text, /0 个不兼容/);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('升级前自查：多出未知字段时点名不兼容并返回 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dot-state-bad-'));
  try {
    const row = board();
    row.tables.state.profile.scan.run = { read: 1, total: 2 };
    writeFileSync(join(dir, 'project_companion_goals.json'), JSON.stringify(row));
    const {code, text} = run(dir);
    assert.equal(code, 1, text);
    assert.match(text, /project_companion_goals：不兼容/);
    assert.match(text, /scan/);
    assert.match(text, /1 个不兼容/);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('升级前自查：目录不存在时明确报错而不是当成功', () => {
  const {code, text} = run(join(tmpdir(), 'dot-state-missing-does-not-exist'));
  assert.equal(code, 2, text);
  assert.match(text, /找不到状态目录/);
});

test('升级前自查：不认识的域标成未核对，不冒充兼容', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dot-state-unknown-'));
  try {
    mkdirSync(dir, {recursive: true});
    writeFileSync(join(dir, 'project_companion_onboarding.json'), JSON.stringify({tables: {state: {profile: {id: 'profile'}}}}));
    const {code, text} = run(dir);
    assert.equal(code, 0, text);
    assert.match(text, /project_companion_onboarding：未核对/);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
