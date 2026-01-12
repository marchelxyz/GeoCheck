import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Circle, useMapEvents } from 'react-leaflet';
import axios from 'axios';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

function MapClickHandler({ onMapClick }) {
  useMapEvents({
    click: (e) => {
      onMapClick(e.latlng);
    }
  });
  return null;
}

export default function ZoneMap({ zones, onZoneCreated, onZoneDeleted }) {
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [zoneName, setZoneName] = useState('');
  const [radius, setRadius] = useState(100);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const defaultCenter = [55.7558, 37.6173];
  const [center, setCenter] = useState(defaultCenter);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCenter([position.coords.latitude, position.coords.longitude]);
        },
        () => {}
      );
    }
  }, []);

  const handleMapClick = (latlng) => {
    setSelectedLocation(latlng);
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedLocation || !zoneName.trim()) return;

    setSubmitting(true);
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const response = await axios.post(
        '/api/zones',
        {
          name: zoneName,
          latitude: selectedLocation.lat,
          longitude: selectedLocation.lng,
          radius: parseFloat(radius)
        },
        {
          headers: { 'x-telegram-init-data': initData }
        }
      );

      onZoneCreated(response.data);
      setSelectedLocation(null);
      setZoneName('');
      setRadius(100);
      setShowForm(false);
    } catch (error) {
      console.error('Error creating zone:', error);
      alert('Ошибка при создании зоны');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (zoneId) => {
    if (!confirm('Удалить эту зону?')) return;
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      await axios.delete(`/api/zones/${zoneId}`, {
        headers: { 'x-telegram-init-data': initData }
      });
      onZoneDeleted(zoneId);
    } catch (error) {
      console.error('Error deleting zone:', error);
      alert('Ошибка при удалении зоны');
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-semibold mb-2">Создание рабочей зоны</h2>
        <p className="text-sm text-gray-600 mb-4">
          Нажмите на карту, чтобы выбрать местоположение зоны
        </p>

        {showForm && selectedLocation && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Название зоны
              </label>
              <input
                type="text"
                value={zoneName}
                onChange={(e) => setZoneName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Например: Офис"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Радиус (метры)
              </label>
              <input
                type="number"
                value={radius}
                onChange={(e) => setRadius(e.target.value)}
                min="10"
                max="5000"
                step="10"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div className="flex space-x-2">
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? 'Создание...' : 'Создать зону'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setSelectedLocation(null);
                }}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Отмена
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden" style={{ height: '500px' }}>
        <MapContainer
          center={center}
          zoom={13}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          
          <MapClickHandler onMapClick={handleMapClick} />
          
          {selectedLocation && (
            <Marker position={[selectedLocation.lat, selectedLocation.lng]} />
          )}
          
          {zones.map((zone) => (
            <div key={zone.id}>
              <Marker
                position={[zone.latitude, zone.longitude]}
                eventHandlers={{
                  click: () => {
                    if (confirm(`Удалить зону "${zone.name}"?`)) {
                      handleDelete(zone.id);
                    }
                  }
                }}
              />
              <Circle
                center={[zone.latitude, zone.longitude]}
                radius={zone.radius}
                pathOptions={{
                  color: '#3b82f6',
                  fillColor: '#3b82f6',
                  fillOpacity: 0.2
                }}
              />
            </div>
          ))}
        </MapContainer>
      </div>

      {zones.length > 0 && (
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="font-semibold mb-2">Активные зоны: {zones.length}</h3>
          <div className="space-y-2">
            {zones.map((zone) => (
              <div key={zone.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                <div>
                  <span className="font-medium">{zone.name}</span>
                  <span className="text-sm text-gray-600 ml-2">
                    Радиус: {zone.radius}м
                  </span>
                </div>
                <button
                  onClick={() => handleDelete(zone.id)}
                  className="text-red-600 hover:text-red-800 text-sm"
                >
                  Удалить
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
