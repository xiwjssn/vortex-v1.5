'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NicknameGuard, DEFAULT_NICKNAME } = require('../utils/nicknameGuard');

test('sets the bot nickname in group chats and restores it when changed', async () => {
  const info = { participantIDs: ['bot', 'user-1', 'user-2'], nicknames: {} };
  const changes = [];
  const api = {
    getCurrentUserID: () => 'bot',
    getThreadInfo: (_threadID, callback) => callback(null, info),
    changeNickname: (nickname, threadID, participantID, callback) => {
      changes.push({ nickname, threadID, participantID });
      info.nicknames[participantID] = nickname;
      callback(null);
    }
  };
  const guard = new NicknameGuard({ getApi: () => api, logger: { info() {}, warn() {} } });
  await guard.handle({ type: 'message', body: 'hello', threadID: 'group-1' });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].nickname, DEFAULT_NICKNAME);
  assert.equal(changes[0].participantID, 'bot');

  info.nicknames.bot = 'someone changed it';
  await guard.handle({
    type: 'event',
    logMessageType: 'log:user-nickname',
    threadID: 'group-1',
    logMessageData: { participant_id: 'bot', nickname: 'someone changed it' }
  });
  assert.equal(changes.length, 2);
});

test('does not rename the bot in a one-to-one conversation', async () => {
  let changes = 0;
  const api = {
    getCurrentUserID: () => 'bot',
    getThreadInfo: (_threadID, callback) => callback(null, { participantIDs: ['bot', 'user-1'], nicknames: {} }),
    changeNickname: (_nickname, _threadID, _participantID, callback) => { changes++; callback(null); }
  };
  const guard = new NicknameGuard({ getApi: () => api, logger: { info() {}, warn() {} } });
  await guard.handle({ type: 'message', body: 'hello', threadID: 'direct-1' });
  assert.equal(changes, 0);
});

test('bounds nickname tracking and removes stale thread entries', async () => {
  const api = {
    getCurrentUserID: () => 'bot',
    getThreadInfo: (_threadID, callback) => callback(null, { participantIDs: ['bot', 'user'], nicknames: {} })
  };
  const guard = new NicknameGuard({ getApi: () => api, logger: { info() {}, warn() {} }, maxTrackedThreads: 100 });
  const old = Date.now() - 10 * 60 * 1000;
  guard.checkedAt.set('stale-thread', old);
  for (let i = 0; i < 150; i++) guard.checkedAt.set('thread-' + i, Date.now());
  await guard.ensureThread('new-thread', api, true);
  assert.equal(guard.checkedAt.has('stale-thread'), false);
  assert.ok(guard.checkedAt.size <= 100);
});

test('limits concurrent thread metadata requests', async () => {
  let active = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const api = {
    getCurrentUserID: () => 'bot',
    getThreadInfo: async () => { active++; await gate; active--; return { participantIDs: ['bot', 'a', 'b'], nicknames: { bot: DEFAULT_NICKNAME } }; }
  };
  const guard = new NicknameGuard({ getApi: () => api, maxConcurrent: 2, logger: { info() {}, warn() {} } });
  const first = guard.handle({ type: 'message', body: 'x', threadID: 'g1' });
  const second = guard.handle({ type: 'message', body: 'x', threadID: 'g2' });
  await new Promise(resolve => setImmediate(resolve));
  await guard.handle({ type: 'message', body: 'x', threadID: 'g3' });
  assert.equal(guard.inFlight.size, 2);
  release();
  await Promise.all([first, second]);
});
