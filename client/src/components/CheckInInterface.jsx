import { useState, useEffect } from 'react';
import axios from 'axios';
import CameraView from './CameraView';
import { getTelegramInitDataString, waitForTelegramInitData } from '../telegramWebAppInit.js';
import { hasAnyAuth } from '../authFallback.js';

export default function CheckInInterface({ requestId, user, onComplete }) {
  const [locationSent, setLocationSent] = useState(false);
  const [photoSent, setPhotoSent] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const [photoError, setPhotoError] = useState(null);
  const [isWithinZone, setIsWithinZone] = useState(null);
  const [distanceToZone, setDistanceToZone] = useState(null);
  const [locationAccuracy, setLocationAccuracy] = useState(null);
  const [loading, setLoading] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const geoTotalTimeoutMs = 30000;
  const geoAccuracyThreshold = 150;
  const [geoStatus, setGeoStatus] = useState(null);
  const [geoUnavailable, setGeoUnavailable] = useState(false);

  useEffect(() => {
    localStorage.removeItem('cameraPermissionDenied');
    localStorage.removeItem('geoPermissionDenied');
  }, []);

  // Проверяем завершение чекинга и закрываем мини-приложение
  useEffect(() => {
    const geoDone = locationSent || geoUnavailable;
    if (geoDone && photoSent) {
      if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.close();
      }
      if (onComplete) {
        onComplete();
      }
    }
  }, [locationSent, geoUnavailable, photoSent, onComplete]);

  const handleClientEvent = (eventType, eventData = {}) => {
    void reportClientEvent({ eventType, eventData, requestId });
  };

  const shouldGateCameraStart = Boolean(
    user?.telegramId === '195698852'
      && user?.role !== 'DIRECTOR'
      && !user?.cameraManualStartDisabled
  );

  const uploadPhoto = async (file) => {
    if (photoSent || uploadingPhoto) {
      return true;
    }
    setUploadingPhoto(true);
    setPhotoError(null);

    try {
      const initData = await waitForTelegramInitData(4000);
      if (!initData && !hasAnyAuth()) {
        setPhotoError(
          'Не удалось получить данные Telegram. Пожалуйста, откройте приложение через Telegram бота.'
        );
        return false;
      }
      const formData = new FormData();
      formData.append('photo', file);
      if (requestId) {
        formData.append('requestId', requestId);
      }

      const photoHeaders = { 'Content-Type': 'multipart/form-data' };
      if (initData) {
        photoHeaders['x-telegram-init-data'] = initData;
      }

      await axios.post(
        '/api/check-in/photo',
        formData,
        {
          headers: photoHeaders,
          timeout: 60000
        }
      );

      setPhotoSent(true);
      handleClientEvent('photo_upload_success', {
        size: file?.size,
        type: file?.type
      });
      return true;
    } catch (error) {
      console.error('Error sending photo:', error);
      handleClientEvent('photo_upload_error', {
        status: error?.response?.status,
        message: error?.message
      });
      const isNetwork = !error.response && (error.code === 'ECONNABORTED' || error.message === 'Network Error' || error.code === 'ERR_NETWORK');
      setPhotoError(
        isNetwork
          ? 'Ошибка сети. Проверьте подключение и попробуйте снова.'
          : (error.response?.data?.error || 'Ошибка отправки фото')
      );
      return false;
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSendPhoto = async () => {
    if (photoSent || uploadingPhoto) {
      return;
    }
    setPhotoError(null);
    setCameraActive(true);
  };

  const handleSendLocation = async () => {
    const telegramLocationAvailable = Boolean(getTelegramLocationManager());

    if (!telegramLocationAvailable && !navigator.geolocation) {
      setLocationError('Геолокация не поддерживается вашим браузером');
      return;
    }

    setLoading(true);
    setLocationError(null);
    setLocationAccuracy(null);
    setGeoStatus(null);
    setGeoUnavailable(false);

    const startTime = Date.now();

    try {
      const initDataForAuth = await waitForTelegramInitData(4000);
      if (!initDataForAuth && !hasAnyAuth()) {
        setLocationError(
          'Не удалось получить данные Telegram. Закройте мини-приложение и откройте проверку снова из кнопки в боте.'
        );
        setLoading(false);
        setGeoStatus(null);
        return;
      }

      const locationSources = [];
      if (telegramLocationAvailable) {
        locationSources.push('telegram');
      }
      if (navigator.geolocation) {
        locationSources.push('browser');
      }

      let position = null;
      let locationSource = null;
      let lastError = null;
      let totalTimedOut = false;

      const totalTimeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error('GeoTotalTimeout')),
          geoTotalTimeoutMs
        );
      });

      for (const source of locationSources) {
        const elapsed = Date.now() - startTime;
        const remainingMs = Math.max(5000, geoTotalTimeoutMs - elapsed);
        const sourceTimeoutMs = Math.min(
          remainingMs - 500,
          source === 'telegram' ? 12000 : 25000
        );

        setGeoStatus(source === 'telegram' ? 'telegram' : 'browser');

        handleClientEvent('geo_request', {
          source,
          highAccuracy: true,
          timeoutMs: sourceTimeoutMs,
          accuracyThreshold: geoAccuracyThreshold
        });

        try {
          position = await Promise.race([
            getLocationFromSource(source, {
              timeoutMs: sourceTimeoutMs,
              accuracyThreshold: geoAccuracyThreshold,
              highAccuracy: true,
              maxAgeMs: 0
            }),
            totalTimeoutPromise
          ]);
          locationSource = source;
          break;
        } catch (error) {
          if (error?.message === 'GeoTotalTimeout') {
            totalTimedOut = true;
            break;
          }
          lastError = error;
          lastError.source = source;
          handleClientEvent('geo_error', {
            source,
            code: error?.code,
            message: error?.message
          });
          if (Date.now() - startTime >= geoTotalTimeoutMs) {
            totalTimedOut = true;
            break;
          }
        }
      }

      if (!position) {
        if (totalTimedOut || Date.now() - startTime >= geoTotalTimeoutMs) {
          setGeoStatus('failed');
          setGeoUnavailable(true);
          setLocationError('Геолокацию определить не удалось. Вы можете отправить только фото.');
        } else if (lastError?.source === 'browser' && lastError?.code === 1) {
          setLocationError('Доступ к геолокации запрещен. Разрешите доступ в настройках браузера.');
        } else {
          setLocationError('Не удалось получить геолокацию. Попробуйте еще раз.');
        }
        return;
      }

      setGeoStatus('success');

      const locationHeaders = {};
      if (initDataForAuth) {
        locationHeaders['x-telegram-init-data'] = initDataForAuth;
      }

      const response = await axios.post(
        '/api/check-in/location',
        {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null
        },
        {
          headers: locationHeaders,
          timeout: 15000
        }
      );

      setLocationSent(true);
      setIsWithinZone(response.data.isWithinZone);
      setDistanceToZone(response.data.distanceToZone);
      if (Number.isFinite(position.coords.accuracy)) {
        setLocationAccuracy(Math.round(position.coords.accuracy));
      }
      handleClientEvent('geo_success', {
        source: locationSource,
        accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null
      });

      try {
        if (window.Telegram?.WebApp) {
          const msg = response.data.isWithinZone
            ? '✅ Вы в рабочей зоне!'
            : `❌ Вы вне рабочей зоны. Расстояние: ${Math.round(response.data.distanceToZone || 0)}м`;
          window.Telegram.WebApp.showAlert(msg);
        }
      } catch (alertErr) {
        console.warn('Telegram showAlert failed:', alertErr);
      }
    } catch (error) {
      const isNetwork = !error.response && (error.code === 'ECONNABORTED' || error.message === 'Network Error' || error.code === 'ERR_NETWORK');
      setLocationError(
        isNetwork
          ? 'Ошибка сети. Проверьте подключение и попробуйте снова.'
          : (error?.response?.data?.error || 'Не удалось отправить геолокацию. Попробуйте еще раз.')
      );
    } finally {
      setLoading(false);
      setGeoStatus(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      {/* Модальное окно с камерой */}
      {cameraActive && (
        <CameraView
          onCapture={async (file) => {
            setCameraActive(false);
            await uploadPhoto(file);
          }}
          onClose={() => setCameraActive(false)}
          onError={(message) => setPhotoError(message)}
          onCameraEvent={handleClientEvent}
          manualStartOnly={shouldGateCameraStart}
          captureDisabled={uploadingPhoto || photoSent}
        />
      )}
      {uploadingPhoto && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl px-6 py-4 shadow-lg flex items-center gap-3">
            <div className="h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            <span className="text-sm text-gray-700">Загрузка фото...</span>
          </div>
        </div>
      )}

      <div className="max-w-md mx-auto mt-8">
        <div className="bg-white rounded-2xl shadow-xl p-6">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
              <svg className="w-10 h-10 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-800 mb-2">
              Проверка местоположения
            </h1>
            <p className="text-gray-600">
              Отправьте ваше текущее местоположение и фото
            </p>
          </div>

          {/* Статус отправки геолокации */}
          <div className="mb-4 p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-gray-700">📍 Геолокация</span>
              {locationSent ? (
                <span className="text-green-600 font-semibold">✓ Отправлено</span>
              ) : geoUnavailable ? (
                <span className="text-amber-600 font-medium">Пропущено</span>
              ) : (
                <span className="text-gray-400">Не отправлено</span>
              )}
            </div>
            {geoStatus === 'telegram' && (
              <p className="text-sm text-blue-600 mt-1 flex items-center gap-2">
                <span className="inline-block h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                Определяем геолокацию через Telegram...
              </p>
            )}
            {geoStatus === 'browser' && (
              <p className="text-sm text-blue-600 mt-1 flex items-center gap-2">
                <span className="inline-block h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                Определяем через браузер...
              </p>
            )}
            {geoUnavailable && !locationSent && (
              <p className="text-sm text-amber-700 mt-1">
                Геолокацию определить не удалось. Вы можете отправить только фото.
              </p>
            )}
            {isWithinZone !== null && (
              <div className="mt-2 text-sm">
                {isWithinZone ? (
                  <span className="text-green-600">✅ Вы в рабочей зоне</span>
                ) : (
                  <span className="text-red-600">
                    ❌ Вы вне рабочей зоны ({Math.round(distanceToZone || 0)}м)
                  </span>
                )}
              </div>
            )}
            {locationAccuracy !== null && (
              <div className="mt-2 text-xs text-gray-500">
                Точность геолокации: ~{locationAccuracy} м
              </div>
            )}
            {locationError && !geoUnavailable && (
              <div className="mt-1 space-y-2">
                <p className="text-sm text-red-600">{locationError}</p>
                {locationError.includes('запрещен') && (
                  <button
                    type="button"
                    onClick={() => {
                      setLocationError(null);
                      void handleSendLocation();
                    }}
                    disabled={loading}
                    className="text-sm text-blue-600 underline disabled:opacity-50"
                  >
                    Попробовать снова (после разрешения в настройках)
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Статус отправки фото */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            {(locationSent || geoUnavailable) && !photoSent && (
              <p className="text-sm text-blue-600 mb-2">
                {geoUnavailable ? 'Отправьте фото' : 'Теперь отправьте фото'}
              </p>
            )}
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-gray-700">📷 Фото</span>
              {photoSent ? (
                <span className="text-green-600 font-semibold">✓ Отправлено</span>
              ) : (
                <span className="text-gray-400">Не отправлено</span>
              )}
            </div>
            {photoError && (
              <p className="text-sm text-red-600 mt-1">{photoError}</p>
            )}
          </div>

          {/* Кнопки действий */}
          <div className="space-y-3">
            <button
              onClick={handleSendLocation}
              disabled={locationSent || geoUnavailable || loading || uploadingPhoto}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium py-4 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>
                {locationSent
                  ? 'Геолокация отправлена'
                  : geoUnavailable
                    ? 'Геолокация недоступна'
                    : 'Отправить геолокацию'}
              </span>
            </button>

            <button
              onClick={handleSendPhoto}
              disabled={
                photoSent ||
                (loading && !geoUnavailable) ||
                cameraActive ||
                uploadingPhoto
              }
              className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium py-4 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>{photoSent ? 'Фото отправлено' : 'Открыть камеру'}</span>
            </button>
          </div>

          {(locationSent || geoUnavailable) && photoSent && (
            <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800 text-center">
                ✅ Проверка завершена! Приложение закроется автоматически.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Возвращает initData Telegram WebApp для авторизации запросов.
 */
function getTelegramInitData() {
  return getTelegramInitDataString();
}

/**
 * Отправляет диагностическое событие клиента на сервер.
 */
async function reportClientEvent({ eventType, eventData, requestId }) {
  if (!eventType) {
    return;
  }
  const initData = getTelegramInitData();
  if (!initData && !hasAnyAuth()) {
    return;
  }
  try {
    const payload = {
      eventType,
      eventData: {
        ...eventData,
        checkInRequestId: requestId || undefined
      }
    };
    const eventHeaders = {};
    if (initData) {
      eventHeaders['x-telegram-init-data'] = initData;
    }
    await axios.post('/api/check-in/client-event', payload, {
      headers: eventHeaders,
      timeout: 5000
    });
  } catch (error) {
    console.warn('Client event log failed:', error);
  }
}

function getBestPosition({ timeoutMs, accuracyThreshold, highAccuracy, maxAgeMs }) {
  return new Promise((resolve, reject) => {
    let bestPosition = null;
    let settled = false;
    let watchId = null;
    let timeoutId = null;

    const finish = (result, isError) => {
      if (settled) return;
      settled = true;
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
      }
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      if (isError) {
        reject(result);
      } else {
        resolve(result);
      }
    };

    const considerPosition = (position) => {
      const accuracy = position?.coords?.accuracy;
      if (!bestPosition || (Number.isFinite(accuracy) && accuracy < bestPosition.coords.accuracy)) {
        bestPosition = position;
      }
      if (Number.isFinite(accuracy) && accuracy <= accuracyThreshold) {
        finish(position, false);
      }
    };

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        considerPosition(position);
      },
      (error) => {
        if (bestPosition) {
          finish(bestPosition, false);
        } else {
          finish(error, true);
        }
      },
      {
        enableHighAccuracy: highAccuracy,
        timeout: timeoutMs,
        maximumAge: maxAgeMs
      }
    );

    timeoutId = setTimeout(() => {
      if (bestPosition) {
        finish(bestPosition, false);
        return;
      }
      const timeoutError = new Error('Geolocation timeout');
      timeoutError.code = 3;
      finish(timeoutError, true);
    }, timeoutMs + 500);
  });
}

/**
 * Возвращает Telegram LocationManager, если доступен.
 */
function getTelegramLocationManager() {
  return window.Telegram?.WebApp?.LocationManager || null;
}

/**
 * Запрашивает геолокацию через Telegram LocationManager.
 */
function getTelegramLocationPosition({ timeoutMs }) {
  return new Promise((resolve, reject) => {
    const manager = getTelegramLocationManager();
    if (!manager) {
      const error = new Error('Telegram LocationManager unavailable');
      error.code = 'TELEGRAM_LOCATION_UNAVAILABLE';
      reject(error);
      return;
    }

    let settled = false;
    let timeoutId = null;

    const finish = (result, isError) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      if (isError) {
        reject(result);
      } else {
        resolve(result);
      }
    };

    const handleLocation = (locationData) => {
      if (!locationData
        || !Number.isFinite(locationData.latitude)
        || !Number.isFinite(locationData.longitude)
      ) {
        const error = new Error('Telegram location not available');
        error.code = 'TELEGRAM_LOCATION_DENIED';
        finish(error, true);
        return;
      }

      finish({
        coords: {
          latitude: locationData.latitude,
          longitude: locationData.longitude,
          accuracy: Number.isFinite(locationData.horizontal_accuracy)
            ? locationData.horizontal_accuracy
            : null
        }
      }, false);
    };

    const requestLocation = () => {
      try {
        manager.getLocation(handleLocation);
      } catch (error) {
        finish(error, true);
      }
    };

    if (manager.isInited) {
      requestLocation();
    } else {
      manager.init((ok) => {
        if (!ok) {
          const error = new Error('Telegram LocationManager init failed');
          error.code = 'TELEGRAM_LOCATION_INIT_FAILED';
          finish(error, true);
          return;
        }
        requestLocation();
      });
    }

    timeoutId = setTimeout(() => {
      const error = new Error('Telegram location timeout');
      error.code = 'TELEGRAM_LOCATION_TIMEOUT';
      finish(error, true);
    }, timeoutMs + 500);
  });
}

/**
 * Возвращает геолокацию из выбранного источника.
 */
function getLocationFromSource(source, options) {
  if (source === 'telegram') {
    return getTelegramLocationPosition({ timeoutMs: options.timeoutMs });
  }
  if (source === 'browser') {
    return getBestPosition({
      timeoutMs: options.timeoutMs,
      accuracyThreshold: options.accuracyThreshold,
      highAccuracy: options.highAccuracy,
      maxAgeMs: options.maxAgeMs
    });
  }
  const error = new Error('Unknown location source');
  error.code = 'UNKNOWN_LOCATION_SOURCE';
  return Promise.reject(error);
}
