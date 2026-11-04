'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createReadStream } = require('node:fs');

const CHECK_INTERVAL_MS = 10_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
let apiRef = null;
let dataFile = null;
let imageDirectory = null;
let protections = {};
let monitor = null;
let checking = false;

function readState(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('[fard] state read failed:', error.message);
    return {};
  }
}

function saveState() {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  const temp = dataFile + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(protections, null, 2), { mode: 0o600 });
  fs.renameSync(temp, dataFile);
}

function apiCall(api, method, ...args) {
  return new Promise((resolve, reject) => {
    if (!api || typeof api[method] !== 'function') {
      reject(new Error('Facebook API method unavailable: ' + method));
      return;
    }
    let settled = false;
    const done = (error, result) => {
      if (settled) return;
      settled = true;
      if (error) reject(error instanceof Error ? error : new Error(String(error)));
      else resolve(result);
    };
    try {
      const result = api[method](...args, done);
      if (result && typeof result.then === 'function') result.then(value => done(null, value), done);
    } catch (error) {
      done(error);
    }
  });
}

function imageKey(value) {
  if (!value || typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return '';
    return url.origin + url.pathname;
  } catch {
    return '';
  }
}

async function getGroupImageKey(api, threadID) {
  const info = await apiCall(api, 'getThreadInfo', threadID);
  return imageKey(info?.imageSrc || info?.image);
}

async function downloadImage(url, destination) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('رابط الصورة غير آمن.');
  const response = await fetch(parsed, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('تعذر تحميل الصورة المردود عليها.');
  const type = String(response.headers.get('content-type') || '').toLowerCase();
  if (!type.startsWith('image/')) throw new Error('المرفق ليس صورة.');
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_IMAGE_BYTES) throw new Error('حجم الصورة يتجاوز 10MB.');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('الصورة فارغة أو أكبر من 10MB.');
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.writeFile(destination, buffer, { mode: 0o600 });
}

async function setGroupImage(api, threadID, filePath) {
  if (!fs.existsSync(filePath)) throw new Error('ملف الصورة المحفوظة غير موجود.');
  await apiCall(api, 'changeGroupImage', createReadStream(filePath), threadID);
}

async function checkProtections() {
  if (!apiRef || checking) return;
  checking = true;
  try {
    for (const [threadID, item] of Object.entries(protections)) {
      if (!protections[threadID] || item.restoring) continue;
      try {
        const currentKey = await getGroupImageKey(apiRef, threadID);
        if (currentKey && currentKey === item.expectedKey) continue;

        item.restoring = true;
        saveState();
        await setGroupImage(apiRef, threadID, item.filePath);

        // Facebook may take a moment to publish the new group-photo URL.
        let restoredKey = '';
        for (let attempt = 0; attempt < 8; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 1500));
          restoredKey = await getGroupImageKey(apiRef, threadID).catch(() => '');
          if (restoredKey) break;
        }
        if (restoredKey) item.expectedKey = restoredKey;
        item.restoring = false;
        saveState();
        console.log('[fard] restored protected group photo:', threadID);
      } catch (error) {
        item.restoring = false;
        saveState();
        console.error('[fard] protection check failed:', threadID, error.message);
      }
    }
  } finally {
    checking = false;
  }
}

function initialize(api, config) {
  apiRef = api;
  const directory = config.dataDir || path.join(process.cwd(), 'data');
  dataFile = path.join(directory, 'fard-protections.json');
  imageDirectory = path.join(directory, 'fard-images');
  if (!initialize.loadedFile || initialize.loadedFile !== dataFile) {
    protections = readState(dataFile);
    initialize.loadedFile = dataFile;
  }
  if (!monitor) {
    monitor = setInterval(() => checkProtections().catch(error => {
      console.error('[fard] monitor error:', error.message);
    }), CHECK_INTERVAL_MS);
    monitor.unref?.();
  }
}

module.exports = {
  name: 'فرض',
  aliases: [],
  description: 'تثبيت صورة المجموعة وحمايتها من التغيير أو الحذف',
  adminOnly: true,

  async execute(api, event) {
    const threadID = String(event.threadID || '');
    const config = event.config || {};
    initialize(api, config);

    const input = (Array.isArray(event.args) ? event.args : []).join(' ').trim().toLowerCase();
    if (input === 'ايقاف' || input === 'إيقاف' || input === 'off') {
      const current = protections[threadID];
      if (!current) {
        return api.sendMessage('ℹ️ حماية صورة المجموعة غير مفعّلة.', threadID, event.messageID);
      }
      delete protections[threadID];
      saveState();
      await fsp.unlink(current.filePath).catch(() => {});
      return api.sendMessage('🛑 تم إيقاف حماية صورة المجموعة.', threadID, event.messageID);
    }

    const attachments = event.messageReply?.attachments || event.messageReply?.attachment || [];
    const list = Array.isArray(attachments) ? attachments : [attachments];
    const photo = list.find(item =>
      item && (String(item.type || '').toLowerCase() === 'photo' ||
        String(item.mimeType || item.contentType || '').toLowerCase().startsWith('image/')) &&
      (item.url || item.previewUrl)
    );

    if (!photo) {
      return api.sendMessage(
        '❗ ردّ على صورة في المجموعة واكتب: فرض\nلإيقاف الحماية: فرض ايقاف',
        threadID,
        event.messageID
      );
    }

    const imageUrl = photo.url || photo.previewUrl;
    const filePath = path.join(imageDirectory, threadID.replace(/[^a-zA-Z0-9_-]/g, '_') + '.img');
    const temporaryPath = filePath + '.tmp';

    try {
      await downloadImage(imageUrl, temporaryPath);
      await fsp.rename(temporaryPath, filePath);
      await setGroupImage(api, threadID, filePath);

      let expectedKey = '';
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        expectedKey = await getGroupImageKey(api, threadID).catch(() => '');
        if (expectedKey) break;
      }

      if (!expectedKey) throw new Error('تم رفع الصورة لكن تعذر التحقق من صورة المجموعة الحالية.');
      protections[threadID] = { filePath, expectedKey, restoring: false, updatedAt: Date.now() };
      saveState();

      return api.sendMessage(
        '✅ تم تعيين الصورة وحمايتها.\n⏱️ أفحص صورة المجموعة كل 10 ثوانٍ وأستعيدها إذا تغيّرت أو حُذفت.\n🛑 للإيقاف: فرض ايقاف',
        threadID,
        event.messageID
      );
    } catch (error) {
      await fsp.unlink(temporaryPath).catch(() => {});
      return api.sendMessage(
        '❌ تعذر تثبيت الصورة أو تفعيل الحماية: ' + String(error.message || error).slice(0, 160),
        threadID,
        event.messageID
      );
    }
  }
};
