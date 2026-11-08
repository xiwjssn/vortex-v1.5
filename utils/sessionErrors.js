'use strict';

function isSessionAuthError(value) {
  const message = String(value?.message || value || '').toLowerCase();
  return /checkpoint|login approval|login required|invalid appstate|invalid cookie|cookie.{0,20}(expired|invalid)|session.{0,20}(expired|invalid)|not logged in|authentication failed|account disabled|account restricted|temporarily blocked|login[_\s-]?blocked|user[_\s-]?id\s*[=:]\s*0|two.factor|\b401\b|\b403\b|please log in/.test(message);
}

module.exports = { isSessionAuthError };
