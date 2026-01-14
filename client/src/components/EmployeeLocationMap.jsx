import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
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

export default function EmployeeLocationMap({ employeeName, onLocationSelected, onCancel }) {
  const [selectedLocation, setSelectedLocation] = useState(null);
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
  };

  const handleConfirm = async () => {
    if (!selectedLocation) {
      alert('Пожалуйста, выберите местоположение на карте');
      return;
    }

    setSubmitting(true);
    try {
      await onLocationSelected({
        latitude: selectedLocation.lat,
        longitude: selectedLocation.lng
      });
    } catch (error) {
      console.error('Error saving location:', error);
      alert('Ошибка при сохранении местоположения');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        <div className="p-4 border-b">
          <h2 className="text-xl font-bold text-gray-800">
            Выбор местоположения для сотрудника: {employeeName}
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Нажмите на карту, чтобы выбрать местоположение, в котором должен находиться сотрудник
          </p>
        </div>

        <div className="flex-1 relative" style={{ minHeight: '400px' }}>
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
          </MapContainer>
        </div>

        {selectedLocation && (
          <div className="p-4 bg-gray-50 border-t">
            <p className="text-sm text-gray-700 mb-2">
              Выбрано местоположение:
            </p>
            <p className="text-xs text-gray-600 font-mono">
              Широта: {selectedLocation.lat.toFixed(6)}, Долгота: {selectedLocation.lng.toFixed(6)}
            </p>
          </div>
        )}

        <div className="p-4 border-t flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 text-gray-700"
            disabled={submitting}
          >
            Отмена
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedLocation || submitting}
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Сохранение...' : 'Сохранить местоположение'}
          </button>
        </div>
      </div>
    </div>
  );
}
