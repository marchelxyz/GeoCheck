import { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Circle, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';
import { io } from 'socket.io-client';

const REFRESH_INTERVAL_MS = 30000;

const employeeIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const offlineIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-grey.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const warningIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

function FitBounds({ positions }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 0) {
      map.fitBounds(positions, { padding: [40, 40], maxZoom: 15 });
    }
  }, [positions.length > 0]);
  return null;
}

/**
 * Real-time employee tracking map for the director dashboard.
 * Connects via WebSocket for live updates, falls back to polling.
 */
export default function LiveTrackingMap({ zones = [] }) {
  const [employees, setEmployees] = useState([]);
  const [activeSessions, setActiveSessions] = useState([]);
  const [sessionPoints, setSessionPoints] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const socketRef = useRef(null);
  const defaultCenter = [56.2965, 44.0020];

  useEffect(() => {
    _fetchInitialData();
    const interval = setInterval(_fetchActiveSessions, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const socket = io(window.location.origin, {
      path: '/socket.io',
      auth: { role: 'DIRECTOR' }
    });
    socketRef.current = socket;

    socket.on('tracking:locationUpdate', _handleLocationUpdate);
    socket.on('tracking:sessionStarted', _handleSessionStarted);
    socket.on('tracking:sessionStopped', _handleSessionStopped);

    return () => {
      socket.disconnect();
    };
  }, []);

  const _fetchInitialData = useCallback(async () => {
    try {
      const initData = _getInitData();
      const headers = initData ? { 'x-telegram-init-data': initData } : {};

      const [employeesRes, sessionsRes] = await Promise.all([
        axios.get('/api/tracking/employees', { headers }),
        axios.get('/api/tracking/active', { headers })
      ]);

      setEmployees(employeesRes.data);
      setActiveSessions(sessionsRes.data);

      for (const session of sessionsRes.data) {
        const pointsRes = await axios.get(
          `/api/tracking/session/${session.sessionId}/points`,
          { headers }
        );
        setSessionPoints((prev) => ({ ...prev, [session.sessionId]: pointsRes.data }));
      }
    } catch (error) {
      console.error('Failed to fetch tracking data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const _fetchActiveSessions = useCallback(async () => {
    try {
      const initData = _getInitData();
      const headers = initData ? { 'x-telegram-init-data': initData } : {};
      const res = await axios.get('/api/tracking/active', { headers });
      setActiveSessions(res.data);
    } catch (error) {
      console.error('Failed to refresh sessions:', error);
    }
  }, []);

  function _handleLocationUpdate(data) {
    setActiveSessions((prev) =>
      prev.map((s) =>
        s.sessionId === data.sessionId
          ? { ...s, lastPoint: { latitude: data.latitude, longitude: data.longitude, accuracy: data.accuracy, isWithinZone: data.isWithinZone, timestamp: data.timestamp }, lastUpdateAt: data.timestamp, zoneExitNotified: !data.isWithinZone }
          : s
      )
    );

    setSessionPoints((prev) => {
      const existing = prev[data.sessionId] || [];
      return {
        ...prev,
        [data.sessionId]: [...existing, {
          latitude: data.latitude,
          longitude: data.longitude,
          isWithinZone: data.isWithinZone,
          timestamp: data.timestamp
        }]
      };
    });
  }

  function _handleSessionStarted(data) {
    setActiveSessions((prev) => {
      if (prev.some((s) => s.sessionId === data.sessionId)) return prev;
      return [...prev, {
        sessionId: data.sessionId,
        employeeId: data.employeeId,
        employeeName: data.employeeName,
        startedAt: new Date().toISOString(),
        livePeriod: data.livePeriod,
        lastPoint: null,
        lastUpdateAt: null,
        zoneExitNotified: false
      }];
    });
  }

  function _handleSessionStopped(data) {
    setActiveSessions((prev) => prev.filter((s) => s.sessionId !== data.sessionId));
    setSessionPoints((prev) => {
      const copy = { ...prev };
      delete copy[data.sessionId];
      return copy;
    });
  }

  async function handleRequestTracking(employeeId) {
    try {
      const initData = _getInitData();
      const headers = initData ? { 'x-telegram-init-data': initData } : {};
      await axios.post(`/api/tracking/request/${employeeId}`, {}, { headers });
    } catch (error) {
      console.error('Failed to request tracking:', error);
      alert(error.response?.data?.error || 'Ошибка запроса трекинга');
    }
  }

  async function handleStopTracking(sessionId) {
    try {
      const initData = _getInitData();
      const headers = initData ? { 'x-telegram-init-data': initData } : {};
      await axios.post(`/api/tracking/stop/${sessionId}`, {}, { headers });
    } catch (error) {
      console.error('Failed to stop tracking:', error);
    }
  }

  function _getInitData() {
    return window.Telegram?.WebApp?.initData || null;
  }

  function _getMarkerPositions() {
    return activeSessions
      .filter((s) => s.lastPoint)
      .map((s) => [s.lastPoint.latitude, s.lastPoint.longitude]);
  }

  function _getPolylineSegments(points) {
    if (!points || points.length < 2) return [];

    const segments = [];
    let currentSegment = [points[0]];
    let currentInZone = points[0].isWithinZone;

    for (let i = 1; i < points.length; i++) {
      if (points[i].isWithinZone !== currentInZone) {
        currentSegment.push(points[i]);
        segments.push({ points: currentSegment, inZone: currentInZone });
        currentSegment = [points[i]];
        currentInZone = points[i].isWithinZone;
      } else {
        currentSegment.push(points[i]);
      }
    }
    if (currentSegment.length > 1) {
      segments.push({ points: currentSegment, inZone: currentInZone });
    }

    return segments;
  }

  function _formatTime(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function _formatDuration(startStr) {
    if (!startStr) return '—';
    const diffMs = Date.now() - new Date(startStr).getTime();
    const hours = Math.floor(diffMs / 3600000);
    const minutes = Math.floor((diffMs % 3600000) / 60000);
    return `${hours}ч ${minutes}мин`;
  }

  const markerPositions = _getMarkerPositions();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-gray-600">Загрузка данных трекинга...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Side panel */}
        <div className="lg:col-span-1 space-y-3">
          <h3 className="text-lg font-semibold text-gray-800">Сотрудники</h3>

          {employees.map((emp) => {
            const session = activeSessions.find((s) => s.employeeId === emp.id);
            const isActive = !!session;
            const isOutOfZone = session?.zoneExitNotified;

            return (
              <div
                key={emp.id}
                className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedEmployeeId === emp.id
                    ? 'border-blue-500 bg-blue-50'
                    : isOutOfZone
                      ? 'border-red-300 bg-red-50'
                      : isActive
                        ? 'border-green-300 bg-green-50'
                        : 'border-gray-200 bg-white'
                }`}
                onClick={() => setSelectedEmployeeId(emp.id === selectedEmployeeId ? null : emp.id)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-800">{emp.name}</p>
                    {isActive ? (
                      <div className="text-xs text-gray-500 mt-1">
                        <span className={`inline-block w-2 h-2 rounded-full mr-1 ${isOutOfZone ? 'bg-red-500' : 'bg-green-500'}`}></span>
                        {isOutOfZone ? 'Вне зоны' : 'В зоне'} · {_formatDuration(session.startedAt)}
                        {session.lastPoint && (
                          <span className="ml-1">· обновл. {_formatTime(session.lastUpdateAt)}</span>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 mt-1">Не отслеживается</p>
                    )}
                  </div>
                  <div>
                    {isActive ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleStopTracking(session.sessionId); }}
                        className="text-xs px-2 py-1 bg-red-100 text-red-600 rounded hover:bg-red-200 transition-colors"
                      >
                        Стоп
                      </button>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRequestTracking(emp.id); }}
                        className="text-xs px-2 py-1 bg-blue-100 text-blue-600 rounded hover:bg-blue-200 transition-colors"
                      >
                        Запросить
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {employees.length === 0 && (
            <p className="text-gray-500 text-sm">Нет сотрудников</p>
          )}

          <div className="mt-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-500">
            <p><span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1"></span> В рабочей зоне</p>
            <p><span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1"></span> Вне рабочей зоны</p>
            <p className="mt-1">Зелёная линия — маршрут в зоне</p>
            <p>Красная линия — маршрут вне зоны</p>
          </div>
        </div>

        {/* Map */}
        <div className="lg:col-span-2">
          <div className="rounded-lg overflow-hidden border border-gray-200" style={{ height: '600px' }}>
            <MapContainer
              center={defaultCenter}
              zoom={12}
              style={{ height: '100%', width: '100%' }}
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; OpenStreetMap'
              />

              {markerPositions.length > 0 && <FitBounds positions={markerPositions} />}

              {/* Employee zones */}
              {zones.map((zone) => (
                <Circle
                  key={zone.id}
                  center={[zone.latitude, zone.longitude]}
                  radius={zone.radius}
                  pathOptions={{ color: '#6366f1', fillColor: '#818cf8', fillOpacity: 0.1, weight: 1 }}
                />
              ))}

              {/* Employee markers */}
              {activeSessions.filter((s) => s.lastPoint).map((session) => {
                const isSelected = selectedEmployeeId === null || selectedEmployeeId === session.employeeId;
                if (!isSelected && selectedEmployeeId !== null) return null;

                const icon = session.zoneExitNotified ? warningIcon : employeeIcon;

                return (
                  <Marker
                    key={session.sessionId}
                    position={[session.lastPoint.latitude, session.lastPoint.longitude]}
                    icon={icon}
                    opacity={isSelected ? 1 : 0.4}
                  >
                    <Popup>
                      <div className="text-sm">
                        <p className="font-bold">{session.employeeName}</p>
                        <p>{session.zoneExitNotified ? '❌ Вне зоны' : '✅ В зоне'}</p>
                        <p>Обновлено: {_formatTime(session.lastUpdateAt)}</p>
                        <p>Длительность: {_formatDuration(session.startedAt)}</p>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}

              {/* Polylines for each session */}
              {activeSessions.map((session) => {
                if (selectedEmployeeId !== null && selectedEmployeeId !== session.employeeId) return null;
                const points = sessionPoints[session.sessionId];
                if (!points || points.length < 2) return null;

                const segments = _getPolylineSegments(points);
                return segments.map((seg, idx) => (
                  <Polyline
                    key={`${session.sessionId}-${idx}`}
                    positions={seg.points.map((p) => [p.latitude, p.longitude])}
                    pathOptions={{
                      color: seg.inZone ? '#22c55e' : '#ef4444',
                      weight: 3,
                      opacity: 0.8
                    }}
                  />
                ));
              })}
            </MapContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
