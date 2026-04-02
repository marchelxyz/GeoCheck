import axios from 'axios';
import { getTelegramInitDataString } from './telegramWebAppInit.js';

let _authToken = null;

/**
 * Извлекает authToken из URL query-параметров и сохраняет в памяти.
 *
 * @returns {string | null}
 */
export function extractAuthTokenFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('authToken');
    if (token && token.length > 0) {
      _authToken = token;
    }
  } catch {
    // malformed URL
  }
  return _authToken;
}

/**
 * @returns {string | null}
 */
export function getAuthToken() {
  return _authToken;
}

/**
 * Возвращает true, если доступна хотя бы одна форма аутентификации
 * (Telegram initData или authToken).
 *
 * @returns {boolean}
 */
export function hasAnyAuth() {
  const initData = getTelegramInitDataString();
  if (initData && initData.length > 0) return true;
  return !!_authToken;
}

/**
 * Устанавливает axios interceptor, который добавляет `x-auth-token`
 * к каждому запросу, если токен доступен.
 * initData (через `x-telegram-init-data`) по-прежнему передаётся вызывающим кодом;
 * сервер приоритизирует initData над authToken.
 */
export function setupAuthTokenInterceptor() {
  axios.interceptors.request.use((config) => {
    if (_authToken) {
      config.headers['x-auth-token'] = _authToken;
    }
    return config;
  });
}
