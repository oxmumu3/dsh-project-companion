import test from 'node:test';
import assert from 'node:assert/strict';
import {createDigestOwnerChannel, digestCallerIsOwner, digestOwnerSnapshot, sameDigestOwner} from '../src/digest-owner.js';

const setupKey = 'a'.repeat(64), liveKey = 'b'.repeat(64);
const setup = {state: 'bound', sessionId: 'wechat-owner', bindingKey: setupKey};
const live = {bound: true, bindingKey: liveKey};

test('legacy setup fingerprint and live guarded binding are both kept but never compared', () => {
  const owner = digestOwnerSnapshot(setup, live);
  assert.deepEqual(owner, {sessionId: 'wechat-owner', setupBindingKey: setupKey, bindingKey: liveKey});
  assert.equal(sameDigestOwner(owner, digestOwnerSnapshot(setup, live)), true);
});

test('missing, expired or replaced live binding cannot produce an owner', () => {
  assert.equal(digestOwnerSnapshot(setup, null), null);
  assert.equal(digestOwnerSnapshot({...setup, state: 'unknown'}, live), null);
  assert.equal(digestOwnerSnapshot({...setup, bindingKey: undefined}, live), null);
  assert.equal(digestOwnerSnapshot(setup, {bound: false, bindingKey: liveKey}), null);
});

test('session or either fingerprint rotating mid-run fails the same-owner check', () => {
  const owner = digestOwnerSnapshot(setup, live);
  assert.equal(sameDigestOwner(owner, {...owner, sessionId: 'other-owner'}), false);
  assert.equal(sameDigestOwner(owner, {...owner, setupBindingKey: 'c'.repeat(64)}), false);
  assert.equal(sameDigestOwner(owner, {...owner, bindingKey: 'd'.repeat(64)}), false);
  assert.equal(sameDigestOwner(owner, null), false);
});

test('delivery uses the live binding, and a mid-run rotation blocks the send', async () => {
  const sent = [];
  let currentSetup = setup, currentLive = live;
  const bridge = {send: async input => { sent.push(input); return {status: 'accepted'}; }};
  const channel = createDigestOwnerChannel({
    readSetup: async () => currentSetup,
    readBridge: () => bridge,
    readBinding: () => currentLive,
  });
  const owner = await channel.resolve();
  assert.equal(owner.bindingKey, liveKey);
  assert.deepEqual(await channel.send({owner, text: 'synthetic', requestId: 'digest:2026-11-13'}), {status: 'reported_sent'});
  assert.equal(sent.length, 1);
  assert.equal(sent[0].expectedBinding, liveKey);
  assert.notEqual(sent[0].expectedBinding, setupKey);

  currentLive = {bound: true, bindingKey: 'c'.repeat(64)};
  assert.deepEqual(await channel.send({owner, text: 'synthetic', requestId: 'digest:2026-11-13'}), {status: 'blocked'});
  assert.equal(sent.length, 1, 'rotated binding must not reach the bridge');

  currentLive = live;
  currentSetup = {...setup, sessionId: 'other-owner'};
  assert.deepEqual(await channel.send({owner, text: 'synthetic', requestId: 'digest:2026-11-13'}), {status: 'blocked'});
  assert.equal(sent.length, 1, 'changed session must not reach the bridge');
});

test('dead bridge or unbound binding blocks delivery after a valid snapshot', async () => {
  const bridge = {send: async () => ({status: 'accepted'})};
  let currentBridge = bridge, currentLive = live;
  const channel = createDigestOwnerChannel({readSetup: async () => setup, readBridge: () => currentBridge, readBinding: () => currentLive});
  const owner = await channel.resolve();
  currentBridge = null;
  assert.deepEqual(await channel.send({owner, text: 'synthetic', requestId: 'digest:x'}), {status: 'blocked'});
  currentBridge = bridge;
  currentLive = null;
  assert.deepEqual(await channel.send({owner, text: 'synthetic', requestId: 'digest:x'}), {status: 'blocked'});
});

test('family is rejected even when the same ID is the selected desktop or a live owner', () => {
  const owner = digestOwnerSnapshot(setup, live);
  assert.equal(digestCallerIsOwner({sessionId: 'family_owner_x', desktopId: 'family_owner_x', owner, family: true}), false);
  assert.equal(digestCallerIsOwner({sessionId: 'family_owner_x', desktopId: 'family_owner_x', owner: {...owner, sessionId: 'family_owner_x'}, family: true}), false);
  assert.equal(digestCallerIsOwner({sessionId: 'wechat-owner', desktopId: 'wechat-owner', owner: null}), true);
  assert.equal(digestCallerIsOwner({sessionId: 'wechat-owner', desktopId: 'other', owner}), true);
  assert.equal(digestCallerIsOwner({sessionId: 'other', desktopId: 'desktop', owner}), false);
});
