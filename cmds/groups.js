'use strict';

const sessions = new Map();

const SESSION_TIME = 5 * 60 * 1000;
const MAX_GROUPS = 30;
const ROCKET = '𝑹𝑶𝑪𝑲𝑬𝑻 🚀';

const CATEGORIES = {
  '1': { folder: 'PENDING', title: 'طلبات المراسلة', needsAccept: true },
  '2': { folder: 'OTHER', title: 'غير مهم / قد يكون احتياليًا', needsAccept: true },
  '3': { folder: 'INBOX', title: 'المجموعات المقبولة', needsAccept: false }
};

function makeKey(event) {
  return String(event.threadID) + ':' + String(event.senderID || '');
}

function removeSession(key) {
  const current = sessions.get(key);
  if (current?.timer) clearTimeout(current.timer);
  sessions.delete(key);
}

function putSession(key, data) {
  removeSession(key);
  const session = { ...data, expires: Date.now() + SESSION_TIME };
  session.timer = setTimeout(() => sessions.delete(key), SESSION_TIME);
  session.timer.unref?.();
  sessions.set(key, session);
}

function readSession(key) {
  const session = sessions.get(key);
  if (!session) return null;
  if (Date.now() >= session.expires) {
    removeSession(key);
    return null;
  }
  return session;
}

function apiCall(api, method, args = [], timeout = 15000) {
  return new Promise((resolve, reject) => {
    if (typeof api?.[method] !== 'function') {
      reject(new Error('API method not available: ' + method));
      return;
    }

    let finished = false;
    const timer = setTimeout(() => finish(new Error('انتهت مهلة الاتصال بـ ' + method)), timeout);

    function finish(error, result) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    }

    try {
      const result = api[method](...args, finish);
      if (result && typeof result.then === 'function') {
        result.then(value => finish(null, value), error => finish(error));
      } else if (result !== undefined && api[method].length <= args.length) {
        finish(null, result);
      }
    } catch (error) {
      finish(error);
    }
  });
}

async function send(api, event, message) {
  return api.sendMessage(String(message), event.threadID, event.messageID);
}

function isGroup(thread) {
  if (!thread || !thread.threadID) return false;

  if (thread.isGroup === true || thread.isGroup === 1 || thread.isGroup === 'true') {
    return true;
  }

  if (thread.threadType === 'GROUP' || thread.threadType === 'group') {
    return true;
  }

  if (Array.isArray(thread.participantIDs) && thread.participantIDs.length > 2) {
    return true;
  }

  if (Number(thread.participantCount) > 2 || Number(thread.userInfo?.length) > 2) {
    return true;
  }

  return false;
}

async function loadGroups(api, folder) {
  const result = await apiCall(api, 'getThreadList', [100, null, [folder]]);

  if (!Array.isArray(result)) {
    throw new Error('Messenger لم يُرجع قائمة المحادثات.');
  }

  const unique = new Map();

  for (const thread of result) {
    if (!thread?.threadID || !isGroup(thread)) continue;

    const id = String(thread.threadID);
    if (unique.has(id)) continue;

    unique.set(id, {
      id,
      name: String(thread.name || 'مجموعة بلا اسم')
        .replace(/[\r\n]+/g, ' ')
        .trim()
        .slice(0, 75)
    });
  }

  return [...unique.values()].slice(0, MAX_GROUPS);
}

function formatGroups(groups) {
  return groups.map((group, index) =>
    (index + 1) + '. ' + group.name + '\nID: ' + group.id
  ).join('\n\n');
}

function categoryMenu() {
  return [
    '🗂️ VORTEX | إدارة المجموعات',
    '',
    'اختر القسم بإرسال رقمه:',
    '',
    '1️⃣ طلبات المراسلة',
    '2️⃣ غير مهم / قد يكون احتياليًا',
    '3️⃣ المجموعات المقبولة',
    '',
    'تنتهي الجلسة بعد 5 دقائق.',
    'اكتب إلغاء لإيقاف العملية.'
  ].join('\n');
}

module.exports = {
  name: 'groups',
  aliases: ['غروبات', 'المجموعات'],
  description: 'إدارة مجموعات Messenger',
  adminOnly: true,

  async execute(api, event) {
    if (!event.isOwner) {
      return send(api, event, '⛔ هذا الأمر متاح للمالك فقط.');
    }

    const key = makeKey(event);
    putSession(key, {
      stage: 'category',
      owner: String(event.senderID),
      thread: String(event.threadID)
    });

    return send(api, event, categoryMenu());
  },

  async handleReply(api, event) {
    const key = makeKey(event);
    const session = readSession(key);
    if (!session) return false;

    if (String(event.senderID || '') !== session.owner) return false;
    if (String(event.threadID) !== session.thread) return false;

    const input = String(event.body || '').trim();
    if (!input) return false;

    if (/^(إلغاء|الغاء|cancel)$/i.test(input)) {
      removeSession(key);
      await send(api, event, '✅ تم إلغاء العملية.');
      return true;
    }

    if (session.stage === 'category') {
      const category = CATEGORIES[input];

      if (!category) {
        await send(api, event, '❌ اختر 1 أو 2 أو 3، أو اكتب إلغاء.');
        return true;
      }

      try {
        const groups = await loadGroups(api, category.folder);

        if (!groups.length) {
          removeSession(key);
          await send(api, event, 'لا توجد مجموعات في قسم «' + category.title + '».');
          return true;
        }

        putSession(key, {
          ...session,
          stage: 'select',
          category: input,
          groups
        });

        const list =
          '📂 ' + category.title + '\n' +
          'عدد المجموعات: ' + groups.length + '\n\n' +
          formatGroups(groups) +
          '\n\nأرسل رقم المجموعة التي تريد مراجعتها.\nاكتب إلغاء لإيقاف العملية.';

        // قسم OTHER يعرض القائمة كاملة في رسالة واحدة.
        // نرسل رسالة واحدة في جميع الأقسام متى كانت ضمن حد Messenger.
        if (list.length > 1900) {
          removeSession(key);
          await send(api, event,
            '⚠️ القائمة تحتوي على ' + groups.length +
            ' مجموعة وطولها ' + list.length +
            ' حرفًا، وقد تتجاوز حد رسالة Messenger الواحدة. لم أرسل قائمة ناقصة.'
          );
          return true;
        }

        await send(api, event, list);
      } catch (error) {
        removeSession(key);
        await send(api, event,
          '❌ فشل جلب المجموعات:\n' +
          String(error?.message || error).slice(0, 250)
        );
      }

      return true;
    }

    if (session.stage === 'select') {
      if (!/^\d+$/.test(input)) {
        await send(api, event, 'أرسل رقمًا من 1 إلى ' + session.groups.length + '.');
        return true;
      }

      const number = Number(input);
      if (number < 1 || number > session.groups.length) {
        await send(api, event, 'الرقم غير صحيح. اختر من 1 إلى ' + session.groups.length + '.');
        return true;
      }

      const selected = session.groups[number - 1];

      putSession(key, { ...session, stage: 'confirm', selected });

      await send(api, event, [
        'هل تريد تنفيذ العملية على هذه المجموعة؟',
        '',
        '📌 الاسم: ' + selected.name,
        '🆔 ID: ' + selected.id,
        '',
        '1️⃣ نعم — تأكيد',
        '2️⃣ لا — إلغاء'
      ].join('\n'));

      return true;
    }

    if (session.stage === 'confirm') {
      if (input === '2') {
        removeSession(key);
        await send(api, event, 'تم الإلغاء. لم يتم إرسال أي رسالة للمجموعة.');
        return true;
      }

      if (input !== '1') {
        await send(api, event, 'أرسل 1 للتأكيد أو 2 للإلغاء.');
        return true;
      }

      const selected = session.selected;
      const category = CATEGORIES[session.category];

      try {
        if (category.needsAccept) {
          await apiCall(api, 'handleMessageRequest', [selected.id, true]);
        }

        const result = await api.sendMessage(ROCKET, selected.id);

        if (result?.suppressed) {
          removeSession(key);
          await send(api, event,
            '⚠️ تم تنفيذ خطوة القبول إن لزم، لكن نظام الحماية منع الإرسال: ' +
            String(result.reason || 'suppressed')
          );
          return true;
        }

        removeSession(key);
        await send(api, event,
          '✅ تمت العملية على المجموعة:\n' + selected.name +
          '\n\nتم إرسال ' + ROCKET
        );
      } catch (error) {
        removeSession(key);
        await send(api, event,
          '❌ فشلت العملية:\n' +
          String(error?.message || error).slice(0, 250) +
          '\n\nتحقق من حالة المجموعة قبل إعادة المحاولة.'
        );
      }

      return true;
    }

    removeSession(key);
    return false;
  }
};
