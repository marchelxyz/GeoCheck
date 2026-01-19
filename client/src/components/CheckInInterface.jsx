import { useState, useEffect } from 'react';
import axios from 'axios';
import CameraView from './CameraView';

export default function CheckInInterface({ requestId, onComplete }) {
  const [locationSent, setLocationSent] = useState(false);
  const [photoSent, setPhotoSent] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const [photoError, setPhotoError] = useState(null);
  const [isWithinZone, setIsWithinZone] = useState(null);
  const [distanceToZone, setDistanceToZone] = useState(null);
  const [loading, setLoading] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);

  const getTelegramInitData = () => {
    return window.Telegram?.WebApp?.initData || '';
  };

  // Проверяем завершение чекинга и закрываем мини-приложение
  useEffect(() => {
    if (locationSent && photoSent) {
      // Небольшая задержка перед закрытием, чтобы пользователь увидел сообщение о завершении
      const timer = setTimeout(() => {
        if (window.Telegram?.WebApp) {
          window.Telegram.WebApp.close();
        }
        if (onComplete) {
          onComplete();
        }
      }, 2000); // 2 секунды задержки

      return () => clearTimeout(timer);
    }
  }, [locationSent, photoSent, onComplete]);

  const uploadPhoto = async (file) => {
    setLoading(true);
    setPhotoError(null);

    try {
      const initData = getTelegramInitData();
      const formData = new FormData();
      formData.append('photo', file);
      if (requestId) {
        formData.append('requestId', requestId);
      }

      await axios.post(
        '/api/check-in/photo',
        formData,
        {
          headers: {
            'x-telegram-init-data': initData,
            'Content-Type': 'multipart/form-data'
          }
        }
      );

      setPhotoSent(true);
      if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.showAlert('✅ Фото отправлено!');
      }
      return true;
    } catch (error) {
      console.error('Error sending photo:', error);
      setPhotoError(error.response?.data?.error || 'Ошибка отправки фото');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleSendPhoto = async () => {
    setPhotoError(null);
    setCameraActive(true);
  };

  const handleSendLocation = async () => {
    if (!navigator.geolocation) {
      setLocationError('Геолокация не поддерживается вашим браузером');
      return;
    }

    setLoading(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const initData = getTelegramInitData();
          const response = await axios.post(
            '/api/check-in/location',
            {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude
            },
            {
              headers: { 'x-telegram-init-data': initData }
            }
          );

          setLocationSent(true);
          setIsWithinZone(response.data.isWithinZone);
          setDistanceToZone(response.data.distanceToZone);

          if (response.data.isWithinZone) {
            if (window.Telegram?.WebApp) {
              window.Telegram.WebApp.showAlert('✅ Вы в рабочей зоне!');
            }
          } else {
            if (window.Telegram?.WebApp) {
              window.Telegram.WebApp.showAlert(`❌ Вы вне рабочей зоны. Расстояние: ${Math.round(response.data.distanceToZone || 0)}м`);
            }
          }
        } catch (error) {
          console.error('Error sending location:', error);
          setLocationError(error.response?.data?.error || 'Ошибка отправки геолокации');
        } finally {
          setLoading(false);
        }
      },
      (error) => {
        setLocationError('Не удалось получить геолокацию. Пожалуйста, разрешите доступ к геолокации.');
        setLoading(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      {/* Модальное окно с камерой */}
      {cameraActive && (
        <CameraView
          onCapture={async (file) => {
            const ok = await uploadPhoto(file);
            if (ok) {
              setCameraActive(false);
            }
          }}
          onClose={() => setCameraActive(false)}
          onError={(message) => setPhotoError(message)}
        />
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
              ) : (
                <span className="text-gray-400">Не отправлено</span>
              )}
            </div>
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
            {locationError && (
              <p className="text-sm text-red-600 mt-1">{locationError}</p>
            )}
          </div>

          {/* Статус отправки фото */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
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
              disabled={locationSent || loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium py-4 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>{locationSent ? 'Геолокация отправлена' : 'Отправить геолокацию'}</span>
            </button>

            <button
              onClick={handleSendPhoto}
              disabled={photoSent || loading || cameraActive}
              className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium py-4 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>{photoSent ? 'Фото отправлено' : 'Открыть камеру'}</span>
            </button>
          </div>

          {locationSent && photoSent && (
            <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800 text-center">
                ✅ Проверка завершена! Все данные отправлены. Приложение закроется автоматически...
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}