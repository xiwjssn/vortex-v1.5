const test = require('node:test');
const assert = require('node:assert/strict');
const { ReconnectManager } = require('./reconnect');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('default reconnect policy keeps retrying until connection succeeds', async () => {
  let calls = 0;
  const manager = new ReconnectManager({
    connect: async () => {
      calls++;
      if (calls < 5) throw new Error('temporary network failure');
      return { status: 'connected' };
    },
    logger: { warn: () => {}, error: () => {} },
    baseMs: 100,
    maxMs: 100,
    random: () => 0.5
  });
  manager.start();
  manager.schedule();
  await wait(650);
  assert.equal(calls, 5);
  assert.equal(manager.stopped, false);
  assert.equal(manager.attempts, 0);
  manager.stop();
});

test('an explicitly configured retry budget is still respected', async () => {
  let calls = 0;
  const errors = [];
  const manager = new ReconnectManager({
    connect: async () => { calls++; throw new Error('temporary network failure'); },
    logger: { warn: () => {}, error: (name, data) => errors.push({ name, data }) },
    baseMs: 100,
    maxMs: 100,
    maxAttempts: 2,
    random: () => 0.5
  });
  manager.start();
  manager.schedule();
  await wait(350);
  assert.equal(calls, 2);
  assert.equal(manager.stopped, true);
  assert.equal(manager.schedule(), false);
  assert.ok(errors.some(entry => entry.name === 'RECONNECT_RETRY_LIMIT_REACHED'));
});

test('reconnect manager pauses when a session needs verification', async () => {
  let calls = 0;
  const manager = new ReconnectManager({
    connect: async () => { calls++; return { status: 'needs-attention' }; },
    logger: { warn: () => {}, error: () => {} },
    baseMs: 100,
    maxMs: 100,
    random: () => 0.5
  });
  manager.start();
  manager.schedule();
  await wait(180);
  assert.equal(calls, 1);
  assert.equal(manager.stopped, true);
  assert.equal(manager.schedule(), false);
});
