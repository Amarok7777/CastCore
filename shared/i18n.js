/**
 * shared/i18n.js — Lightweight translation engine.
 *
 * Usage in HTML:
 *   <span data-i18n="key">Fallback text</span>
 *   <input data-i18n-placeholder="key" placeholder="Fallback">
 *   <span data-i18n-html="key">Fallback <b>HTML</b></span>
 *   <button data-i18n-attr="title" data-i18n="key" title="Fallback">…</button>
 *
 * Usage in JS (after page is interactive):
 *   t('key')            → translated string
 *   t('key', {n: 42})   → with {n} placeholder replaced
 */
(function () {
  'use strict';

  const SUPPORTED   = ['de', 'en'];
  const DEFAULT_LANG = 'de';

  let _lang    = DEFAULT_LANG;
  let _strings = {};
  let _ready   = false;

  // ── Language detection ───────────────────────────────────────────────────────

  function _detectLang() {
    try {
      const stored = localStorage.getItem('castcore_lang');
      if (stored && SUPPORTED.includes(stored)) return stored;
    } catch {}
    const nav = (navigator.language || navigator.userLanguage || '').toLowerCase();
    return nav.startsWith('de') ? 'de' : 'en';
  }

  // ── Core functions ───────────────────────────────────────────────────────────

  async function _load(lang) {
    const res = await fetch(`/shared/locales/${lang}.json`);
    if (!res.ok) throw new Error(`i18n: could not load ${lang}.json`);
    _strings = await res.json();
    _lang    = lang;
    _ready   = true;
    try { localStorage.setItem('castcore_lang', lang); } catch {}
    document.documentElement.lang = lang === 'de' ? 'de' : 'en';
  }

  function t(key, vars) {
    let s = Object.prototype.hasOwnProperty.call(_strings, key) ? _strings[key] : null;
    if (s === null) {
      // fallback: return the key itself so missing strings are visible in dev
      return key;
    }
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
      }
    }
    return s;
  }

  // ── DOM application ──────────────────────────────────────────────────────────

  function apply(root) {
    root = root || document;

    root.querySelectorAll('[data-i18n]').forEach(el => {
      const key  = el.getAttribute('data-i18n');
      const attr = el.getAttribute('data-i18n-attr');
      if (attr) {
        el.setAttribute(attr, t(key));
      } else {
        el.textContent = t(key);
      }
    });

    root.querySelectorAll('[data-i18n-html]').forEach(el => {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });

    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  async function setLang(lang) {
    if (!SUPPORTED.includes(lang)) return;
    await _load(lang);
    apply();
    // Notify listeners (e.g. dynamic content re-renders)
    document.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
  }

  function getLang() { return _lang; }

  // ── Language switcher widget ─────────────────────────────────────────────────

  function createSwitcher(containerEl) {
    if (!containerEl) return;
    containerEl.innerHTML = '';
    SUPPORTED.forEach(l => {
      const btn = document.createElement('button');
      btn.type      = 'button';
      btn.className = 'btn sm lang-btn' + (_lang === l ? ' lang-btn-active' : '');
      btn.textContent = l.toUpperCase();
      btn.setAttribute('aria-pressed', String(_lang === l));
      btn.addEventListener('click', async () => {
        await setLang(l);
        containerEl.querySelectorAll('.lang-btn').forEach(b => {
          b.classList.toggle('lang-btn-active', b.textContent === _lang.toUpperCase());
          b.setAttribute('aria-pressed', b.textContent === _lang.toUpperCase() ? 'true' : 'false');
        });
      });
      containerEl.appendChild(btn);
    });
  }

  // ── Auto-init ────────────────────────────────────────────────────────────────

  _lang = _detectLang();

  const _initPromise = _load(_lang).then(() => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => apply());
    } else {
      apply();
    }
  }).catch(err => {
    console.warn('[i18n] Load error:', err.message);
  });

  window.t    = t;
  window.i18n = { t, setLang, getLang, apply, createSwitcher, ready: () => _initPromise };
})();
