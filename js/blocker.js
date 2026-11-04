/**
 * blocker.js — page-side bridge to the extension background (js/background.js). No DOM access.
 *
 * Exposes one global: SiteBlocker
 *   isAvailable()                     → true only when the page runs inside the extension
 *   apply({ mode, sites, endTime })   → Promise<boolean>  block sites until endTime (ms epoch)
 *   clear()                           → Promise<boolean>  remove blocking
 *   openTimer()                       → Promise<boolean>  (blocked page) switch to the running timer tab
 *
 * When opened as a plain page (file://), every call is a harmless no-op that resolves false.
 */
const SiteBlocker = (() => {
  function isAvailable() {
    return (
      typeof chrome !== 'undefined' &&
      !!chrome.runtime &&
      !!chrome.runtime.id &&
      typeof chrome.runtime.sendMessage === 'function'
    );
  }

  async function send(message) {
    if (!isAvailable()) return false;
    try {
      const response = await chrome.runtime.sendMessage(message);
      if (!response || !response.ok) {
        console.warn('[blocker] background refused', response && response.error);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('[blocker] could not reach background', err);
      return false;
    }
  }

  function apply({ mode, sites, endTime }) {
    return send({ type: 'block', mode, sites: [...sites], endTime });
  }

  function clear() {
    return send({ type: 'clear' });
  }

  function openTimer() {
    return send({ type: 'open-timer' });
  }

  return Object.freeze({ isAvailable, apply, clear, openTimer });
})();
