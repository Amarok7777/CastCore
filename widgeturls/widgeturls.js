'use strict';

const BASE         = location.protocol + '//' + location.host;
// Overlay is always one port below the dashboard (7332-1=7331 by default)
const OVERLAY_PORT = parseInt(location.port || '7332', 10) - 1;
const SF_OVERLAY   = 'http://' + location.hostname + ':' + OVERLAY_PORT + '/splitflow';

const LABELS = [
  {key:'latest_follower',   i18nKey:'widgeturls.label.latest_follower',   name:'Latest Follower',   group:'twitch'},
  {key:'latest_sub',        i18nKey:'widgeturls.label.latest_sub',         name:'Latest Sub',        group:'twitch'},
  {key:'latest_resub',      i18nKey:'widgeturls.label.latest_resub',       name:'Latest Resub',      group:'twitch'},
  {key:'latest_subgift',    i18nKey:'widgeturls.label.latest_subgift',     name:'Latest Gift Sub',   group:'twitch'},
  {key:'latest_raid',       i18nKey:'widgeturls.label.latest_raid',        name:'Latest Raid',       group:'twitch'},
  {key:'latest_bits',       i18nKey:'widgeturls.label.latest_bits',        name:'Latest Bits',       group:'twitch'},
  {key:'total_followers',   i18nKey:'widgeturls.label.total_followers',    name:'Total Followers',   group:'twitch'},
  {key:'total_subs',        i18nKey:'widgeturls.label.total_subs',         name:'Total Subs',        group:'twitch'},
  {key:'total_raids',       i18nKey:'widgeturls.label.total_raids',        name:'Total Raids',       group:'twitch'},
  {key:'total_bits',        i18nKey:'widgeturls.label.total_bits',         name:'Total Bits',        group:'twitch'},
  {key:'latest_superchat',  i18nKey:'widgeturls.label.latest_superchat',   name:'Latest Super Chat', group:'youtube'},
  {key:'latest_membership', i18nKey:'widgeturls.label.latest_membership',  name:'Latest Membership', group:'youtube'},
  {key:'latest_donation',   i18nKey:'widgeturls.label.latest_donation',    name:'Latest Donation',   group:'youtube'},
  {key:'total_superchats',  i18nKey:'widgeturls.label.total_superchats',   name:'Total Super Chats', group:'youtube'},
  {key:'total_memberships', i18nKey:'widgeturls.label.total_memberships',  name:'Total Memberships', group:'youtube'},
  {key:'total_donations',   i18nKey:'widgeturls.label.total_donations',    name:'Total Donations',   group:'youtube'},
  {key:'latest_alert',      i18nKey:'widgeturls.label.latest_alert',       name:'Latest Alert',      group:'allgemein'},
  {key:'alerts_total',      i18nKey:'widgeturls.label.alerts_total',       name:'Total Alerts',      group:'allgemein'},
  {key:'alerts_twitch',     i18nKey:'widgeturls.label.alerts_twitch',      name:'Twitch Alerts',     group:'allgemein'},
  {key:'alerts_youtube',    i18nKey:'widgeturls.label.alerts_youtube',     name:'YouTube Alerts',    group:'allgemein'},
];


function boot() {
  document.getElementById('sf-url').value = SF_OVERLAY;
  document.getElementById('tp-url').value = BASE + '/tool/trackpulse/overlay';
  buildChatUrl();
  renderLabels();
  refreshLabelValues();
  setInterval(refreshLabelValues, 5000);
}

function buildChatUrl() {
  const plat   = document.getElementById('cd-plat').value;
  const max    = document.getElementById('cd-max').value;
  const fs     = document.getElementById('cd-fs').value;
  const newest = document.getElementById('cd-newest').value;
  const font   = document.getElementById('cd-font').value;
  const bg     = document.getElementById('cd-bg').checked ? 1 : 0;
  const badge  = document.getElementById('cd-badge').checked ? 1 : 0;
  const url = BASE + '/tool/chatdeck/overlay?platform=' + plat + '&max=' + max + '&fs=' + fs + '&newest=' + newest + '&font=' + font + '&bg=' + bg + '&badge=' + badge;
  document.getElementById('cd-url').value = url;
}

function renderLabels() {
  const groups = ['twitch','youtube','allgemein'];
  const names  = {twitch:'Twitch', youtube:'YouTube', allgemein: t('widgeturls.group.general')};
  let html = '';
  for (const g of groups) {
    const rows = LABELS.filter(l => l.group === g);
    html += '<div class="lg-hd">' + esc(names[g]) + '</div>';
    html += '<table class="label-table"><thead><tr><th>Label</th><th>' + t('widgeturls.table.current_value') + '</th><th>' + t('widgeturls.table.obs_url') + '</th></tr></thead><tbody>';
    rows.forEach((l, i) => {
      const url = BASE + '/api/alertdeck/labels/' + l.key + '.txt';
      const labelName = l.i18nKey ? t(l.i18nKey) : l.name;
      html += '<tr>'
        + '<td>' + esc(labelName) + '</td>'
        + '<td><span class="label-val" id="lv-' + esc(l.key) + '">—</span></td>'
        + '<td><div class="label-url-cell"><input readonly value="' + esc(url) + '" onclick="this.select()"><button class="btn xs" onclick="copyText(\'' + esc(url) + '\',this)">' + t('btn.copy') + '</button></div></td>'
        + '</tr>';
    });
    html += '</tbody></table>';
  }
  document.getElementById('label-groups').innerHTML = html;
}

async function refreshLabelValues() {
  try {
    const s = await safeJson('/api/alertdeck/labels');
    const c = s.counts || {}, lt = s.latest || {};
    const vals = {
      latest_follower: lt.follower||'—', latest_sub: lt.sub||'—', latest_resub: lt.resub||'—',
      latest_subgift: lt.subgift||'—', latest_raid: lt.raid||'—', latest_bits: lt.bits||'—',
      total_followers: String(c.follower||0), total_subs: String(c.sub||0),
      total_raids: String(c.raid||0), total_bits: String(c.bits||0),
      latest_superchat: lt.superchat||'—', latest_membership: lt.membership||'—',
      latest_donation: lt.donation||'—', total_superchats: String(c.superchat||0),
      total_memberships: String(c.membership||0), total_donations: String(c.donation||0),
      latest_alert: lt.any||'—', alerts_total: String(c.total||0),
      alerts_twitch: String(c.twitch||0), alerts_youtube: String(c.youtube||0),
    };
    LABELS.forEach(l => {
      const el = document.getElementById('lv-' + l.key);
      if (el) el.textContent = vals[l.key] || '—';
    });
  } catch(_) {}
}

async function resetLabels() {
  if (!confirm(t('widgeturls.reset_confirm'))) return;
  try {
    await safeJson('/api/alertdeck/labels/reset', { method: 'POST' });
    refreshLabelValues();
    toast(t('toast.copied'), 'ok');
  } catch(_) { toast(t('widgeturls.reset_error'), 'error'); }
}

function copyUrl(id, btn) {
  const val = document.getElementById(id).value;
  copyText(val, btn);
}

function openUrl(id) {
  const val = document.getElementById(id).value;
  window.open(val, '_blank', 'noopener');
}

function copyText(text, btn) {
  const orig = btn ? btn.textContent : '';
  function done() {
    if (!btn) { toast(t('toast.copied'), 'ok'); return; }
    btn.textContent = t('toast.copied');
    setTimeout(() => { btn.textContent = orig; }, 1400);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => { legacyCopy(text); done(); });
  } else { legacyCopy(text); done(); }
}

function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch(_) {}
  document.body.removeChild(ta);
}

i18n.ready().then(boot);
