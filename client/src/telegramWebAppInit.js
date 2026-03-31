/**
 * Читает подписанную строку initData из параметров запуска Mini App (hash / query).
 * Если скрипт telegram.org не загрузился, Telegram всё равно передаёт tgWebAppData в URL.
 *
 * @returns {string}
 */
export function parseTelegramWebAppDataFromLocation() {
  try {
    const hash = window.location.hash?.replace(/^#/, '') || '';
    if (hash) {
      const fromHash = new URLSearchParams(hash).get('tgWebAppData');
      if (fromHash) {
        return _decodeInitDataParam(fromHash);
      }
    }
    const fromQuery = new URLSearchParams(window.location.search).get('tgWebAppData');
    if (fromQuery) {
      return _decodeInitDataParam(fromQuery);
    }
  } catch {
    // ignore malformed URL
  }
  return '';
}

/**
 * Подставляет initData из URL в объект WebApp, если SDK ещё не заполнил поле
 * (например, позже перезаписал window.Telegram).
 */
export function ensureTelegramInitDataFromUrl() {
  const fromUrl = parseTelegramWebAppDataFromLocation();
  if (!fromUrl || !window.Telegram?.WebApp) {
    return;
  }
  const webApp = window.Telegram.WebApp;
  if (!webApp.initData || webApp.initData.length === 0) {
    webApp.initData = fromUrl;
  }
}

/**
 * Создаёт минимальный Telegram.WebApp, если SDK с telegram.org не подгрузился,
 * но в URL есть tgWebAppData (типичный случай: блокировка CDN / медленный WebView).
 */
export function applyTelegramPolyfillFromUrl() {
  if (window.Telegram?.WebApp) {
    ensureTelegramInitDataFromUrl();
    return;
  }
  const initData = parseTelegramWebAppDataFromLocation();
  if (!initData) {
    return;
  }
  window.Telegram = window.Telegram || {};
  window.Telegram.WebApp = _createMinimalTelegramWebApp(initData);
}

/**
 * Возвращает строку initData для заголовков API: WebApp, иначе из URL.
 *
 * @returns {string}
 */
export function getTelegramInitDataString() {
  applyTelegramPolyfillFromUrl();
  ensureTelegramInitDataFromUrl();
  const web = window.Telegram?.WebApp;
  if (web?.initData && typeof web.initData === 'string' && web.initData.length > 0) {
    return web.initData;
  }
  return parseTelegramWebAppDataFromLocation();
}

/**
 * Ждёт появления объекта Telegram.WebApp (скрипт telegram-web-app.js / WebView на Android).
 * На Huawei и др. устройствах SDK иногда подключается позже первого кадра React;
 * если в URL есть tgWebAppData — поднимаем полифилл без ожидания внешнего скрипта.
 *
 * @param {number} maxWaitMs
 * @param {number} intervalMs
 * @returns {Promise<boolean>}
 */
export async function waitForTelegramWebApp(maxWaitMs = 10000, intervalMs = 100) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    applyTelegramPolyfillFromUrl();
    if (window.Telegram?.WebApp) {
      ensureTelegramInitDataFromUrl();
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  applyTelegramPolyfillFromUrl();
  if (window.Telegram?.WebApp) {
    ensureTelegramInitDataFromUrl();
    return true;
  }
  return false;
}

/**
 * Ждёт появления непустой строки initData в Telegram WebApp.
 * В Android WebView initData иногда заполняется с задержкой после ready().
 *
 * @param {number} maxWaitMs
 * @param {number} intervalMs
 * @returns {Promise<string>} Подписанная строка initData или пустая строка.
 */
export async function waitForTelegramInitData(maxWaitMs = 5000, intervalMs = 100) {
  applyTelegramPolyfillFromUrl();
  if (!window.Telegram?.WebApp) {
    return '';
  }
  const webApp = window.Telegram.WebApp;
  webApp.ready();
  webApp.expand();
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    ensureTelegramInitDataFromUrl();
    const data = webApp.initData;
    if (typeof data === 'string' && data.length > 0) {
      return data;
    }
    const fromUrl = parseTelegramWebAppDataFromLocation();
    if (fromUrl) {
      webApp.initData = fromUrl;
      return fromUrl;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  ensureTelegramInitDataFromUrl();
  return typeof webApp.initData === 'string' ? webApp.initData : '';
}

/**
 * @param {string} value
 * @returns {string}
 */
function _decodeInitDataParam(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return '';
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * @param {string} initData
 * @returns {Record<string, unknown>}
 */
function _createMinimalTelegramWebApp(initData) {
  return {
    initData,
    initDataUnsafe: {},
    version: '6.0',
    platform: 'android',
    ready: () => {},
    expand: () => {},
    close: () => {},
    showAlert: (msg) => {
      try {
        alert(String(msg));
      } catch {
        // ignore
      }
    },
    colorScheme: 'light',
    themeParams: {},
    isExpanded: true,
    viewportHeight: window.innerHeight,
    viewportStableHeight: window.innerHeight,
    LocationManager: null
  };
}
