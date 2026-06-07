const MAX_HISTORY = 500;

let history = [];

function normalizeMessage(raw) {
  const baseTime = raw.time || raw._time || raw.publishedAt || new Date().toISOString();
  return {
    id: raw.id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    platform: String(raw.platform || 'chat'),
    authorName: String(raw.authorName || 'Unknown'),
    authorColor: String(raw.authorColor || '#ffffff'),
    text: String(raw.text || ''),
    time: baseTime,
    eventType: raw.eventType || 'text',
    rawType: raw.rawType || '',
    amount: raw.amount || '',
    msgId: String(raw.msgId || ''),
    userId: String(raw.userId || ''),
  };
}

function addMessage(raw) {
  const msg = normalizeMessage(raw || {});
  if (!msg.text && msg.eventType === 'text') return { added: false, message: msg };
  if (history.some(entry => entry.id === msg.id)) {
    return { added: false, message: msg };
  }
  history.push(msg);
  if (history.length > MAX_HISTORY) {
    history = history.slice(-MAX_HISTORY);
  }
  return { added: true, message: msg };
}

function addMessages(items) {
  const added = [];
  for (const item of (items || [])) {
    const result = addMessage(item);
    if (result.added) added.push(result.message);
  }
  return added;
}

function getHistory() {
  return history.slice();
}

function clear() {
  history = [];
}

module.exports = { addMessage, addMessages, getHistory, clear };
