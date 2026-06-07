'use strict';
const fs   = require('fs');
const path = require('path');
const { atomicWriteJson } = require('../core/fileUtils');

const FILE = path.join(__dirname, '..', 'data', 'alertdeckConfig.json');

const ANIM_IN  = ['bounceInRight','bounceInLeft','bounceInDown','bounceInUp','fadeIn','fadeInRight','fadeInLeft','fadeInDown','fadeInUp','zoomIn','slideInRight','slideInLeft','slideInDown','flipInX'];
const ANIM_OUT = ['bounceOutRight','bounceOutLeft','bounceOutDown','bounceOutUp','fadeOut','fadeOutRight','fadeOutLeft','zoomOut','slideOutRight','slideOutUp','flipOutX'];
const FONTS    = ['Archivo','Roboto','Montserrat','Oswald','Raleway','Nunito','Poppins','Open Sans','Impact','Arial','Georgia'];
const LAYOUTS  = ['image-left','image-top','text-top'];
const WEIGHTS  = [200,300,400,500,600,700,800];

const BASE = {
  enabled: true,
  layout: 'image-left',
  imageUrl: '',
  message: '',
  duration: 8,
  textDelay: 0,
  soundUrl: '',
  soundVolume: 80,
  bgColor: 'rgba(0,0,0,0)',
  animIn: 'bounceInRight',
  animOut: 'bounceOutRight',
  fontFamily: 'Archivo',
  fontSize: 42,
  fontWeight: 700,
  textColor: '#ffffff',
  highlightColor: '#14d3aa',
};

const EVENT_DEFAULTS = {
  follower:    { ...BASE, message: '{name} folgt dir jetzt!',                 platform: 'twitch'  },
  sub:         { ...BASE, message: '{name} hat abonniert!',                    platform: 'twitch'  },
  resub:       { ...BASE, message: '{name} hat {text}',                        platform: 'twitch'  },
  subgift:     { ...BASE, message: '{name} hat einen Sub verschenkt!',         platform: 'twitch'  },
  raid:        { ...BASE, message: '{name} raided mit {viewers} Zuschauern!',  platform: 'twitch'  },
  bits:        { ...BASE, message: '{name} hat {amount} Bits gecheert!',       platform: 'twitch'  },
  superchat:   { ...BASE, message: '{name}: {text}',                           platform: 'youtube' },
  supersticker:{ ...BASE, message: '{name} hat einen Sticker gesendet!',       platform: 'youtube' },
  membership:  { ...BASE, message: '{name} ist jetzt Mitglied!',               platform: 'youtube' },
  donation:    { ...BASE, message: '{name} hat {amount} gespendet!',           platform: 'general' },
  test:        { ...BASE, message: '{text}',                                   platform: 'test'    },
};

function clamp(v, lo, hi) { const n = parseInt(v, 10); return isNaN(n) ? lo : Math.max(lo, Math.min(hi, n)); }
function str(v, fb, max)  { return String(v == null ? fb : v).slice(0, max); }

function mediaStr(v) {
  const s = String(v || '');
  // Data-URLs are much longer than regular links. Keep enough headroom for uploaded assets.
  if (s.startsWith('data:')) return s.slice(0, 12 * 1024 * 1024);
  return s.slice(0, 4000);
}

function normalizeEvent(id, src) {
  const base = EVENT_DEFAULTS[id] || EVENT_DEFAULTS.test;
  const s    = (src && typeof src === 'object') ? src : {};
  const rawMsg = s.message != null ? s.message : (s.template != null ? s.template : base.message);
  const rawImg = s.imageUrl || s.mediaUrl || '';
  return {
    enabled:        s.enabled !== false,
    layout:         LAYOUTS.includes(s.layout)   ? s.layout   : base.layout,
    imageUrl:       mediaStr(rawImg),
    message:        str(rawMsg, '', 500),
    duration:       clamp(s.duration,  2,  300) || base.duration,
    textDelay:      clamp(s.textDelay, 0,   60),
    soundUrl:       mediaStr(s.soundUrl || ''),
    soundVolume:    clamp(s.soundVolume, 0, 100) || base.soundVolume,
    bgColor:        str(s.bgColor || '', 'rgba(0,0,0,0)', 80),
    animIn:         ANIM_IN.includes(s.animIn)   ? s.animIn   : base.animIn,
    animOut:        ANIM_OUT.includes(s.animOut) ? s.animOut  : base.animOut,
    fontFamily:     FONTS.includes(s.fontFamily) ? s.fontFamily : base.fontFamily,
    fontSize:       clamp(s.fontSize,  12,  80) || base.fontSize,
    fontWeight:     WEIGHTS.includes(parseInt(s.fontWeight, 10)) ? parseInt(s.fontWeight, 10) : base.fontWeight,
    textColor:      str(s.textColor      || '', '#ffffff',  40),
    highlightColor: str(s.highlightColor || '', '#14d3aa',  40),
    platform:       str(base.platform, 'general', 20),
  };
}

function normalizeConfig(raw) {
  const inc  = (raw && typeof raw === 'object') ? raw : {};
  const inev = (inc.events && typeof inc.events === 'object') ? inc.events : {};
  const out  = {
    global:       (inc.global && typeof inc.global === 'object') ? inc.global : {},
    events:       {},
    customEvents: Array.isArray(inc.customEvents) ? inc.customEvents : [],
    testSamples:  (inc.testSamples && typeof inc.testSamples === 'object') ? inc.testSamples : {},
  };
  Object.keys(EVENT_DEFAULTS).forEach(id => { out.events[id] = normalizeEvent(id, inev[id]); });
  return out;
}

function readRaw() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { return null; } }

function getConfig()    { return normalizeConfig(readRaw()); }

function saveConfig(data) {
  const next = normalizeConfig(data);
  atomicWriteJson(FILE, next);
  return next;
}

module.exports = { getConfig, saveConfig, EVENT_DEFAULTS, ANIM_IN, ANIM_OUT, FONTS };
