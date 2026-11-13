/**
 * theme.js — applies the color theme as <html data-theme="light|dark"> BEFORE the page paints.
 *
 * Loaded without `defer` in <head>, right after storage.js, on every page (index.html, blocked.html),
 * so both pages always show the same theme and there is no light→dark flash.
 * The only DOM it touches is that one attribute; the CSS keys every dark color on [data-theme="dark"].
 *
 * Exposes one global: Theme
 * Depends on: AppStorage (settings.theme: 'system' | 'light' | 'dark').
 */
const Theme = (() => {
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  let choice = AppStorage.DEFAULTS.theme;

  /** 'system' follows the OS; 'light' / 'dark' are fixed. */
  function resolve(themeChoice) {
    if (themeChoice !== 'system') return themeChoice;
    return darkQuery.matches ? 'dark' : 'light';
  }

  function render() {
    document.documentElement.dataset.theme = resolve(choice);
  }

  /** Switches the page to a theme choice; unknown values fall back to 'system'. */
  function apply(themeChoice) {
    choice = AppStorage.THEMES.includes(themeChoice) ? themeChoice : AppStorage.DEFAULTS.theme;
    render();
  }

  darkQuery.addEventListener('change', render); // live OS switch while the choice is 'system'
  apply(AppStorage.getSettings().theme);

  return Object.freeze({ apply });
})();
