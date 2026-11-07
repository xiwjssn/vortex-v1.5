const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { preparePersistentDataDirectory } = require('./persistentData');

test('copies legacy session files into persistent storage without overwriting existing volume data', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vortex-persist-'));
  const source = path.join(root, 'legacy-data');
  const destination = path.join(root, 'volume');
  await fs.mkdir(path.join(source, 'account-2'), { recursive: true });
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(source, 'appstate.json'), '[{"key":"c_user","value":"legacy"}]');
  await fs.writeFile(path.join(source, 'session-secret'), 'legacy-secret');
  await fs.writeFile(path.join(source, 'account-2', 'appstate.json'), '[]');
  await fs.writeFile(path.join(destination, 'session-secret'), 'new-volume-secret');

  try {
    await preparePersistentDataDirectory(source, destination);
    assert.equal(await fs.readFile(path.join(destination, 'appstate.json'), 'utf8'), '[{"key":"c_user","value":"legacy"}]');
    assert.equal(await fs.readFile(path.join(destination, 'account-2', 'appstate.json'), 'utf8'), '[]');
    assert.equal(await fs.readFile(path.join(destination, 'session-secret'), 'utf8'), 'new-volume-secret');
    assert.equal((await fs.stat(destination)).mode & 0o777, 0o700);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('creates the destination when there is no legacy data directory yet', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vortex-persist-empty-'));
  const destination = path.join(root, 'volume');
  try {
    await preparePersistentDataDirectory(path.join(root, 'missing-data'), destination);
    assert.equal((await fs.stat(destination)).isDirectory(), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
