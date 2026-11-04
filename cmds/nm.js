'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CHECK_INTERVAL_MS = 10_000;

let monitorTimer = null;
let currentApi = null;
let dataFile = null;
let protectedNames = {};
let checking = false;

function loadNames(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data)
      ? data
      : {};
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('[nm] Load error:', error.message);
    }
    return {};
  }
}

function saveNames() {
  if (!dataFile) {
    throw new Error('مسار حفظ الأسماء غير محدد');
  }

  fs.mkdirSync(path.dirname(dataFile), { recursive: true });

  const tempFile = dataFile + '.tmp';

  fs.writeFileSync(
    tempFile,
    JSON.stringify(protectedNames, null, 2),
    'utf8'
  );

  fs.renameSync(tempFile, dataFile);
}

function apiCall(api, method, ...args) {
  return new Promise((resolve, reject) => {
    if (!api || typeof api[method] !== 'function') {
      return reject(new Error('API method unavailable: ' + method));
    }

    let settled = false;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;

      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      } else {
        resolve(result);
      }
    };

    try {
      const result = api[method](...args, finish);

      if (result && typeof result.then === 'function') {
        result.then(value => finish(null, value), finish);
      }
    } catch (error) {
      finish(error);
    }
  });
}

async function checkProtectedNames() {
  if (!currentApi || checking) return;

  checking = true;

  try {
    for (const [threadID, expectedName] of Object.entries(protectedNames)) {
      // قد تكون الحماية أوقفت أثناء الفحص.
      if (!Object.prototype.hasOwnProperty.call(protectedNames, threadID)) {
        continue;
      }

      try {
        const info = await apiCall(
          currentApi,
          'getThreadInfo',
          threadID
        );

        if (!info || typeof info.threadName !== 'string') continue;

        if (info.threadName !== expectedName) {
          // لا نرجع الاسم إذا أُوقفت الحماية أثناء انتظار API.
          if (!Object.prototype.hasOwnProperty.call(protectedNames, threadID)) {
            continue;
          }

          await apiCall(
            currentApi,
            'setTitle',
            expectedName,
            threadID
          );

          console.log(
            `[nm] Restored group ${threadID} name to "${expectedName}"`
          );
        }
      } catch (error) {
        console.error(
          `[nm] Failed to protect group ${threadID}:`,
          error.message
        );
      }
    }
  } finally {
    checking = false;
  }
}

function startMonitor(api, config) {
  currentApi = api;

  const directory = config.dataDir || path.join(process.cwd(), 'data');
  const nextFile = path.join(directory, 'nm-protected-names.json');

  if (dataFile !== nextFile) {
    dataFile = nextFile;
    protectedNames = loadNames(dataFile);
  }

  if (!monitorTimer) {
    monitorTimer = setInterval(() => {
      checkProtectedNames().catch(error => {
        console.error('[nm] Monitor error:', error.message);
      });
    }, CHECK_INTERVAL_MS);

    if (typeof monitorTimer.unref === 'function') {
      monitorTimer.unref();
    }
  }
}

module.exports = {
  name: 'سحب',
  aliases: [],
  description: 'تغيير اسم المجموعة وحمايته أو إيقاف الحماية',
  adminOnly: true,

  async execute(api, event) {
    const threadID = String(event.threadID || '');
    const senderID = String(event.senderID || '');
    const config = event.config || {};

    const ownerIDs = (config.ownerIDs || [config.ownerID])
      .filter(Boolean)
      .map(String);

    const adminIDs = (config.adminIDs || []).map(String);

    const isAuthorized =
      event.isOwner === true ||
      event.isAdmin === true ||
      ownerIDs.includes(senderID) ||
      adminIDs.includes(senderID);

    if (!threadID) {
      return api.sendMessage(
        '❌ لا يمكن تحديد المجموعة.',
        event.threadID,
        event.messageID
      );
    }

    if (!isAuthorized) {
      return api.sendMessage(
        '⛔ الأمر خاص بمالك البوت والمسؤولين المحددين في الداشبورد.',
        threadID,
        event.messageID
      );
    }

    const args = Array.isArray(event.args) ? event.args : [];
    const input = args.join(' ').trim();
    const prefix = String(config.prefix || '*');

    if (!input) {
      return api.sendMessage(
        `❌ حدد اسمًا جديدًا أو اكتب أمر الإيقاف.\n` +
        `تغيير الاسم: ${prefix}سحب الاسم الجديد\n` +
        `إيقاف الحماية: ${prefix}سحب ايقاف`,
        threadID,
        event.messageID
      );
    }

    try {
      startMonitor(api, config);

      // إيقاف حماية المجموعة الحالية فقط.
      if (input.toLowerCase() === 'ايقاف' || input.toLowerCase() === 'إيقاف') {
        if (!Object.prototype.hasOwnProperty.call(protectedNames, threadID)) {
          return api.sendMessage(
            'ℹ️ الحماية غير مفعّلة لهذه المجموعة أصلًا.',
            threadID,
            event.messageID
          );
        }

        delete protectedNames[threadID];
        saveNames();

        return api.sendMessage(
          '🛑 تم إيقاف حماية اسم هذه المجموعة.\n' +
          'لن يعيد البوت الاسم السابق تلقائيًا.',
          threadID,
          event.messageID
        );
      }

      const newName = input;

      if (newName.length > 100) {
        return api.sendMessage(
          '❌ الاسم طويل جدًا، اختصره وحاول مجددًا.',
          threadID,
          event.messageID
        );
      }

      // لا نحفظ الاسم إلا بعد نجاح تغييره.
      await apiCall(api, 'setTitle', newName, threadID);

      protectedNames[threadID] = newName;
      saveNames();

      return api.sendMessage(
        `✅ تم تغيير اسم المجموعة إلى: ${newName}\n` +
        '🛡️ تمت إضافة المجموعة إلى قائمة الحماية.\n' +
        '⏱️ فحص الاسم كل 10 ثوانٍ.',
        threadID,
        event.messageID
      );
    } catch (error) {
      console.error('[nm] Command failed:', error);

      return api.sendMessage(
        '❌ تعذر تنفيذ الأمر أو حفظ التغييرات.\n' +
        'تأكد من صلاحيات البوت وإمكانية الكتابة في مجلد البيانات.\n' +
        `التفاصيل: ${String(error.message || error).slice(0, 150)}`,
        threadID,
        event.messageID
      );
    }
  }
};
