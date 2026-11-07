'use strict';

function formatUptime(milliseconds) {
  let seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  const days = Math.floor(seconds / 86400); seconds %= 86400;
  const hours = Math.floor(seconds / 3600); seconds %= 3600;
  const minutes = Math.floor(seconds / 60); seconds %= 60;
  const parts = [];
  if (days) parts.push(days + ' يوم');
  if (hours) parts.push(hours + ' ساعة');
  if (minutes) parts.push(minutes + ' دقيقة');
  parts.push(seconds + ' ثانية');
  return parts.join(' و ');
}

function formatLocationTime(timeZone) {
  const now = new Date();
  const date = new Intl.DateTimeFormat('ar', {
    timeZone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  }).format(now);
  const time = new Intl.DateTimeFormat('ar', {
    timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: true
  }).format(now);
  return date + ' — ' + time;
}

module.exports = {
  formatUptime,
  name: 'uptime',
  aliases: ['up', 'مدة', 'مدة_التشغيل'],
  description: 'معلومات VORTEX ومدة التشغيل وتوقيت ليبيا والجزائر',

  async execute(api, event) {
    const state = event.runtime?.getState?.() || {};
    const status = state.connected || state.status === 'connected' ? '🟢 متصل' : '🔴 غير متصل';
    const memory = process.memoryUsage();
    const mb = value => (value / 1024 / 1024).toFixed(1) + ' MB';

    const message = [
      '╭─「 🌀 VORTEX 」',
      '│ 👨‍💻 المطور: Magnus',
      '│ 📦 الإصدار: VORTEX V1.5',
      '│ 📡 الحالة: ' + status,
      '│ ⏱️ مدة التشغيل: ' + formatUptime(state.uptimeMs || process.uptime() * 1000),
      '│ 🟩 Node.js: ' + process.version,
      '│ 💾 الذاكرة: ' + mb(memory.rss),
      '│ ├ Heap: ' + mb(memory.heapUsed) + ' / ' + mb(memory.heapTotal),
      '├─「 🌍 التوقيت المحلي 」',
      '│ 🇱🇾 ليبيا: ' + formatLocationTime('Africa/Tripoli'),
      '│ 🇩🇿 الجزائر: ' + formatLocationTime('Africa/Algiers'),
      '╰────────────────'
    ].join('\n');

    return api.sendMessage(message, event.threadID, event.messageID);
  }
};
