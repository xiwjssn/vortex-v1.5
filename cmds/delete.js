'use strict';

function unsendMessage(api, messageID) {
  return new Promise((resolve, reject) => {
    if (typeof api?.unsendMessage !== 'function') {
      reject(new Error('نسخة FCA لا تدعم unsendMessage'));
      return;
    }

    let settled = false;
    const timer = setTimeout(() => finish(new Error('انتهت مهلة حذف الرسالة')), 15000);

    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    }

    try {
      const result = api.unsendMessage(String(messageID), finish);

      if (result && typeof result.then === 'function') {
        result.then(value => finish(null, value), error => finish(error));
      } else if (result !== undefined && api.unsendMessage.length < 2) {
        finish(null, result);
      }
    } catch (error) {
      finish(error);
    }
  });
}

module.exports = {
  name: 'حذف',
  aliases: ['delete', 'unsend'],
  description: 'حذف رسالة البوت بالرد عليها',
  adminOnly: true,

  async execute(api, event) {
    const replied = event.messageReply;
    if (!replied?.messageID) return;

    let botID = '';

    try {
      if (typeof api.getCurrentUserID === 'function') {
        botID = String(api.getCurrentUserID() || '');
      }
    } catch {
      return;
    }

    if (!botID || String(replied.senderID || '') !== botID) return;

    try {
      await unsendMessage(api, replied.messageID);
    } catch (error) {
      // Silent for the user; keep the failure visible in Railway logs.
      console.error('[DELETE_COMMAND_FAILED]', String(error?.message || error).slice(0, 200));
    }

    // No confirmation message is sent.
    return;
  }
};
