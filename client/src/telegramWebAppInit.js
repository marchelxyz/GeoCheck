/**
 * Ждёт появления объекта Telegram.WebApp (скрипт telegram-web-app.js / WebView на Android).
 * На Huawei и др. устройствах SDK иногда подключается позже первого кадра React.
 *
 * @param {number} maxWaitMs
 * @param {number} intervalMs
 * @returns {Promise<boolean>}
 */
export async function waitForTelegramWebApp(maxWaitMs = 10000, intervalMs = 100) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (window.Telegram?.WebApp) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
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
  if (!window.Telegram?.WebApp) {
    return '';
  }
  const webApp = window.Telegram.WebApp;
  webApp.ready();
  webApp.expand();
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const data = webApp.initData;
    if (typeof data === 'string' && data.length > 0) {
      return data;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return '';
}
