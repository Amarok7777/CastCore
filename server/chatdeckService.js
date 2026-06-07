const YT_API = 'https://www.googleapis.com/youtube/v3';

// YouTube InnerTube (no API key required — uses YouTube's own internal API)
const INNERTUBE_KEY     = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const INNERTUBE_VERSION = '2.20240101.00.00';
const INNERTUBE_CTX     = { client: { clientName: 'WEB', clientVersion: INNERTUBE_VERSION } };
const YT_HEADERS        = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

// In-memory state per session (API-key mode)
let liveChatId    = null;
let nextPageToken = null;
let pollingMs     = 5000;
let lastVideoId   = null;
let messageBuffer = [];
const MAX_BUFFER  = 500;

// In-memory state (InnerTube / no-key mode)
let itContinuation = null;
let itVideoId      = null;

// ── HTTP helpers ───────────────────────────────────────────────────────

function _withTimeout(ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(id) };
}

async function _getJson(url, headers = {}) {
  const { signal, clear } = _withTimeout(10_000);
  try {
    const res  = await fetch(url, { headers, signal });
    const json = await res.json().catch(() => { throw new Error('Invalid JSON from YouTube API'); });
    return json;
  } finally { clear(); }
}

async function _postJson(url, body, headers = {}) {
  const { signal, clear } = _withTimeout(10_000);
  try {
    const res  = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
    const json = await res.json().catch(() => { throw new Error('InnerTube: Ungültige Antwort'); });
    return json;
  } finally { clear(); }
}

// ── Message transformation ─────────────────────────────────────────────

function _mapYtMessages(items) {
  return (items || []).map(item => {
    const rawType   = item.snippet?.type || 'textMessageEvent';
    let   eventType = 'text';
    if (rawType === 'superChatEvent')       eventType = 'superchat';
    else if (rawType === 'superStickerEvent') eventType = 'supersticker';
    else if (rawType === 'newSponsorEvent' || rawType === 'memberMilestoneChatEvent') eventType = 'membership';

    const amount = item.snippet?.superChatDetails?.amountDisplayString
      || item.snippet?.superStickerDetails?.amountDisplayString
      || '';
    const text = item.snippet?.displayMessage
      || (eventType === 'supersticker' ? 'Super Sticker' : '')
      || (eventType === 'membership'   ? 'New Membership' : '');

    return {
      id:          item.id,
      platform:    'youtube',
      authorName:  item.authorDetails?.displayName || 'Unknown',
      authorColor: '#ff4040',
      text,
      publishedAt: item.snippet?.publishedAt || new Date().toISOString(),
      eventType,
      rawType,
      amount,
    };
  }).filter(m => m.text || m.eventType !== 'text');
}

const _bufferIds = new Set();

function _addToBuffer(messages) {
  for (const m of messages) {
    if (m.id && _bufferIds.has(m.id)) continue;
    if (m.id) _bufferIds.add(m.id);
    messageBuffer.push(m);
  }
  if (messageBuffer.length > MAX_BUFFER) {
    const removed = messageBuffer.splice(0, messageBuffer.length - MAX_BUFFER);
    for (const m of removed) _bufferIds.delete(m.id);
  }
}

// ── Live-chat ID resolution ────────────────────────────────────────────

async function _resolveChatId(videoId, auth) {
  const url = `${YT_API}/videos?part=liveStreamingDetails&id=${encodeURIComponent(videoId)}`;
  const headers = auth.apiKey
    ? {}
    : { Authorization: `Bearer ${auth.accessToken}`, Accept: 'application/json' };
  const urlWithKey = auth.apiKey ? `${url}&key=${encodeURIComponent(auth.apiKey)}` : url;

  const data = await _getJson(urlWithKey, headers);
  if (data.error) throw new Error(data.error.message || 'YouTube API error');
  const chatId = data.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
  if (!chatId) throw new Error('No active live chat for this video');
  return chatId;
}

// ── Polling ────────────────────────────────────────────────────────────

async function fetchMessages(apiKey, videoId) {
  if (!apiKey || !videoId) return { messages: [], error: 'API key and video ID required' };
  try {
    if (!liveChatId || videoId !== lastVideoId) {
      liveChatId    = await _resolveChatId(videoId, { apiKey });
      nextPageToken = null;
      lastVideoId   = videoId;
    }

    let url = `${YT_API}/liveChat/messages?liveChatId=${encodeURIComponent(liveChatId)}&part=snippet,authorDetails&maxResults=200&key=${encodeURIComponent(apiKey)}`;
    if (nextPageToken) url += `&pageToken=${encodeURIComponent(nextPageToken)}`;

    const data = await _getJson(url);
    if (data.error) {
      if (data.error.code === 403 || data.error.code === 404) { liveChatId = null; nextPageToken = null; lastVideoId = null; }
      return { messages: [], error: data.error.message || 'YouTube API error' };
    }

    nextPageToken = data.nextPageToken || nextPageToken;
    pollingMs     = data.pollingIntervalMillis || 5000;
    const newMessages = _mapYtMessages(data.items);
    _addToBuffer(newMessages);
    return { messages: newMessages, pollingMs, liveChatId };
  } catch (e) {
    return { messages: [], error: e.message || 'Unknown error' };
  }
}

async function fetchMessagesOAuth(accessToken, videoId) {
  if (!accessToken || !videoId) return { messages: [], error: 'OAuth token and video ID required' };
  try {
    if (!liveChatId || videoId !== lastVideoId) {
      liveChatId    = await _resolveChatId(videoId, { accessToken });
      nextPageToken = null;
      lastVideoId   = videoId;
    }

    let url = `${YT_API}/liveChat/messages?liveChatId=${encodeURIComponent(liveChatId)}&part=snippet,authorDetails&maxResults=200`;
    if (nextPageToken) url += `&pageToken=${encodeURIComponent(nextPageToken)}`;

    const data = await _getJson(url, { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' });
    if (data.error) {
      if (data.error.code === 401 || data.error.code === 403 || data.error.code === 404) { liveChatId = null; nextPageToken = null; lastVideoId = null; }
      return { messages: [], error: data.error.message || 'YouTube API error' };
    }

    nextPageToken = data.nextPageToken || nextPageToken;
    pollingMs     = data.pollingIntervalMillis || 5000;
    const newMessages = _mapYtMessages(data.items);
    _addToBuffer(newMessages);
    return { messages: newMessages, pollingMs, liveChatId };
  } catch (e) {
    return { messages: [], error: e.message || 'Unknown error' };
  }
}

async function findOwnLiveStreamOAuth(accessToken) {
  if (!accessToken) throw new Error('Missing OAuth token');
  const data = await _getJson(
    `${YT_API}/liveBroadcasts?part=id,snippet&broadcastStatus=active&broadcastType=all`,
    { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  );
  if (data.error) throw new Error(data.error.message || 'YouTube API Fehler');
  const item = (data.items || [])[0];
  if (!item) throw new Error('Kein aktiver Livestream auf deinem YouTube-Konto gefunden');
  return {
    videoId:      item.id,
    title:        item.snippet?.title || 'Livestream',
    channelTitle: item.snippet?.channelTitle || '',
    channelId:    item.snippet?.channelId || '',
  };
}

async function resolveChannelId(apiKey, channelInput) {
  const raw = channelInput.trim();
  if (/^UC[\w-]{20,}$/.test(raw)) return raw;

  let handle = raw;
  const urlMatch = raw.match(/youtube\.com\/(?:@|c\/|user\/)?([^/?&\s]+)/i);
  if (urlMatch) handle = urlMatch[1];
  handle = handle.replace(/^@/, '').trim();

  const handleData = await _getJson(`${YT_API}/channels?part=id&forHandle=${encodeURIComponent('@' + handle)}&key=${encodeURIComponent(apiKey)}`);
  if (handleData.items?.[0]?.id) return handleData.items[0].id;

  const userData = await _getJson(`${YT_API}/channels?part=id&forUsername=${encodeURIComponent(handle)}&key=${encodeURIComponent(apiKey)}`);
  if (userData.items?.[0]?.id) return userData.items[0].id;

  throw new Error(`Kanal "${handle}" nicht gefunden — prüf den Handle oder nutze direkt die Channel-ID (UC…)`);
}

async function findLiveStream(apiKey, channelInput) {
  if (!apiKey)       throw new Error('Kein API-Key hinterlegt');
  if (!channelInput) throw new Error('Kein Kanal angegeben');
  const channelId = await resolveChannelId(apiKey, channelInput);
  const data = await _getJson(`${YT_API}/search?part=snippet&channelId=${encodeURIComponent(channelId)}&eventType=live&type=video&key=${encodeURIComponent(apiKey)}`);
  if (data.error) throw new Error(data.error.message || 'YouTube API Fehler');
  const item = (data.items || [])[0];
  if (!item) throw new Error('Kein aktiver Livestream auf diesem Kanal gefunden');
  return { videoId: item.id.videoId, title: item.snippet.title, channelTitle: item.snippet.channelTitle };
}

function reset() {
  liveChatId = null; nextPageToken = null; lastVideoId = null;
  pollingMs  = 5000;
  messageBuffer = []; _bufferIds.clear();
  itContinuation = null; itVideoId = null;
}

// ── InnerTube (no API key) ─────────────────────────────────────────────

async function findLiveStreamNoKey(channelInput) {
  let raw = channelInput.trim();
  const urlMatch = raw.match(/youtube\.com\/(?:@|c\/|user\/)?([^/?&\s]+)/i);
  if (urlMatch) raw = urlMatch[1];
  raw = raw.replace(/^@/, '').trim();

  const res  = await fetch(`https://www.youtube.com/@${encodeURIComponent(raw)}/live`, { headers: YT_HEADERS, redirect: 'follow' });
  const html = await res.text();

  const isLive = html.includes('"isLiveNow":true') || html.includes('"isLive":true') || html.includes('liveBroadcast');
  if (!isLive) throw new Error('Kanal streamt gerade nicht');

  const allVideoIds = [...html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)].map(m => m[1]);
  if (!allVideoIds.length) throw new Error('Video-ID nicht gefunden');

  return {
    videoId:      allVideoIds[0],
    title:        html.match(/"title":"([^"]{3,200})"/)?.[1]   || 'Livestream',
    channelTitle: html.match(/"ownerChannelName":"([^"]+)"/)?.[1] || raw,
  };
}

async function getItContinuation(videoId) {
  const res  = await fetch(`https://www.youtube.com/live_chat?is_popout=1&v=${encodeURIComponent(videoId)}`, { headers: YT_HEADERS });
  const html = await res.text();
  const match = html.match(/"continuation":"([A-Za-z0-9_%-]{80,})"/);
  if (!match) throw new Error('Kein Live-Chat für dieses Video gefunden (ist der Stream live?)');
  return match[1];
}

async function fetchMessagesNoKey(videoId) {
  if (!videoId) return { messages: [], error: 'Keine Video-ID angegeben', pollingMs: 5000 };
  try {
    if (!itContinuation || videoId !== itVideoId) {
      itContinuation = await getItContinuation(videoId);
      itVideoId      = videoId;
    }

    const url  = `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${INNERTUBE_KEY}&prettyPrint=false`;
    const data = await _postJson(url, { context: INNERTUBE_CTX, continuation: itContinuation }, {
      ...YT_HEADERS,
      Origin:  'https://www.youtube.com',
      Referer: 'https://www.youtube.com/',
      'X-YouTube-Client-Name':    '1',
      'X-YouTube-Client-Version': INNERTUBE_VERSION,
    });

    const chatCont = data?.continuationContents?.liveChatContinuation;
    if (!chatCont) { itContinuation = null; return { messages: [], error: 'Live-Chat nicht erreichbar', pollingMs: 5000 }; }

    const conts   = chatCont.continuations || [];
    const nextCont = conts[0]?.timedContinuationData?.continuation || conts[0]?.invalidationContinuationData?.continuation;
    if (nextCont) itContinuation = nextCont;

    const nextPoll = conts[0]?.timedContinuationData?.timeoutMs || conts[0]?.invalidationContinuationData?.timeoutMs || 5000;

    const messages = (chatCont.actions || [])
      .map(a => a?.addChatItemAction?.item)
      .filter(Boolean)
      .map(item => {
        const textR   = item.liveChatTextMessageRenderer;
        const paidR   = item.liveChatPaidMessageRenderer;
        const stickR  = item.liveChatPaidStickerRenderer;
        const memberR = item.liveChatMembershipItemRenderer;
        const r       = textR || paidR || stickR || memberR;
        if (!r) return null;

        let eventType = 'text';
        if (paidR)   eventType = 'superchat';
        else if (stickR)  eventType = 'supersticker';
        else if (memberR) eventType = 'membership';

        const textRuns = (r.message?.runs || []).map(run => run.text || '').join('');
        const amount   = paidR?.purchaseAmountText?.simpleText || stickR?.purchaseAmountText?.simpleText || '';
        const text     = textRuns
          || (eventType === 'supersticker' ? 'Super Sticker' : '')
          || (eventType === 'membership'   ? 'New Membership' : '');

        return {
          id:          r.id,
          platform:    'youtube',
          authorName:  r.authorName?.simpleText || 'Unknown',
          authorColor: '#ff4040',
          text,
          publishedAt: r.timestampUsec ? new Date(Math.floor(parseInt(r.timestampUsec, 10) / 1000)).toISOString() : new Date().toISOString(),
          eventType,
          amount,
        };
      })
      .filter(Boolean)
      .filter(m => m.text || m.eventType !== 'text');

    return { messages, pollingMs: nextPoll, liveChatId: 'innertube' };
  } catch (e) {
    itContinuation = null;
    return { messages: [], error: e.message || 'InnerTube-Fehler' };
  }
}

function getPollingMs() { return pollingMs; }

module.exports = {
  fetchMessages,
  fetchMessagesNoKey,
  findLiveStream,
  findLiveStreamNoKey,
  reset,
  getPollingMs,
};
