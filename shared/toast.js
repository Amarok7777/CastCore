/**
 * shared/toast.js — single-instance toast notification.
 * Creates its own container; no HTML boilerplate needed.
 * No defer — must be callable from inline scripts.
 */
(function() {
  let toastEl      = null;
  let dismissTimer = null;

  function ensureEl() {
    if (toastEl) return toastEl;
    toastEl = document.createElement('div');
    toastEl.className = 'shared-toast';
    (document.body || document.documentElement).appendChild(toastEl);
    return toastEl;
  }

  window.toast = function(msg, type) {
    const el   = ensureEl();
    const ok   = type === 'ok';
    const warn = type === 'warn';
    el.className = 'shared-toast shared-toast--' + (ok ? 'ok' : warn ? 'warn' : 'error');
    const icon = ok   ? '<path d="M1 6.5l3 3 7-7"/>'
               : warn ? '<path d="M6 3v3M6 9h.01"/>'
               :        '<path d="M1 1l10 10M11 1L1 11"/>';
    el.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">' + icon + '</svg>' +
      '<span>' + (typeof esc === 'function' ? esc(msg) : String(msg || '')) + '</span>';
    el.classList.add('shared-toast--visible');
    clearTimeout(dismissTimer);
    dismissTimer = setTimeout(function() { el.classList.remove('shared-toast--visible'); }, 2600);
  };
})();
