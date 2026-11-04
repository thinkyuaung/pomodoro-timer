/**
 * blocked.js — the only script on blocked.html. Exposes nothing.
 *
 * "Back to timer" asks the extension to switch to the timer tab that is already running
 * (and close this blocked tab) instead of loading a brand-new timer here.
 * If the extension can't be reached, the link's normal href (index.html) is used.
 */
(() => {
  'use strict';

  const link = document.getElementById('backToTimer');
  if (!link || !SiteBlocker.isAvailable()) return; // plain link fallback

  link.addEventListener('click', async (event) => {
    event.preventDefault();
    const ok = await SiteBlocker.openTimer(); // on success this tab is closed or replaced
    if (!ok) window.location.href = link.href;
  });
})();
