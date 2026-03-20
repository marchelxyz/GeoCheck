import { useState, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, Polyline, Circle, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';

const startIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const endIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const STATUS_LABELS = {
  ACTIVE: 'Активна',
  STOPPED: 'Остановлена',
  EXPIRED: 'Истекла',
  COMPLETED: 'Завершена'
};

const STATUS_COLORS = {
  ACTIVE: 'text-green-600 bg-green-50',
  STOPPED: 'text-yellow-600 bg-yellow-50',
  EXPIRED: 'text-orange-600 bg-orange-50',
  COMPLETED: 'text-blue-600 bg-blue-50'
};

/**
 * Displays tracking history (daily movement trails) for a given employee.
 */
export default function TrackingHistory({ employeeId, employeeName, zones = [] }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState(null);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const defaultCenter = [56.2965, 44.0020];

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const initData = window.Telegram?.WebApp?.initData || null;
      const headers = initData ? { 'x-telegram-init-data': initData } : {};
      const res = await axios.get(`/api/tracking/history/${employeeId}`, {
        headers,
        params: { startDate, endDate }
      });
      setSessions(res.data);
      if (res.data.length > 0 && !selectedSession) {
        setSelectedSession(res.data[0]);
      }
    } catch (error) {
      console.error('Failed to fetch tracking history:', error);
    } finally {
      setLoading(false);
    }
  }, [employeeId, startDate, endDate]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  function _formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
  }

  function _formatTime(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  function _formatDistance(meters) {
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)} км`;
    return `${meters} м`;
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

  function _getDuration(start, end) {
    if (!start) return '—';
    const endTime = end ? new Date(end).getTime() : Date.now();
    const diffMs = endTime - new Date(start).getTime();
    const hours = Math.floor(diffMs / 3600000);
    const minutes = Math.floor((diffMs % 3600000) / 60000);
    return `${hours}ч ${minutes}мин`;
  }

  function _getMapCenter(points) {
    if (!points || points.length === 0) return defaultCenter;
    const lats = points.map((p) => p.latitude);
    const lons = points.map((p) => p.longitude);
    return [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lons) + Math.max(...lons)) / 2];
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-xl font-bold text-gray-800 mb-4">
          Маршруты — {employeeName}
        </h2>

        <div className="flex flex-wrap items-end gap-4 mb-6">
          <div>
            <label className="block text-sm text-gray-600 mb-1">С</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">По</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={fetchHistory}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            disabled={loading}
          >
            {loading ? 'Загрузка...' : 'Обновить'}
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-gray-500 text-sm">Нет данных за выбранный период</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-1 space-y-2 max-h-[600px] overflow-y-auto">
              {sessions.map((session) => {
                const isSelected = selectedSession?.sessionId === session.sessionId;
                const inZonePct = session.totalPoints > 0
                  ? Math.round((session.inZonePoints / session.totalPoints) * 100)
                  : 0;

                return (
                  <div
                    key={session.sessionId}
                    onClick={() => setSelectedSession(session)}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm text-gray-800">
                        {_formatDate(session.startedAt)}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[session.status] || 'text-gray-600 bg-gray-50'}`}>
                        {STATUS_LABELS[session.status] || session.status}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 space-y-0.5">
                      <p>{_formatTime(session.startedAt)} — {_formatTime(session.endedAt)}</p>
                      <p>Длительность: {_getDuration(session.startedAt, session.endedAt)}</p>
                      <p>Расстояние: {_formatDistance(session.totalDistanceM)}</p>
                      <p>Точек: {session.totalPoints}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-green-500 h-2 rounded-full"
                            style={{ width: `${inZonePct}%` }}
                          ></div>
                        </div>
                        <span className="text-xs">{inZonePct}% в зоне</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="lg:col-span-2">
              {selectedSession && selectedSession.points.length > 0 ? (
                <div className="rounded-lg overflow-hidden border border-gray-200" style={{ height: '600px' }}>
                  <MapContainer
                    key={selectedSession.sessionId}
                    center={_getMapCenter(selectedSession.points)}
                    zoom={14}
                    style={{ height: '100%', width: '100%' }}
                  >
                    <TileLayer
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      attribution='&copy; OpenStreetMap'
                    />

                    {zones.map((zone) => (
                      <Circle
                        key={zone.id}
                        center={[zone.latitude, zone.longitude]}
                        radius={zone.radius}
                        pathOptions={{ color: '#6366f1', fillColor: '#818cf8', fillOpacity: 0.1, weight: 1 }}
                      />
                    ))}

                    {_getPolylineSegments(selectedSession.points).map((seg, idx) => (
                      <Polyline
                        key={idx}
                        positions={seg.points.map((p) => [p.latitude, p.longitude])}
                        pathOptions={{
                          color: seg.inZone ? '#22c55e' : '#ef4444',
                          weight: 3,
                          opacity: 0.8
                        }}
                      />
                    ))}

                    {selectedSession.points.length > 0 && (
                      <>
                        <Marker
                          position={[selectedSession.points[0].latitude, selectedSession.points[0].longitude]}
                          icon={startIcon}
                        >
                          <Popup>Начало: {_formatTime(selectedSession.points[0].timestamp)}</Popup>
                        </Marker>
                        <Marker
                          position={[
                            selectedSession.points[selectedSession.points.length - 1].latitude,
                            selectedSession.points[selectedSession.points.length - 1].longitude
                          ]}
                          icon={endIcon}
                        >
                          <Popup>Конец: {_formatTime(selectedSession.points[selectedSession.points.length - 1].timestamp)}</Popup>
                        </Marker>
                      </>
                    )}
                  </MapContainer>
                </div>
              ) : (
                <div className="flex items-center justify-center h-[600px] bg-gray-50 rounded-lg border border-gray-200">
                  <p className="text-gray-500">Выберите сессию для просмотра маршрута</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
