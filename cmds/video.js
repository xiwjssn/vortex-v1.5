const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');

const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const ALLOWED_HOSTS = new Set([
  'tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com',
  'facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.watch',
  'instagram.com', 'www.instagram.com', 'instagr.am',
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'music.youtube.com'
]);

function parseUrl(body, prefix = '*') {
  const text = String(body || '').trim();
  const escaped = String(prefix || '*').replace(/[|\\{}()[\]^$+*?.-]/g, '\\$&');
  const match = text.match(new RegExp('^' + escaped + '(?:فرد|فيديو|video)(?:\\s+|$)', 'i'));
  return match ? text.slice(match[0].length).trim().split(/\\s+/)[0] || '' : '';
}

function validateVideoUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { throw new Error('الرابط غير صالح.'); }
  if (url.protocol !== 'https:' || url.username || url.password || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('الرابط لازم يكون من TikTok أو Facebook أو Instagram أو YouTube فقط.');
  }
  return url.toString();
}

function runYtDlp(url, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '--no-playlist', '--no-warnings', '--no-progress',
      '--socket-timeout', '20', '--retries', '2',
      '--max-filesize', '50M',
      '-f', 'best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '-o', outputPath,
      url
    ];
    const child = spawn('yt-dlp', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('انتهت مهلة تنزيل الفيديو (دقيقتان).'));
    }, 2 * 60 * 1000);
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve();
    };
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-3000); });
    child.once('error', error => {
      if (error.code === 'ENOENT') finish(new Error('أداة تنزيل الفيديو غير مثبتة على السيرفر.'));
      else finish(error);
    });
    child.once('close', code => {
      if (code === 0) finish();
      else finish(new Error(/max-filesize|file is larger|filesize/i.test(stderr)
        ? 'حجم الفيديو أكبر من 50MB.'
        : 'تعذّر تنزيل الفيديو. قد يكون الرابط خاصاً أو غير مدعوم حالياً.'));
    });
    timer.unref?.();
  });
}

async function downloadVideo(url) {
  const safeUrl = validateVideoUrl(url);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vortex-video-'));
  const output = path.join(dir, randomUUID() + '.%(ext)s');
  try {
    await runYtDlp(safeUrl, output);
    const entries = await fs.readdir(dir);
    if (!entries.length) throw new Error('لم يتم العثور على ملف فيديو بعد التنزيل.');
    const filePath = path.join(dir, entries[0]);
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size === 0) throw new Error('ملف الفيديو فارغ أو غير صالح.');
    if (stat.size > MAX_VIDEO_BYTES) throw new Error('حجم الفيديو أكبر من 50MB.');
    return { dir, filePath, size: stat.size };
  } catch (error) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function sendAttachment(api, event, filePath) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = error => {
      if (settled) return;
      settled = true;
      error ? reject(error) : resolve();
    };
    try {
      const result = api.sendMessage({
        body: '🎬 تفضل الفيديو',
        attachment: createReadStream(filePath)
      }, event.threadID, event.messageID, done);
      if (result && typeof result.then === 'function') result.then(() => done(), done);
      else if (result !== undefined && api.sendMessage.length < 4) done();
    } catch (error) { done(error); }
  });
}

module.exports = {
  name: 'فرد',
  aliases: ['فيديو', 'video'],
  description: 'تنزيل فيديو من TikTok وFacebook وInstagram وYouTube (حتى 50MB)',
  _test: { parseUrl, validateVideoUrl, MAX_VIDEO_BYTES },
  async execute(api, event) {
    const url = parseUrl(event?.body, event?.config?.prefix || '*');
    if (!url) {
      return api.sendMessage('🎬 أرسل الرابط بعد الأمر.\\nمثال: *فرد https://www.tiktok.com/...', event.threadID, event.messageID);
    }
    let downloaded;
    try {
      downloaded = await downloadVideo(url);
      await sendAttachment(api, event, downloaded.filePath);
    } catch (error) {
      await api.sendMessage('❌ ' + String(error?.message || error).slice(0, 180), event.threadID, event.messageID);
    } finally {
      if (downloaded?.dir) await fs.rm(downloaded.dir, { recursive: true, force: true }).catch(() => {});
    }
  }
};
