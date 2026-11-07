const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const session = require('express-session');
const { atomicWrite } = require('./atomicFile');

class FileSessionStore extends session.Store {
  constructor({ directory, logger = console } = {}) {
    super();
    if (!directory) throw new Error('A persistent session directory is required');
    this.directory = path.resolve(directory);
    this.logger = logger;
    this.operations = 0;
    this.cleanupInFlight = null;
  }

  fileFor(sid) {
    const name = crypto.createHash('sha256').update(String(sid)).digest('hex') + '.json';
    return path.join(this.directory, name);
  }

  async cleanupExpired() {
    if (this.cleanupInFlight) return this.cleanupInFlight;
    this.cleanupInFlight = (async () => {
      let entries;
      try { entries = await fs.readdir(this.directory, { withFileTypes: true }); }
      catch (error) { if (error.code === 'ENOENT') return; throw error; }
      const now = Date.now();
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const file = path.join(this.directory, entry.name);
        try {
          const saved = JSON.parse(await fs.readFile(file, 'utf8'));
          const expires = saved?.cookie?.expires ? Date.parse(saved.cookie.expires) : NaN;
          if (Number.isFinite(expires) && expires <= now) await fs.rm(file, { force: true });
        } catch (error) {
          if (error.code === 'ENOENT') continue;
          this.logger.warn?.('DASHBOARD_SESSION_CLEANUP_FAILED', { error: String(error.message || error).slice(0, 120) });
        }
      }
    })();
    try { await this.cleanupInFlight; }
    finally { this.cleanupInFlight = null; }
  }

  get(sid, callback) {
    fs.readFile(this.fileFor(sid), 'utf8').then(async raw => {
      const saved = JSON.parse(raw);
      const expires = saved?.cookie?.expires ? Date.parse(saved.cookie.expires) : NaN;
      if (Number.isFinite(expires) && expires <= Date.now()) {
        await fs.rm(this.fileFor(sid), { force: true });
        callback(null, null);
        return;
      }
      callback(null, saved);
    }).catch(error => {
      if (error.code === 'ENOENT') callback(null, null);
      else callback(error);
    });
  }

  set(sid, value, callback = () => {}) {
    (async () => {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      await atomicWrite(this.fileFor(sid), JSON.stringify(value), 0o600);
      this.operations++;
      if (this.operations % 100 === 0) await this.cleanupExpired();
    })().then(() => callback(null), callback);
  }

  touch(sid, value, callback = () => {}) {
    this.set(sid, value, callback);
  }

  destroy(sid, callback = () => {}) {
    fs.rm(this.fileFor(sid), { force: true }).then(() => callback(null), callback);
  }
}

module.exports = { FileSessionStore };
