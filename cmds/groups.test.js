const test = require('node:test');
const assert = require('node:assert/strict');
const groups = require('./groups');

function makeApi({ threads = [], acceptError = null } = {}) {
  const sent = [];
  const accepted = [];
  return {
    sent,
    accepted,
    async sendMessage(message, threadID) {
      sent.push({ message: String(message), threadID: String(threadID) });
      return { ok: true };
    },
    getThreadList(limit, timestamp, tags, callback) {
      assert.equal(limit, 100);
      assert.equal(timestamp, null);
      callback(null, threads);
    },
    handleMessageRequest(threadID, accept, callback) {
      accepted.push({ threadID: String(threadID), accept: !!accept });
      callback(acceptError);
    }
  };
}

function event(body, threadID = 'owner-chat') {
  return { threadID, senderID: 'owner-1', body, isOwner: true };
}

async function openSelection(api, threadID) {
  await groups.execute(api, event('*groups', threadID));
  await groups.handleReply(api, event('1', threadID));
}

test('shows only recognized group threads and ignores duplicate IDs', async () => {
  const api = makeApi({ threads: [
    { threadID: 'g1', name: 'Group 1', isGroup: true },
    { threadID: 'p1', name: 'Person', isGroup: false },
    { threadID: 'g1', name: 'Duplicate', isGroup: true },
    { threadID: 'g2', name: 'Group 2', isGroup: 1 }
  ] });
  await openSelection(api, 'group-list-test');
  const list = api.sent.at(-1).message;
  assert.match(list, /Group 1/);
  assert.match(list, /Group 2/);
  assert.doesNotMatch(list, /Person/);
  assert.equal((list.match(/ID: g1/g) || []).length, 1);
  await groups.handleReply(api, event('إلغاء', 'group-list-test'));
});

test('owner confirmation accepts a pending group and sends the rocket only after confirmation', async () => {
  const api = makeApi({ threads: [{ threadID: 'target-group', name: 'Target', isGroup: true }] });
  const threadID = 'group-confirm-test';
  await openSelection(api, threadID);
  await groups.handleReply(api, event('1', threadID));
  assert.match(api.sent.at(-1).message, /هل تريد تنفيذ العملية/);
  await groups.handleReply(api, event('1', threadID));
  assert.deepEqual(api.accepted, [{ threadID: 'target-group', accept: true }]);
  assert.ok(api.sent.some(item => item.threadID === 'target-group' && item.message === '𝑹𝑶𝑪𝑲𝑬𝑻 🚀'));
  await groups.handleReply(api, event('إلغاء', threadID));
});

test('declining a selected group does not accept it or send to it', async () => {
  const api = makeApi({ threads: [{ threadID: 'target-group', name: 'Target', isGroup: true }] });
  const threadID = 'group-decline-test';
  await openSelection(api, threadID);
  await groups.handleReply(api, event('1', threadID));
  await groups.handleReply(api, event('2', threadID));
  assert.deepEqual(api.accepted, []);
  assert.equal(api.sent.some(item => item.threadID === 'target-group'), false);
});

test('reports an unsupported thread-list API without throwing out of the handler', async () => {
  const sent = [];
  const api = { sendMessage: async message => sent.push(String(message)) };
  await groups.execute(api, event('*groups', 'group-api-test'));
  const handled = await groups.handleReply(api, event('1', 'group-api-test'));
  assert.equal(handled, true);
  assert.match(sent.at(-1), /فشل جلب المجموعات/);
  await groups.handleReply(api, event('إلغاء', 'group-api-test'));
});
