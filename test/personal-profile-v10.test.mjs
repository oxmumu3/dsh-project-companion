import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPersonalProfile} from '../src/personal-profile.js';
import {createMuseIntelligence} from '../src/muse-intelligence.js';
import {createMuseController, projectMuseDigest} from '../src/muse-route.js';

const at = '2026-11-19T00:30:00.000Z';
const clock = () => new Date(at);

function profileStore(initial) {
  let row = initial;
  return {
    async get() { return structuredClone(row); },
    async put(_, next) { row = structuredClone(next); },
  };
}

test('legacy profile rows remain readable; v10 pause persists and excludes their guidance', async () => {
  const store = profileStore({
    id: 'profile', revision: 1, updatedAt: at,
    traits: [{id: 'trait-old', category: 'tone', label: '语气', value: '先给结论', updatedAt: at}],
    notes: [{id: 'note-old', category: 'note', source: 'wechat', text: '先用英文', createdAt: at, updatedAt: at}],
  });
  const profile = createPersonalProfile({store, clock});
  const controller = createMuseController({personalProfile: profile});
  const initial = await controller.snapshot();
  assert.deepEqual(initial.memoryItems.map(item => [item.id, item.sourceKind, item.active]), [
    ['trait-old', 'manual', true], ['note-old', 'chat', true],
  ]);
  const paused = await controller.act({
    action: 'memory_item', id: 'trait-old', active: false,
    provenance: '示'.repeat(241), effect: '例'.repeat(241),
  });
  assert.equal(paused.ok, true);
  assert.equal(paused.memoryItems[0].provenance.length, 240);
  assert.equal(paused.memoryItems[0].effect.length, 240);
  const reloaded = createPersonalProfile({store, clock});
  assert.equal((await reloaded.snapshot()).traits[0].active, false);
  assert.doesNotMatch(reloaded.guidanceSummary(), /先给结论/);
  assert.match(reloaded.guidanceSummary(), /先用英文/);
  const boundary = await controller.act({action: 'memory_item', text: '涉及付款先跟我确认', category: 'boundary'});
  assert.equal(boundary.memoryItems.find(item => item.text === '涉及付款先跟我确认').category, 'boundary');
});

test('undo of a forgotten memory leaves memory written later intact', async () => {
  const profile = createPersonalProfile({clock});
  const controller = createMuseController({personalProfile: profile});
  const saved = await controller.act({action: 'memory_item', text: '第一条', category: 'preference'});
  const id = saved.memoryItems[0].id;
  const forgotten = await controller.act({action: 'memory_item', id, remove: true});
  await controller.act({action: 'memory_item', text: '第二条'});
  const restored = await controller.act({action: 'profile_undo', token: forgotten.undoToken});
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.memoryItems.map(item => item.text).sort(), ['第一条', '第二条']);
});

test('workspace memory is bounded, redacted, retained as a reference, and revoked with the grant', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dot-v10-experience-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  const memoryPath = join(root, '.agent', 'memory');
  await mkdir(memoryPath, {recursive: true});
  await writeFile(join(memoryPath, 'experience.md'), [
    '# 工作区经验',
    '## 已确认',
    '### EXP-2026-11-18-01 发邮件前先对齐术语',
    '- `id`: EXP-2026-11-18-01',
    '- `created`: 2026-11-18',
    '- 生效：同一模板会被两个项目复用',
    '正文不直接搬到记忆列表。password=do-not-display',
  ].join('\n'));
  let granted = true;
  const grant = {id: 'ws-1', root, label: 'Writing', sessionIds: []};
  const intel = createMuseIntelligence({clock, workspaceAccess: {
    capture: async () => ({revision: granted ? 'granted' : 'revoked', grants: granted ? [grant] : []}),
    authorizeSync: capture => granted && capture.revision === 'granted',
  }});
  const store = profileStore();
  let controller = createMuseController({personalProfile: createPersonalProfile({store, clock}), museIntelligence: intel});
  const initial = await controller.snapshot();
  assert.equal(initial.memoryItems.length, 1);
  const [item] = initial.memoryItems;
  assert.equal(item.sourceKind, 'workspace');
  assert.equal(item.text, '发邮件前先对齐术语');
  assert.match(item.provenance, /Writing.*experience\.md/);
  assert.equal(item.effect, '同一模板会被两个项目复用');
  assert.doesNotMatch(JSON.stringify(initial.memoryItems), /do-not-display|dot-v10-experience-/);
  assert.equal((await controller.act({action: 'memory_item', id: item.id, active: false})).memoryItems[0].active, false);
  controller = createMuseController({personalProfile: createPersonalProfile({store, clock}), museIntelligence: intel});
  assert.equal((await controller.snapshot()).memoryItems[0].active, false);
  const forgotten = await controller.act({action: 'memory_item', id: item.id, remove: true});
  assert.deepEqual(forgotten.memoryItems, []);
  assert.equal((await controller.act({action: 'profile_undo', token: forgotten.undoToken})).memoryItems[0].active, false);
  assert.doesNotMatch(JSON.stringify(await store.get()), /发邮件|Writing|experience/);
  granted = false;
  assert.deepEqual((await controller.snapshot()).memoryItems, []);
});

test('workspace memory rejects a linked experience file', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dot-v10-linked-experience-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'outside'));
  await writeFile(join(root, 'outside', 'experience.md'), '## 不能显示此行');
  await mkdir(join(root, '.agent', 'memory'), {recursive: true});
  await symlink(join(root, 'outside', 'experience.md'), join(root, '.agent', 'memory', 'experience.md'));
  const intel = createMuseIntelligence({clock, workspaceAccess: {
    capture: async () => ({revision: '1', grants: [{id: 'ws-1', root, label: 'Writing'}]}),
    authorizeSync: () => true,
  }});
  assert.deepEqual(await intel.readMemoryItems(), []);
});

test('revocation during a workspace read discards resolved experience', async () => {
  let grantIsCurrent = true;
  let started;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const readStarted = new Promise(resolve => { started = resolve; });
  const intel = createMuseIntelligence({
    clock,
    workspaceAccess: {
      capture: async () => ({revision: '1', grants: [{id: 'ws-1', root: '/', label: 'Writing'}]}),
      authorizeSync: () => grantIsCurrent,
    },
    readExperience: async () => {
      started();
      await pending;
      return {status: 'ok', text: '- 提醒：发稿前核对用词', modifiedAt: at};
    },
  });
  const snapshot = intel.readMemoryItems();
  await readStarted;
  grantIsCurrent = false;
  release();
  assert.deepEqual(await snapshot, []);
});

test('flomo provenance requires explicit authorized refresh and cannot survive a change of account', async () => {
  let reads = 0;
  let grant = '';
  const intel = createMuseIntelligence({
    clock,
    canReadFlomoMemory: async () => grant,
    readFlomoMemory: async request => {
      reads++;
      assert.equal(request.operation, 'recent');
      assert.equal(request.limit, 5);
      return {items: [{id: 'memo-1', text: '通过真实来源查到的笔记', createdAt: at}]};
    },
  });
  const controller = createMuseController({personalProfile: createPersonalProfile({clock}), museIntelligence: intel});
  assert.equal((await controller.act({action: 'flomo_memory_refresh'})).ok, false);
  grant = 'current-account';
  assert.deepEqual((await controller.snapshot()).memoryItems, []);
  assert.equal(reads, 0);
  const refreshed = await controller.act({action: 'flomo_memory_refresh'});
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.memoryItems[0].sourceKind, 'flomo');
  assert.match(refreshed.memoryItems[0].provenance, /flomo.*11.19/);
  grant = 'new-account';
  assert.deepEqual((await controller.snapshot()).memoryItems, []);
  assert.equal(reads, 1);
});

test('routine receipts use persisted run evidence and distinguish generation from delivery', () => {
  const summary = {enabled: true, dailyTime: '08:30', timeZone: 'Asia/Shanghai', deliveryMode: 'wechat_and_desktop'};
  assert.equal(projectMuseDigest(summary).routines[0].lastReceipt, undefined);
  const record = {
    ...summary,
    lastStatus: 'uncertain',
    lastDigest: {at, status: 'uncertain', counts: {promises: 2, events: 3, unreadable: []}, items: [{id: 'one'}]},
  };
  const projected = projectMuseDigest(record);
  assert.match(projected.digest.lastReceipt, /08:30.*1 项.*投递结果待确认/);
  assert.equal(projected.routines[0].lastReceipt, projected.digest.lastReceipt);
  assert.equal(projected.routines[0].lastRunAt, at);
  assert.equal(projectMuseDigest({...record, lastStatus: 'failed', lastAttemptAt: '2026-11-20T00:30:00.000Z'}).routines[0].lastRunAt, '2026-11-20T00:30:00.000Z');
});
