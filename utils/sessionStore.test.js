const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { FileSessionStore } = require('./sessionStore');

function call(store, method, ...args) {
  return new Promise((resolve, reject) => store[method](...args, (error, value) => error ? reject(error) : resolve(value)));
}

test('persists, reads, touches and destroys dashboard sessions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vortex-sessions-'));
  const store = new FileSessionStore({ directory: path.join(root, 'sessions'), logger: { warn() {} } });
  const value = { cookie: { expires: new Date(Date.now() + 60000).toISOString() }, authenticated: true, role: 'owner' };
  try {
    await call(store, 'set', 'session-id', value);
    assert.deepEqual(await call(store, 'get', 'session-id'), value);
    await call(store, 'touch', 'session-id', value);
    await call(store, 'destroy', 'session-id');
    assert.equal(await call(store, 'get', 'session-id'), null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('removes expired dashboard sessions when read', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vortex-expired-sessions-'));
  const store = new FileSessionStore({ directory: path.join(root, 'sessions'), logger: { warn() {} } });
  try {
    await call(store, 'set', 'expired-id', { cookie: { expires: new Date(Date.now() - 1000).toISOString() }, authenticated: true });
    assert.equal(await call(store, 'get', 'expired-id'), null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
