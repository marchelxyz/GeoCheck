import { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';

const SEND_INTERVAL_MS = 5000;
const STATUS_POLL_INTERVAL_MS = 15000;
const MIN_DISTANCE_M = 5;

const currentIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

function RecenterMap({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) {
      map.setView(position, map.getZoom());
    }
  }, [position?.[0], position?.[1]]);
  return null;
}

/**
 * Tracking interface opened from Telegram WebApp button.
 * Uses watchPosition to continuously send location to the server.
 */
export default function TrackingInterface({ sessionId }) {
  const [status, setStatus] = useState('initializing');
  const [position, setPosition] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const [isWithinZone, setIsWithinZone] = useState(null);
  const [distanceToZone, setDistanceToZone] = useState(null);
  const [error, setError] = useState(null);
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState('0:00');
  const [pointsSent, setPointsSent] = useState(0);
  const [sessionStopped, setSessionStopped] = useState(false);

  const lastSentRef = useRef(null);
  const lastSendTimeRef = useRef(0);
  const watchIdRef = useRef(null);
  const sendIntervalRef = useRef(null);
  const statusPollRef = useRef(null);
  const pendingPositionRef = useRef(null);

  useEffect(() => {
    _startTracking();
    _startElapsedTimer();
    _startStatusPolling();

    return () => {
      _stopTracking();
      if (sendIntervalRef.current) clearInterval(sendIntervalRef.current);
      if (statusPollRef.current) clearInterval(statusPollRef.current);
    };
  }, []);

  function _startTracking() {
    if (!navigator.geolocation) {
      setError('Геолокация не поддерживается вашим браузером');
      setStatus('error');
      return;
    }

    setStatus('requesting_permission');

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy: acc } = pos.coords;
        setPosition([latitude, longitude]);
        setAccuracy(Math.round(acc));
        setStatus('tracking');
        setError(null);
        pendingPositionRef.current = { latitude, longitude, accuracy: acc };
      },
      (err) => {
        if (err.code === 1) {
          setError('Доступ к геолокации запрещён. Разрешите доступ в настройках браузера.');
          setStatus('permission_denied');
        } else if (err.code === 2) {
          setError('Не удалось определить местоположение. Проверьте GPS.');
          setStatus('error');
        } else {
          setError('Таймаут определения местоположения. Попробуйте выйти на открытое пространство.');
          setStatus('error');
        }
      },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
    );

    sendIntervalRef.current = setInterval(_trySendPosition, SEND_INTERVAL_MS);
  }

  function _stopTracking() {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }

  function _startElapsedTimer() {
    const tick = () => {
      const diffMs = Date.now() - startedAt;
      const totalSeconds = Math.floor(diffMs / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      setElapsed(
        hours > 0
          ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
          : `${minutes}:${String(seconds).padStart(2, '0')}`
      );
    };
    const timerId = setInterval(tick, 1000);
    return () => clearInterval(timerId);
  }

  function _startStatusPolling() {
    statusPollRef.current = setInterval(async () => {
      try {
        const initData = _getInitData();
        if (!initData) return;
        const res = await axios.get(`/api/tracking/session/${sessionId}/status`, {
          headers: { 'x-telegram-init-data': initData }
        });
        if (res.data.status !== 'ACTIVE') {
          setSessionStopped(true);
          setStatus('stopped');
          _stopTracking();
        }
      } catch {
        // ignore polling errors
      }
    }, STATUS_POLL_INTERVAL_MS);
  }

  const _trySendPosition = useCallback(async () => {
    const pending = pendingPositionRef.current;
    if (!pending) return;

    const now = Date.now();
    if (now - lastSendTimeRef.current < SEND_INTERVAL_MS - 500) return;

    if (lastSentRef.current && _haversineDistance(
      lastSentRef.current.latitude, lastSentRef.current.longitude,
      pending.latitude, pending.longitude
    ) < MIN_DISTANCE_M) {
      return;
    }

    const initData = _getInitData();
    if (!initData) return;

    try {
      const res = await axios.post('/api/tracking/location', {
        sessionId,
        latitude: pending.latitude,
        longitude: pending.longitude,
        accuracy: pending.accuracy
      }, {
        headers: { 'x-telegram-init-data': initData }
      });

      lastSentRef.current = { latitude: pending.latitude, longitude: pending.longitude };
      lastSendTimeRef.current = now;
      setPointsSent((prev) => prev + 1);

      if (res.data.isWithinZone !== undefined) {
        setIsWithinZone(res.data.isWithinZone);
      }
      if (res.data.distanceToZone !== undefined) {
        setDistanceToZone(Math.round(res.data.distanceToZone));
      }

      if (res.status === 410) {
        setSessionStopped(true);
        setStatus('stopped');
        _stopTracking();
      }
    } catch (err) {
      if (err.response?.status === 410) {
        setSessionStopped(true);
        setStatus('stopped');
        _stopTracking();
      }
    }
  }, [sessionId]);

  function _getInitData() {
    return window.Telegram?.WebApp?.initData || null;
  }

  function _haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function handleClose() {
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.close();
    }
  }

  if (sessionStopped) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="text-4xl mb-4">🛑</div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">Трансляция завершена</h1>
          <p className="text-gray-600 mb-6">
            Сессия трекинга была остановлена.
          </p>
          <button
            onClick={handleClose}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors"
          >
            Закрыть
          </button>
        </div>
      </div>
    );
  }

  if (status === 'permission_denied') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="text-4xl mb-4">📍</div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">Нужен доступ к геолокации</h1>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors"
          >
            Попробовать снова
          </button>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">Ошибка геолокации</h1>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors"
          >
            Попробовать снова
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className={`px-4 py-3 text-white text-center ${
        isWithinZone === true ? 'bg-green-600' : isWithinZone === false ? 'bg-red-600' : 'bg-blue-600'
      }`}>
        <div className="flex items-center justify-center gap-2">
          <div className={`w-3 h-3 rounded-full ${status === 'tracking' ? 'bg-white animate-pulse' : 'bg-white/50'}`}></div>
          <span className="font-medium">
            {status === 'tracking'
              ? (isWithinZone === true ? 'В рабочей зоне' : isWithinZone === false ? 'Вне рабочей зоны' : 'Трансляция активна')
              : status === 'requesting_permission'
                ? 'Запрос геолокации...'
                : 'Инициализация...'}
          </span>
        </div>
      </div>

      {/* Map */}
      {position ? (
        <div className="flex-1" style={{ minHeight: '300px' }}>
          <MapContainer
            center={position}
            zoom={16}
            style={{ height: '100%', width: '100%' }}
            zoomControl={false}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; OpenStreetMap'
            />
            <RecenterMap position={position} />
            <Marker position={position} icon={currentIcon} />
            {accuracy && (
              <Circle
                center={position}
                radius={accuracy}
                pathOptions={{ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.1, weight: 1 }}
              />
            )}
          </MapContainer>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Определяем местоположение...</p>
          </div>
        </div>
      )}

      {/* Stats footer */}
      <div className="bg-white border-t border-gray-200 px-4 py-3 space-y-2">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-xs text-gray-500">Время</p>
            <p className="text-lg font-mono font-bold text-gray-800">{elapsed}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Точность</p>
            <p className="text-lg font-mono font-bold text-gray-800">
              {accuracy ? `${accuracy} м` : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Отправлено</p>
            <p className="text-lg font-mono font-bold text-gray-800">{pointsSent}</p>
          </div>
        </div>

        {distanceToZone !== null && isWithinZone === false && (
          <p className="text-center text-sm text-red-600">
            До зоны: {distanceToZone} м
          </p>
        )}

        <p className="text-center text-xs text-gray-400">
          Не закрывайте это окно — трансляция остановится
        </p>
      </div>
    </div>
  );
}
