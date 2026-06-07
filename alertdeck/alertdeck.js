'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

const EVENT_TYPES = [
  {id:'follower',    get name(){ return t('alertdeck.event.follower'); },    platform:'twitch'},
  {id:'sub',         get name(){ return t('alertdeck.event.sub'); },         platform:'twitch'},
  {id:'resub',       get name(){ return t('alertdeck.event.resub'); },       platform:'twitch'},
  {id:'subgift',     get name(){ return t('alertdeck.event.subgift'); },     platform:'twitch'},
  {id:'raid',        get name(){ return t('alertdeck.event.raid'); },        platform:'twitch'},
  {id:'bits',        get name(){ return t('alertdeck.event.bits'); },        platform:'twitch'},
  {id:'superchat',   get name(){ return t('alertdeck.event.superchat'); },   platform:'youtube'},
  {id:'supersticker',get name(){ return t('alertdeck.event.supersticker'); },platform:'youtube'},
  {id:'membership',  get name(){ return t('alertdeck.event.membership'); },  platform:'youtube'},
  {id:'donation',    get name(){ return t('alertdeck.event.donation'); },    platform:'general'},
];

const DEFAULT_TEST_SAMPLES = {
  follower:    {author:'ExampleUser',   text:'just followed',            amount:'',      viewers:''},
  sub:         {author:'ExampleUser',   text:'subscribed for 1 month',   amount:'',      viewers:''},
  resub:       {author:'ExampleUser',   text:'resubscribed for 3 months',amount:'',      viewers:''},
  subgift:     {author:'ExampleUser',   text:'gifted a sub to SomeUser', amount:'',      viewers:''},
  raid:        {author:'ExampleRaider', text:'is raiding',               amount:'',      viewers:'25'},
  bits:        {author:'ExampleUser',   text:'Cheer!',                   amount:'500',   viewers:''},
  superchat:   {author:'ExampleUser',   text:'Amazing stream!',          amount:'5 EUR', viewers:''},
  supersticker:{author:'ExampleUser',   text:'',                         amount:'2 EUR', viewers:''},
  membership:  {author:'ExampleUser',   text:'Joined as member',         amount:'',      viewers:''},
  donation:    {author:'ExampleUser',   text:'Great stream!',            amount:'10 USD',viewers:''},
};

const ANIM_IN  = ['bounceInRight','bounceInLeft','bounceInDown','bounceInUp','fadeIn','fadeInRight','fadeInLeft','fadeInDown','fadeInUp','zoomIn','slideInRight','slideInLeft','slideInDown','flipInX'];
const ANIM_OUT = ['bounceOutRight','bounceOutLeft','bounceOutDown','bounceOutUp','fadeOut','fadeOutRight','fadeOutLeft','zoomOut','slideOutRight','slideOutUp','flipOutX'];
const FONTS    = ['Archivo','Roboto','Montserrat','Oswald','Raleway','Nunito','Poppins','Open Sans','Impact','Arial','Georgia'];
const POSITIONS = [
  {id:'tl',label:'↖'},{id:'tc',label:'↑'},{id:'tr',label:'↗'},
  {id:'ml',label:'←'},{id:'mc',label:'●'},{id:'mr',label:'→'},
  {id:'bl',label:'↙'},{id:'bc',label:'↓'},{id:'br',label:'↘'},
];
const LABELS = [
  {key:'latest_follower',   name:'Letzter Follower',           group:'twitch'},
  {key:'latest_sub',        name:'Letzter Sub',                group:'twitch'},
  {key:'latest_resub',      name:'Letzter Resub',              group:'twitch'},
  {key:'latest_subgift',    name:'Letzter Gift Sub',           group:'twitch'},
  {key:'latest_raid',       name:'Letzter Raid',               group:'twitch'},
  {key:'latest_bits',       name:'Letzte Bits',                group:'twitch'},
  {key:'total_followers',   name:'Followers gesamt',           group:'twitch'},
  {key:'total_subs',        name:'Subs gesamt',                group:'twitch'},
  {key:'total_raids',       name:'Raids gesamt',               group:'twitch'},
  {key:'total_bits',        name:'Bits gesamt',                group:'twitch'},
  {key:'latest_superchat',  name:'Letzter Super Chat',         group:'youtube'},
  {key:'latest_membership', name:'Letzte Mitgliedschaft',      group:'youtube'},
  {key:'latest_donation',   name:'Letzte Spende',              group:'youtube'},
  {key:'total_superchats',  name:'Super Chats gesamt',         group:'youtube'},
  {key:'total_memberships', name:'Mitgliedschaften gesamt',    group:'youtube'},
  {key:'total_donations',   name:'Spenden gesamt',             group:'youtube'},
  {key:'latest_alert',      name:'Letzter Alert (gesamt)',     group:'general'},
  {key:'alerts_total',      name:'Alerts gesamt',              group:'general'},
  {key:'alerts_twitch',     name:'Alerts Twitch',              group:'general'},
  {key:'alerts_youtube',    name:'Alerts YouTube',             group:'general'},
];

// ── State ─────────────────────────────────────────────────────────────────────

let cfg           = {global:{}, events:{}, customEvents:[], testSamples:{}};
let platformState = null;
let selectedId    = null;
let isDirty       = false;
let saveTimer     = null;
let labelTimer    = null;
let alerts        = [];
let ytIngestTimer  = null;
let stopStatusPoll = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortUrl(u) {
  try { const pu = new URL(String(u)); return pu.hostname + (pu.pathname.length > 1 ? pu.pathname : ''); } catch {}
  if (String(u).startsWith('data:')) return '[data url]';
  return String(u).slice(0, 40) + (String(u).length > 40 ? '…' : '');
}

function normalizeMediaInputUrl(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  if (/^[a-zA-Z]:\\/.test(s)) {
    const drive = s.slice(0, 2);
    const rest  = s.slice(2).replace(/\\/g, '/').split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return 'file:///' + drive + '/' + rest;
  }
  if (/^file:\/\//i.test(s)) {
    return s.replace(/^file:\/\/\/([a-zA-Z])%3A\//i, (_, d) => 'file:///' + d + ':/');
  }
  return s;
}

const platClass = p => p === 'twitch' ? 'tw' : p === 'youtube' ? 'yt' : p === 'test' ? 'test' : 'gen';
const platLabel = p => p === 'twitch' ? 'Twitch' : p === 'youtube' ? 'YouTube' : p === 'test' ? 'Test' : 'General';

function clipboardCopy(text, btnEl, label) {
  const done = () => {
    if (!btnEl) return;
    const orig = btnEl.textContent;
    btnEl.textContent = label || t('alertdeck.copy');
    setTimeout(() => { btnEl.textContent = orig; }, 1200);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => { legacyCopy(text); done(); });
  } else {
    legacyCopy(text); done();
  }
}

function legacyCopy(text) {
  const ta = Object.assign(document.createElement('textarea'), {value: text});
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch {}
  document.body.removeChild(ta);
}

// ── RGBA helpers ──────────────────────────────────────────────────────────────

function parseRgba(str) {
  const m = String(str || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (m) return {r: +m[1], g: +m[2], b: +m[3], a: m[4] != null ? parseFloat(m[4]) : 1};
  const h = String(str || '').replace(/^#/, '');
  if (h.length === 6) return {r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16), a: 1};
  return {r:0, g:0, b:0, a:0};
}

const rgbToHex = (r,g,b) => '#' + [r,g,b].map(v => Math.round(v).toString(16).padStart(2,'0')).join('');

function buildRgba(id) {
  const rgb = document.getElementById('ev-bgRgb-' + id);
  const alp = document.getElementById('ev-bgAlpha-' + id);
  if (!rgb || !alp) return 'rgba(0,0,0,0)';
  const hex = rgb.value;
  const r = parseInt(hex.slice(1,3),16)||0, g = parseInt(hex.slice(3,5),16)||0, b = parseInt(hex.slice(5,7),16)||0;
  const a = (Math.round(parseInt(alp.value,10)||0) / 100).toFixed(2);
  return `rgba(${r},${g},${b},${a})`;
}

function updRgbaPreview(id) {
  const rgba = buildRgba(id);
  const prev = document.getElementById('ev-bgPrev-' + id);
  const aval = document.getElementById('ev-bgAlphaVal-' + id);
  if (prev) prev.style.background = rgba;
  if (aval) aval.textContent = (document.getElementById('ev-bgAlpha-' + id) || {value:'0'}).value + '%';
}

function updSlider(slId, valId, unit) {
  const sl = document.getElementById(slId), vl = document.getElementById(valId);
  if (sl && vl) vl.textContent = sl.value + unit;
}

// ── Tab switch ────────────────────────────────────────────────────────────────

function switchTab(id, btn) {
  document.querySelectorAll('.tc').forEach(e => e.classList.remove('on'));
  document.querySelectorAll('.tab').forEach(e => e.classList.remove('on'));
  document.getElementById(id).classList.add('on');
  btn.classList.add('on');
}

// ── Connection pills ──────────────────────────────────────────────────────────

const setTw = (ok, txt) => { document.getElementById('tw-pill').classList.toggle('on', !!ok); document.getElementById('tw-txt').textContent = txt; };
const setYt = (ok, txt) => { document.getElementById('yt-pill').classList.toggle('on', !!ok); document.getElementById('yt-txt').textContent = txt; };

async function loadPlatformState() {
  try {
    platformState = await safeJson('/api/platforms');
    return platformState;
  } catch {
    platformState = null;
    return null;
  }
}

// ── Event registry helpers ────────────────────────────────────────────────────

const allEventIds = () => [
  ...EVENT_TYPES.map(e => e.id),
  ...(cfg.customEvents || []).map(c => c.id),
];

function findEventMeta(id) {
  if (id === 'global') return {id:'global', name:'Globale Standards', platform:'global'};
  const et = EVENT_TYPES.find(e => e.id === id);
  if (et) return et;
  const ce = (cfg.customEvents || []).find(c => c.id === id);
  return ce ? {id:ce.id, name:ce.name, platform:'general', isCustom:true} : {id, name:id, platform:'general'};
}

// ── Event Nav ─────────────────────────────────────────────────────────────────

function renderEvNav() {
  let html = '<div class="en' + (selectedId === 'global' ? ' sel' : '') + '" onclick="selectEvent(\'global\')" id="eni-global">'
    + '<div class="en-dot" style="background:var(--accent)"></div>'
    + '<span class="en-name">Globale Standards</span>'
    + '<span class="en-badge glob">Global</span>'
    + '</div>'
    + '<div class="ev-nav-sep" style="margin-top:4px"><span>Standard</span></div>'
    + EVENT_TYPES.map(et => {
        const ev = cfg.events?.[et.id] || {};
        const en = ev.enabled !== false;
        return `<div class="en${selectedId===et.id?' sel':''}" onclick="selectEvent('${esc(et.id)}')" id="eni-${esc(et.id)}">`
          + `<div class="en-dot${en?'':' off'}" id="en-dot-${esc(et.id)}"></div>`
          + `<span class="en-name">${esc(et.name)}</span>`
          + `<span class="en-badge ${platClass(et.platform)}">${platLabel(et.platform)}</span>`
          + '</div>';
      }).join('')
    + '<div class="ev-nav-sep" style="margin-top:6px"><span>Custom</span>'
    + '<button class="btn xs pri" onclick="addCustomEvent()" style="padding:2px 6px;font-size:9px">+ Neu</button></div>'
    + (cfg.customEvents || []).map(ce => {
        const en = ce.enabled !== false;
        return `<div class="en${selectedId===ce.id?' sel':''}" onclick="selectEvent('${esc(ce.id)}')" id="eni-${esc(ce.id)}">`
          + `<div class="en-dot${en?'':' off'}" id="en-dot-${esc(ce.id)}"></div>`
          + `<span class="en-name">${esc(ce.name)}</span>`
          + `<button class="en-del" onclick="deleteCustomEvent(event,'${esc(ce.id)}')" title="Löschen">✕</button>`
          + '</div>';
      }).join('');

  document.getElementById('ev-nav-list').innerHTML = html;
}

function updateNavDots() {
  allEventIds().forEach(id => {
    const dot = document.getElementById('en-dot-' + id);
    if (!dot) return;
    const ev = cfg.events?.[id] || (cfg.customEvents || []).find(c => c.id === id) || {};
    dot.className = 'en-dot' + (ev.enabled !== false ? '' : ' off');
  });
}

// ── Select / flush event ──────────────────────────────────────────────────────

function selectEvent(id) {
  if (selectedId && selectedId !== id) flushCurrentEventToState();
  selectedId = id;
  document.querySelectorAll('.en').forEach(el => el.classList.toggle('sel', el.id === 'eni-' + id));
  renderOpts(id);
}

function flushCurrentEventToState() {
  if (!selectedId) return;
  const data = getEvData(selectedId);
  const ts = data._testSample;
  delete data._testSample;
  if (ts) { cfg.testSamples ??= {}; cfg.testSamples[selectedId] = ts; }
  if (selectedId === 'global') {
    cfg.global = Object.assign({}, cfg.global, data);
  } else {
    const ce = (cfg.customEvents || []).find(c => c.id === selectedId);
    if (ce) Object.assign(ce, data);
    else cfg.events[selectedId] = Object.assign({}, cfg.events[selectedId], data);
  }
}

const getTestSample = id =>
  (cfg.testSamples?.[id]) || DEFAULT_TEST_SAMPLES[id] || {author:'ExampleUser', text:'Test', amount:'', viewers:''};

// ── Position selector ─────────────────────────────────────────────────────────

function selectPos(id, pos) {
  POSITIONS.forEach(p => {
    document.getElementById('pos-' + id + '-' + p.id)?.classList.toggle('sel', p.id === pos);
  });
  const inp = document.getElementById('ev-position-' + id);
  if (inp) inp.value = pos;
  onField();
}

// ── Copy-from ─────────────────────────────────────────────────────────────────

function copyFrom(id, sourceId) {
  if (!sourceId || sourceId === id) return;
  const src = sourceId === 'global'
    ? (cfg.global || {})
    : (cfg.events?.[sourceId] || (cfg.customEvents||[]).find(c => c.id === sourceId) || {});
  const ev = cfg.events?.[id] || (cfg.customEvents||[]).find(c => c.id === id) || {};
  const merged = Object.assign({}, src, {imageUrl: ev.imageUrl || src.imageUrl || '', soundUrl: ev.soundUrl || src.soundUrl || ''});
  if (id === 'global') {
    cfg.global = Object.assign({}, cfg.global, merged);
  } else {
    const ce = (cfg.customEvents||[]).find(c => c.id === id);
    if (ce) Object.assign(ce, merged); else cfg.events[id] = Object.assign({}, cfg.events[id]||{}, merged);
  }
  renderOpts(id);
  onField();
}

// ── Render options panel ──────────────────────────────────────────────────────

function _slider(id, fieldId, label, min, max, val, unit) {
  return `<div class="f"><label>${esc(label)}</label>`
    + `<div class="slrow"><input type="range" class="sl" id="${fieldId}" min="${min}" max="${max}" value="${val}" `
    + `oninput="updSlider('${fieldId}','${fieldId}-val','${unit}');onField()">`
    + `<span class="slval" id="${fieldId}-val">${val}${unit}</span></div></div>`;
}

function _mediaRow(id, field, nameId, label, acceptStr) {
  return `<div class="media-row">`
    + `<span class="media-name" id="${nameId}">${esc(label)}</span>`
    + `<button class="btn xs" onclick="setLink('${esc(id)}','${field}','${nameId}')">Weblink</button>`
    + `<button class="btn xs" onclick="uploadFile('${esc(id)}','${field}','${nameId}','${acceptStr}')">Hochladen</button>`
    + `<button class="btn xs danger" onclick="clearMedia('${esc(id)}','${field}','${nameId}','${esc(field === 'soundUrl' ? 'Kein Sound' : 'Kein Bild')}')">Entfernen</button>`
    + '</div>';
}

function renderOpts(id) {
  const isGlobal = id === 'global';
  const ce  = isGlobal ? null : (cfg.customEvents||[]).find(c => c.id === id);
  const ev  = isGlobal ? (cfg.global||{}) : (ce || cfg.events?.[id] || {});
  const et  = findEventMeta(id);
  const bg  = parseRgba(ev.bgColor || 'rgba(0,0,0,0)');
  const bgHex   = rgbToHex(bg.r, bg.g, bg.b);
  const bgAlpha = Math.round(bg.a * 100);
  const bgRgba  = ev.bgColor || 'rgba(0,0,0,0)';
  const curPos  = ev.position || 'mc';
  const smp     = getTestSample(id);

  const fromOpts = ['<option value="">– Übernehmen von –</option>', '<option value="global">Globale Standards</option>',
    ...EVENT_TYPES.filter(e => e.id !== id).map(e => `<option value="${esc(e.id)}">${esc(e.name)}</option>`),
    ...(cfg.customEvents||[]).filter(c => c.id !== id).map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`),
  ].join('');

  const triggerUrlSection = (ce || (!isGlobal && !EVENT_TYPES.find(e => e.id === id))) ? (() => {
    const tUrl = location.protocol + '//' + location.host + '/api/alertdeck/trigger/' + encodeURIComponent(id);
    return `<div class="os"><div class="os-title">Trigger URL</div>`
      + `<div class="media-row"><span class="media-name" style="font-size:9px">${esc(tUrl)}</span>`
      + `<button class="btn xs" onclick="clipboardCopy('${esc(tUrl)}',this,'Kopiert!')">Kopieren</button></div>`
      + `<div class="vars" style="margin-top:4px">HTTP POST an diese URL um den Alert manuell auszulösen.</div></div>`;
  })() : '';

  // Section: Allgemein
  const secGeneral = isGlobal ? '' :
    `<div class="os"><div class="os-title">Allgemein</div>`
    + `<div class="toggle-row"><input type="checkbox" class="toggle" id="ev-enabled-${id}" ${ev.enabled!==false?'checked':''} onchange="onField()">`
    + `<label class="toggle-lbl" for="ev-enabled-${id}">Alert aktiviert</label></div></div>`;

  // Section: Layout
  const secLayout =
    `<div class="os"><div class="os-title">Layout</div><div class="og c2">`
    + `<div class="f"><label>Anordnung</label><select class="sel" id="ev-layout-${id}" onchange="onField()">`
    + `<option value="image-left" ${!ev.layout||ev.layout==='image-left'?'selected':''}>Bild links</option>`
    + `<option value="image-top"  ${ev.layout==='image-top'?'selected':''}>Bild oben</option>`
    + `<option value="text-top"   ${ev.layout==='text-top'?'selected':''}>Text oben</option>`
    + `</select></div>`
    + `<div class="f"><label>Position auf Bildschirm</label>`
    + `<div class="pos-grid">${POSITIONS.map(p =>
        `<button type="button" class="pos-btn${curPos===p.id?' sel':''}" id="pos-${id}-${p.id}" onclick="selectPos('${esc(id)}','${p.id}')" title="${p.id}">${p.label}</button>`
      ).join('')}</div>`
    + `<input type="hidden" id="ev-position-${id}" value="${esc(curPos)}"></div>`
    + `</div></div>`;

  // Section: Bild
  const imgLabel = ev.imageUrl ? shortUrl(ev.imageUrl) : 'Kein Bild';
  const secImage =
    `<div class="os"><div class="os-title">Bild / GIF / Video</div>`
    + _mediaRow(id, 'imageUrl', `ev-img-name-${id}`, imgLabel, 'image/*,video/*')
    + _slider(id, `ev-imgSize-${id}`, 'Bildgröße (0 = auto)', 0, 500, ev.imageSize||0, 'px')
    + `</div>`;

  // Section: Nachricht
  const secMsg =
    `<div class="os"><div class="os-title">Nachricht</div><div class="og">`
    + `<div class="f full"><label>Nachrichtenvorlage</label>`
    + `<textarea class="ta inp" id="ev-message-${id}" oninput="onField()">${esc(ev.message||'')}</textarea>`
    + `<div class="vars">Platzhalter: <code>{name}</code> <code>{text}</code> <code>{amount}</code> <code>{viewers}</code></div>`
    + `</div></div></div>`;

  // Section: Timing
  const secTiming =
    `<div class="os"><div class="os-title">Timing</div><div class="og">`
    + _slider(id, `ev-duration-${id}`,  'Anzeigedauer',   2,  300, ev.duration||8,   's')
    + _slider(id, `ev-textDelay-${id}`, 'Textverzögerung', 0, 60,  ev.textDelay||0,  's')
    + `</div></div>`;

  // Section: Sound
  const sndLabel = ev.soundUrl ? shortUrl(ev.soundUrl) : 'Kein Sound';
  const secSound =
    `<div class="os"><div class="os-title">Sound</div>`
    + _mediaRow(id, 'soundUrl', `ev-snd-name-${id}`, sndLabel, 'audio/*')
    + `<div style="margin-top:9px">`
    + _slider(id, `ev-soundVol-${id}`, 'Lautstärke', 0, 100, ev.soundVolume||80, '%')
    + `</div></div>`;

  // Section: Darstellung
  const secStyle =
    `<div class="os"><div class="os-title">Darstellung</div><div class="og c2">`
    + `<div class="f full"><label>Hintergrundfarbe</label><div class="rgba-row">`
    + `<input type="color" class="cswatch" id="ev-bgRgb-${id}" value="${bgHex}" oninput="updRgbaPreview('${id}');onField()">`
    + `<span class="alpha-lbl">Alpha</span>`
    + `<input type="range" class="sl" style="flex:1" id="ev-bgAlpha-${id}" min="0" max="100" value="${bgAlpha}" oninput="updRgbaPreview('${id}');onField()">`
    + `<span class="slval" id="ev-bgAlphaVal-${id}">${bgAlpha}%</span>`
    + `<div class="rgba-prev" id="ev-bgPrev-${id}" style="background:${esc(bgRgba)}"></div></div></div>`
    + `<div class="f"><label>Animation Einblenden</label><select class="sel" id="ev-animIn-${id}" onchange="onField()">`
    + ANIM_IN.map(a => `<option value="${a}" ${ev.animIn===a?'selected':''}>${a}</option>`).join('')
    + `</select></div><div class="f"><label>Animation Ausblenden</label><select class="sel" id="ev-animOut-${id}" onchange="onField()">`
    + ANIM_OUT.map(a => `<option value="${a}" ${ev.animOut===a?'selected':''}>${a}</option>`).join('')
    + `</select></div></div></div>`;

  // Section: Schrift
  const secFont =
    `<div class="os"><div class="os-title">Schrift</div><div class="og c2">`
    + `<div class="f"><label>Schriftart</label><select class="sel" id="ev-fontFamily-${id}" onchange="onField()">`
    + FONTS.map(f => `<option value="${f}" ${ev.fontFamily===f?'selected':''}>${f}</option>`).join('')
    + `</select></div><div class="f"><label>Schriftstärke</label><select class="sel" id="ev-fontWeight-${id}" onchange="onField()">`
    + [200,300,400,500,600,700,800].map(w => `<option value="${w}" ${ev.fontWeight===w?'selected':''}>${w}</option>`).join('')
    + `</select></div>`
    + _slider(id, `ev-fontSize-${id}`, 'Schriftgröße', 12, 80, ev.fontSize||42, 'px')
    + `<div class="f"><label>Textfarbe</label><input type="color" class="cswatch" style="width:100%;height:30px" id="ev-textColor-${id}" value="${esc(ev.textColor||'#ffffff')}" oninput="onField()"></div>`
    + `<div class="f"><label>Highlight-Farbe</label><input type="color" class="cswatch" style="width:100%;height:30px" id="ev-highlightColor-${id}" value="${esc(ev.highlightColor||'#14d3aa')}" oninput="onField()"></div>`
    + `</div></div>`;

  // Section: Custom CSS
  const secCss =
    `<div class="os"><div class="os-title">Custom CSS</div>`
    + `<div class="f"><label>CSS für dieses Event (wird in Overlay injiziert)</label>`
    + `<textarea class="ta inp" id="ev-customCss-${id}" rows="4" style="font-family:'JetBrains Mono',monospace;font-size:10px" oninput="onField()" placeholder="/* z.B. #card { box-shadow: 0 0 40px gold; } */">${esc(ev.customCss||'')}</textarea>`
    + `</div></div>`;

  // Section: Test-Daten
  const secTest =
    `<div class="os"><div class="os-title">Test-Daten</div><div class="og c2">`
    + `<div class="f"><label>Name</label><input class="inp" id="ev-ts-author-${id}" value="${esc(smp.author||'')}" oninput="onField()"></div>`
    + `<div class="f"><label>Text</label><input class="inp" id="ev-ts-text-${id}" value="${esc(smp.text||'')}" oninput="onField()"></div>`
    + `<div class="f"><label>Betrag</label><input class="inp" id="ev-ts-amount-${id}" value="${esc(smp.amount||'')}" oninput="onField()"></div>`
    + `<div class="f"><label>Viewers</label><input class="inp" id="ev-ts-viewers-${id}" value="${esc(smp.viewers||'')}" oninput="onField()"></div>`
    + `</div></div>`;

  document.getElementById('ev-opts-wrap').innerHTML =
    `<div class="opts-hdr">`
    + `<div class="opts-title">${esc(et.name)}</div>`
    + (isGlobal
        ? '<span class="plat-badge glob">Vorlage</span>'
        : `<span class="plat-badge ${platClass(et.platform)}">${platLabel(et.platform)}</span>`)
    + `<select class="sel" style="font-size:10px;padding:2px 6px;width:auto;margin-left:4px" onchange="copyFrom('${esc(id)}',this.value);this.value=''">${fromOpts}</select>`
    + `</div>`
    + secGeneral + secLayout + secImage + secMsg + secTiming + secSound + secStyle + secFont + secCss + secTest
    + triggerUrlSection;
}

// ── Collect event data ────────────────────────────────────────────────────────

function getEvData(id) {
  const g  = sel => document.getElementById(sel)?.value ?? '';
  const gc = sel => document.getElementById(sel)?.checked ?? true;
  const isGlobal = id === 'global';
  const ce = isGlobal ? null : (cfg.customEvents||[]).find(c => c.id === id);
  const stateEv = isGlobal ? (cfg.global||{}) : (ce || cfg.events?.[id] || {});

  const data = {
    layout:         g('ev-layout-' + id) || 'image-left',
    position:       g('ev-position-' + id) || 'mc',
    imageUrl:       String(stateEv.imageUrl || ''),
    imageSize:      Math.max(0, Math.min(500, parseInt(g('ev-imgSize-' + id), 10) || 0)),
    message:        g('ev-message-' + id),
    duration:       Math.max(2,  Math.min(300, parseInt(g('ev-duration-'  + id), 10) || 8)),
    textDelay:      Math.max(0,  Math.min(60,  parseInt(g('ev-textDelay-' + id), 10) || 0)),
    soundUrl:       String(stateEv.soundUrl || ''),
    soundVolume:    Math.max(0,  Math.min(100, parseInt(g('ev-soundVol-'  + id), 10) || 80)),
    bgColor:        buildRgba(id),
    animIn:         g('ev-animIn-'       + id) || 'bounceInRight',
    animOut:        g('ev-animOut-'      + id) || 'bounceOutRight',
    fontFamily:     g('ev-fontFamily-'   + id) || 'Archivo',
    fontSize:       Math.max(12, Math.min(80, parseInt(g('ev-fontSize-'   + id), 10) || 42)),
    fontWeight:     parseInt(g('ev-fontWeight-' + id), 10) || 700,
    textColor:      g('ev-textColor-'       + id) || '#ffffff',
    highlightColor: g('ev-highlightColor-'  + id) || '#14d3aa',
    customCss:      g('ev-customCss-'       + id) || '',
    _testSample: {
      author:  g('ev-ts-author-'  + id) || '',
      text:    g('ev-ts-text-'    + id) || '',
      amount:  g('ev-ts-amount-'  + id) || '',
      viewers: g('ev-ts-viewers-' + id) || '',
    },
  };

  if (!isGlobal) {
    data.enabled  = gc('ev-enabled-' + id);
    data.platform = (findEventMeta(id) || {platform:'general'}).platform;
  }
  return data;
}

// ── Media helpers ─────────────────────────────────────────────────────────────

function _getMediaTarget(id) {
  const ce = (cfg.customEvents||[]).find(c => c.id === id);
  if (ce) return ce;
  cfg.events[id] = Object.assign({}, cfg.events[id] || {});
  return cfg.events[id];
}

function setLink(id, field, nameId) {
  const url = prompt('URL eingeben:');
  if (url == null) return;
  const normalized = normalizeMediaInputUrl(url);
  _getMediaTarget(id)[field] = normalized;
  document.getElementById(nameId).textContent = normalized ? shortUrl(normalized) : '–';
  onField();
}

async function uploadFile(id, field, nameId, accept) {
  const inp = Object.assign(document.createElement('input'), {type:'file', accept});
  inp.onchange = async () => {
    const file = inp.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setStatus(t('alertdeck.file_too_large'), 'dirty'); return; }
    let dataUrl;
    try {
      dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error(t('alertdeck.file_read_error')));
        reader.onload  = e  => resolve(String(e?.target?.result || ''));
        reader.readAsDataURL(file);
      });
    } catch { setStatus(t('alertdeck.file_read_error'), 'dirty'); return; }
    try {
      const out = await safeJson('/api/alertdeck/media/import', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({name: file.name, dataUrl, kind: field === 'soundUrl' ? 'sound' : 'image'}),
      });
      if (!out?.url) throw new Error('Kein URL zurückgegeben');
      _getMediaTarget(id)[field] = String(out.url);
      document.getElementById(nameId).textContent = shortUrl(out.url);
      onField();
    } catch (e) { setStatus(t('alertdeck.upload_error', {message: String(e?.message || '').slice(0, 90)}), 'dirty'); }
  };
  inp.click();
}

function clearMedia(id, field, nameId, label) {
  _getMediaTarget(id)[field] = '';
  document.getElementById(nameId).textContent = label;
  onField();
}

// ── Status / Save ─────────────────────────────────────────────────────────────

function setStatus(msg, cls) {
  const st = document.getElementById('save-status');
  if (st) { st.textContent = msg; st.className = cls || ''; }
}

function onField() {
  isDirty = true;
  setStatus(t('alertdeck.status.unsaved'), 'dirty');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveAll(false), 700);
}

async function saveAll(force) {
  if (!isDirty && !force) return;
  flushCurrentEventToState();
  try {
    const saved = await safeJson('/api/alertdeck/config', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(cfg),
    });
    cfg = Object.assign({customEvents: cfg.customEvents||[], testSamples: cfg.testSamples||{}}, saved);
    isDirty = false;
    updateNavDots();
    setStatus(t('alertdeck.status.saved'), 'saved');
    setTimeout(() => {
      const st = document.getElementById('save-status');
      if (st?.textContent === t('alertdeck.status.saved')) { st.textContent = '–'; st.className = ''; }
    }, 2000);
  } catch (e) {
    setStatus(t('alertdeck.save_error') + ': ' + String(e?.message || '').slice(0, 120), 'dirty');
  }
}

// ── Preview ───────────────────────────────────────────────────────────────────

function reloadPrev() {
  const fr = document.getElementById('prev-iframe');
  if (fr) { const src = fr.src; fr.src = ''; fr.src = src; }
}

function setupPrev() {
  const fr = document.getElementById('prev-iframe');
  if (fr) fr.src = location.protocol + '//' + location.host + '/tool/alertdeck/overlay?preview=1&v=' + Date.now();
  updatePreviewUrl();
}

const getEventConfig = id => id === 'global'
  ? (cfg.global || {})
  : ((cfg.customEvents||[]).find(c => c.id === id) || cfg.events?.[id] || {});

async function previewLocal() {
  if (!selectedId || selectedId === 'global') return;
  await saveAll(true);
  const ev = getEventConfig(selectedId);
  if (ev.soundUrl) {
    try {
      const audio = new Audio(ev.soundUrl);
      audio.volume = Math.max(0, Math.min(1, (parseInt(ev.soundVolume, 10) || 80) / 100));
      audio.play().catch(() => {});
    } catch {}
  }
  const fr = document.getElementById('prev-iframe');
  if (fr?.contentWindow) {
    const et  = findEventMeta(selectedId);
    const smp = getTestSample(selectedId);
    fr.contentWindow.postMessage({
      type:'alertdeck-preview', eventType:selectedId, platform:et.platform||'general',
      author:smp.author, text:smp.text, amount:smp.amount||'', viewers:smp.viewers||'',
      eventConfig:ev, ts:Date.now(),
    }, '*');
  }
}

async function previewObs() {
  if (!selectedId || selectedId === 'global') return;
  await saveAll(true);
  const et  = findEventMeta(selectedId);
  const smp = getTestSample(selectedId);
  try {
    await safeJson('/api/alertdeck/inject', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({eventType:selectedId, platform:et.platform||'general',
        author:smp.author, text:smp.text, amount:smp.amount||'', viewers:smp.viewers||''}),
    });
    setStatus(t('alertdeck.obs_test_sent'), 'saved');
    setTimeout(() => {
      const st = document.getElementById('save-status');
      if (st?.textContent === t('alertdeck.obs_test_sent')) { st.textContent = '–'; st.className = ''; }
    }, 2000);
  } catch {
    await previewLocal();
  }
}

function soundTest() {
  if (!selectedId || selectedId === 'global') return;
  const ev = getEventConfig(selectedId);
  if (!ev.soundUrl) { setStatus(t('alertdeck.no_sound'), 'dirty'); return; }
  try {
    const audio = new Audio(ev.soundUrl);
    audio.volume = Math.max(0, Math.min(1, (parseInt(ev.soundVolume,10)||80) / 100));
    audio.play().catch(() => {});
  } catch {}
}

// ── OBS URL ───────────────────────────────────────────────────────────────────

const buildObsUrl    = () => updatePreviewUrl();
const updatePreviewUrl = () => {
  document.getElementById('prev-url').value = location.protocol + '//' + location.host + '/tool/alertdeck/overlay';
};

function copyPreviewUrl() {
  clipboardCopy(document.getElementById('prev-url').value,
    document.querySelector('button[onclick="copyPreviewUrl()"]'), t('alertdeck.copy'));
}

// ── Live alert feed ───────────────────────────────────────────────────────────

// Safe replay: store alert data in dataset, use event delegation — no inline JSON in onclick
function pushFeedAlert(a) {
  if (String(a?.platform || '').toLowerCase() === 'test') return;
  alerts.unshift(a);
  if (alerts.length > 200) alerts.length = 200;
  document.getElementById('alert-cnt').textContent = String(alerts.length);

  const list = document.getElementById('alert-list');
  const time = new Date(a.ts || Date.now()).toLocaleString('de-DE', {day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});
  const et   = String(a.eventType || '').replace(/^event:/, '');
  const pc   = a.platform === 'twitch' ? 'ai-tw' : a.platform === 'youtube' ? 'ai-yt' : '';

  const el = document.createElement('div');
  el.className = 'ai ' + pc;
  el.dataset.alert = JSON.stringify(a); // stored safely in dataset, not in onclick
  el.innerHTML =
    `<div class="ai-meta">`
    + `<span>${esc((a.platform||'?').toUpperCase())}${et ? `<span class="ev-badge">${esc(et)}</span>` : ''} </span>`
    + `<span style="display:flex;align-items:center;gap:4px">${esc(time)}`
    + `<button class="ai-replay" title="Wiederholen">▶</button></span></div>`
    + `<div><strong>${esc(a.author||'User')}</strong>: ${esc(a.text||'')}</div>`;
  list.prepend(el);
  while (list.childElementCount > 200) list.lastElementChild.remove();
}

// Event delegation for replay — no inline onclick with embedded JSON
document.addEventListener('click', e => {
  const btn = e.target.closest('.ai-replay');
  if (!btn) return;
  const item = btn.closest('.ai');
  if (!item) return;
  try {
    const a  = JSON.parse(item.dataset.alert);
    const fr = document.getElementById('prev-iframe');
    if (!fr?.contentWindow) return;
    fr.contentWindow.postMessage(Object.assign({type:'alertdeck-preview', eventConfig:getEventConfig(a.eventType||'follower')}, a), '*');
  } catch {}
});

function exportAlerts() {
  const fmt = window.confirm(t('alertdeck.export_csv')) ? 'csv' : 'json';
  let content, mime, ext;
  if (fmt === 'csv') {
    const rows = [[t('alertdeck.col.timestamp'),t('alertdeck.col.platform'),t('alertdeck.col.event_type'),t('alertdeck.col.author'),t('alertdeck.col.text'),t('alertdeck.col.amount'),t('alertdeck.col.viewers')],
      ...alerts.map(a => [
        new Date(a.ts||0).toISOString(), a.platform||'',
        String(a.eventType||'').replace(/^event:/,''),
        a.author||'', a.text||'', a.amount||'', a.viewers||'',
      ])];
    content = rows.map(r => r.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(',')).join('\n');
    mime = 'text/csv'; ext = 'csv';
  } else {
    content = JSON.stringify(alerts, null, 2);
    mime = 'application/json'; ext = 'json';
  }
  const url = URL.createObjectURL(new Blob([content], {type: mime}));
  Object.assign(document.createElement('a'), {href:url, download:`alertdeck-verlauf.${ext}`}).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Custom events ─────────────────────────────────────────────────────────────

function addCustomEvent() {
  const name = prompt(t('alertdeck.custom_name_prompt'));
  if (!name?.trim()) return;
  const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'') || 'custom_' + Date.now();
  cfg.customEvents ??= [];
  if (cfg.customEvents.find(c => c.id === id) || EVENT_TYPES.find(e => e.id === id)) {
    alert(t('alertdeck.custom_exists')); return;
  }
  cfg.customEvents.push({id, name:name.trim(), enabled:true, platform:'general'});
  renderEvNav();
  selectEvent(id);
  onField();
}

function deleteCustomEvent(evt, id) {
  evt.stopPropagation();
  if (!confirm(t('alertdeck.custom_delete_confirm', {id}))) return;
  cfg.customEvents = (cfg.customEvents||[]).filter(c => c.id !== id);
  if (selectedId === id) {
    selectedId = null;
    document.getElementById('ev-opts-wrap').innerHTML =
      '<div class="no-sel"><div class="no-sel-icon">⚡</div><div>Event auswählen</div></div>';
  }
  renderEvNav();
  onField();
}

// ── Labels ────────────────────────────────────────────────────────────────────

const getLabelUrl = key => location.protocol + '//' + location.host + '/api/alertdeck/labels/' + key + '.txt';

function renderLabels() {
  const groups = [{id:'twitch',title:'Twitch'},{id:'youtube',title:'YouTube'},{id:'general',title:'Allgemein'}];
  document.getElementById('label-groups').innerHTML = groups.map(g => {
    const rows = LABELS.filter(l => l.group === g.id);
    return `<div class="lg-hd">${esc(g.title)}</div>` + rows.map((l, i) =>
      `<div class="lr"><div class="lr-top"><span class="lr-name">${esc(l.name)}</span>`
      + `<span class="lr-val" id="lv-${esc(l.key)}">-</span></div>`
      + `<div class="lr-url"><input readonly value="${esc(getLabelUrl(l.key))}" onclick="this.select()">`
      + `<button class="btn xs" id="lcp-${i}" onclick="copyLabel('${esc(l.key)}','lcp-${i}')">Kopieren</button>`
      + `</div></div>`
    ).join('');
  }).join('');
}

async function refreshLabels() {
  try {
    const s = await safeJson('/api/alertdeck/labels');
    const c = s.counts||{}, lt = s.latest||{};
    const vals = {
      latest_follower:lt.follower||'-', latest_sub:lt.sub||'-', latest_resub:lt.resub||'-',
      latest_subgift:lt.subgift||'-',   latest_raid:lt.raid||'-', latest_bits:lt.bits||'-',
      total_followers:String(c.follower||0), total_subs:String(c.sub||0),
      total_raids:String(c.raid||0), total_bits:String(c.bits||0),
      latest_superchat:lt.superchat||'-', latest_membership:lt.membership||'-', latest_donation:lt.donation||'-',
      total_superchats:String(c.superchat||0), total_memberships:String(c.membership||0),
      total_donations:String(c.donation||0), latest_alert:lt.any||'-',
      alerts_total:String(c.total||0), alerts_twitch:String(c.twitch||0), alerts_youtube:String(c.youtube||0),
    };
    LABELS.forEach(l => {
      const el = document.getElementById('lv-' + l.key);
      if (el) el.textContent = vals[l.key] || '-';
    });
  } catch {}
}

async function resetLabels() {
  if (!confirm('Alle Zähler auf null zurücksetzen?')) return;
  try { await safeJson('/api/alertdeck/labels/reset', {method:'POST'}); refreshLabels(); } catch {}
}

const copyLabel = (key, btnId) => clipboardCopy(getLabelUrl(key), document.getElementById(btnId), 'Kopiert');

// ── Watch / WebSocket ─────────────────────────────────────────────────────────

async function loadPastEvents() {
  try {
    const d = await safeJson('/api/platforms/events/history?limit=200');
    alerts = [];
    document.getElementById('alert-list').innerHTML = '';
    const items = Array.isArray(d.history) ? d.history : [];
    items.slice().reverse().forEach(item => pushFeedAlert(item));
  } catch {}
}

const _wsClient = createWsClient({
  onMessage(msg) {
    if (msg.type === 'ALERT_EVENT' && msg.payload) pushFeedAlert(msg.payload);
  },
});

async function triggerYouTubeIngest() {
  try { await safeJson('/api/chatdeck/youtube/poll'); } catch {}
}

async function refreshPlatformPills() {
  try {
    platformState = await PlatformStatus.load();
    const tw = platformState.twitch || {}, yt = platformState.youtube || {};
    setTw(!!tw.connected,  PlatformStatus.twText(tw));
    setYt(!!yt.videoId,    PlatformStatus.ytText(yt));
    if (yt.channel && !ytIngestTimer)
      ytIngestTimer = setInterval(triggerYouTubeIngest, 6000);
    else if (!yt.channel && ytIngestTimer)
      { clearInterval(ytIngestTimer); ytIngestTimer = null; }
  } catch {}
}

async function startWatch() {
  if (ytIngestTimer) { clearInterval(ytIngestTimer); ytIngestTimer = null; }
  await loadPlatformState();
  const tw = platformState?.twitch || {}, yt = platformState?.youtube || {};
  setTw(!!tw.connected, PlatformStatus.twText(tw));
  setYt(!!yt.videoId,   PlatformStatus.ytText(yt));
  if (tw.oauthLoggedIn) { try { await safeJson('/api/platforms/twitch/backfill', {method:'POST'}); } catch {} }
  if (yt.channel) { await triggerYouTubeIngest(); ytIngestTimer = setInterval(triggerYouTubeIngest, 6000); }
  await loadPastEvents();
  _wsClient.start();
  if (stopStatusPoll) stopStatusPoll();
  stopStatusPoll = PlatformStatus.poll(state => {
    platformState = state;
    const tw2 = state.twitch||{}, yt2 = state.youtube||{};
    setTw(!!tw2.connected, PlatformStatus.twText(tw2));
    setYt(!!yt2.videoId,   PlatformStatus.ytText(yt2));
    if (yt2.channel && !ytIngestTimer)
      ytIngestTimer = setInterval(triggerYouTubeIngest, 6000);
    else if (!yt2.channel && ytIngestTimer)
      { clearInterval(ytIngestTimer); ytIngestTimer = null; }
  }, 3000);
}

function stopWatch() {
  if (ytIngestTimer)  { clearInterval(ytIngestTimer); ytIngestTimer = null; }
  if (stopStatusPoll) { stopStatusPoll(); stopStatusPoll = null; }
  _wsClient.stop();
  setTw(false, 'Twitch nicht verbunden');
  setYt(false, 'YouTube nicht verbunden');
}

// ── Init ──────────────────────────────────────────────────────────────────────

(async function init() {
  buildObsUrl();

  try {
    const raw = await safeJson('/api/alertdeck/config');
    cfg = Object.assign({customEvents:[], testSamples:{}}, raw);
  } catch { cfg = {global:{}, events:{}, customEvents:[], testSamples:{}}; }

  renderEvNav();
  await loadPlatformState().catch(() => {});
  setupPrev();
  startWatch();
})();
