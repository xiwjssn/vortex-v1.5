const test = require('node:test');
const assert = require('node:assert/strict');
const command = require('./video');
const { parseUrl, validateVideoUrl, MAX_VIDEO_BYTES } = command._test;

test('parses the video command using the configured prefix', () => {
  assert.equal(parseUrl('*فرد https://youtu.be/abc'), 'https://youtu.be/abc');
  assert.equal(parseUrl('!فيديو https://tiktok.com/@x/video/1', '!'), 'https://tiktok.com/@x/video/1');
  assert.equal(parseUrl('*فرد'), '');
});

test('accepts only HTTPS URLs from the four configured platforms', () => {
  for (const url of [
    'https://www.tiktok.com/@x/video/1',
    'https://fb.watch/abc',
    'https://www.instagram.com/reel/abc/',
    'https://youtu.be/abc'
  ]) assert.ok(validateVideoUrl(url));
  assert.throws(() => validateVideoUrl('http://youtube.com/watch?v=x'));
  assert.throws(() => validateVideoUrl('https://evil.example/video'));
  assert.throws(() => validateVideoUrl('https://youtube.com.evil.example/video'));
  assert.throws(() => validateVideoUrl('https://user:pass@youtube.com/video'));
});

test('uses a strict 50 MiB maximum', () => {
  assert.equal(MAX_VIDEO_BYTES, 50 * 1024 * 1024);
});
