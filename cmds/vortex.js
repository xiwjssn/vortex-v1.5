'use strict';

function normalize(value) {
  return String(value || '')
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[أإآ]/g, 'ا')
    .toLowerCase()
    .trim();
}

module.exports = {
  name: 'vortex',
  aliases: ['فورتيكس'],
  description: 'تكرار رسالة واحدة بفاصل زمني وإيقافها عند غياب تفاعل الأعضاء',
  adminOnly: true,

  async execute(api, event) {
    const threadID = String(event.threadID || '');
    const args = Array.isArray(event.args) ? [...event.args] : [];
    const runtime = event.runtime;

    if (!threadID || !runtime ||
        typeof runtime.startRepeatingMessage !== 'function' ||
        typeof runtime.stopRepeatingMessage !== 'function') {
      return api.sendMessage('❌ نظام التكرار غير جاهز. حدّث البوت وحاول مجدداً.', threadID, event.messageID);
    }

    if (['off', 'ايقاف', 'وقف'].includes(normalize(args[0]))) {
      const result = runtime.stopRepeatingMessage(threadID);
      return api.sendMessage(
        result.stopped ? '🛑 تم إيقاف تكرار VORTEX في هذه المجموعة.' : 'ℹ️ لا يوجد تكرار يعمل حالياً.',
        threadID,
        event.messageID
      );
    }

    const durationToken = args.pop() || '';
    const match = normalize(durationToken).match(
      /^(\d+)(ث|ثانيه|ثواني|د|دقيقه|دقائق|s|sec|m|min)$/
    );

    if (!match) {
      const prefix = String(event.config?.prefix || '*');
      return api.sendMessage(
        'طريقة الاستخدام:\n' +
        prefix + 'vortex اهلا بالجميع 20ث\n' +
        prefix + 'vortex صباح الخير 1د\n\n' +
        'للإيقاف: ' + prefix + 'vortex off\n' +
        'أقل فاصل 15 ثانية وأقصاه 24 ساعة.',
        threadID,
        event.messageID
      );
    }

    const amount = Number(match[1]);
    const unit = match[2];
    const isMinutes = ['د', 'دقيقه', 'دقائق', 'm', 'min'].includes(unit);
    const intervalMs = amount * (isMinutes ? 60000 : 1000);
    const messageText = args.join(' ').trim();

    if (!messageText) {
      return api.sendMessage('❗ اكتب الرسالة قبل الوقت، مثال: vortex اهلا 20ث', threadID, event.messageID);
    }

    if (!Number.isSafeInteger(amount) || amount <= 0 ||
        intervalMs < 15000 || intervalMs > 86400000) {
      return api.sendMessage('⏱️ الفاصل يجب أن يكون بين 15 ثانية و24 ساعة.', threadID, event.messageID);
    }

    const result = runtime.startRepeatingMessage({
      threadID,
      senderID: String(event.senderID || ''),
      messages: [messageText],
      intervalMs,
      inactivityMs: 16 * 60 * 1000
    });

    if (!result.started) {
      const reason = result.reason === 'already-running'
        ? 'يوجد تكرار يعمل بالفعل. أرسل vortex off أولاً.'
        : result.reason === 'offline'
          ? 'البوت غير متصل حالياً.'
          : 'رفض نظام التكرار البيانات. تحقق من الفاصل والرسالة.';
      return api.sendMessage('⚠️ ' + reason, threadID, event.messageID);
    }

    return api.sendMessage(
      '✅ تم تشغيل VORTEX.\n' +
      '💬 الرسالة: ' + messageText + '\n' +
      '⏱️ الفاصل: ' + (isMinutes ? amount + ' دقيقة' : amount + ' ثانية') + '\n' +
      '🛑 للإيقاف: vortex off\n' +
      'يتوقف تلقائياً بعد 16 دقيقة دون رسالة من عضو آخر.',
      threadID,
      event.messageID
    );
  }
};
