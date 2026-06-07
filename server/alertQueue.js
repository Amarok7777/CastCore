'use strict';

// In-memory queue for the alertdeck overlay poll endpoint.
// Events are pushed here from all sources (Twitch IRC, YouTube InnerTube,
// backfill, inject) and drained by GET /api/alertdeck/poll every 350 ms.

const MAX = 200;
const queue = [];

function push(item) {
  if (!item || typeof item !== 'object') return;
  queue.push(item);
  if (queue.length > MAX) queue.splice(0, queue.length - MAX);
}

function drain() {
  return queue.splice(0, queue.length);
}

module.exports = { push, drain };
