import { useState } from 'react';
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

function MapClickHandler({ onMapClick, disabled }) {
  useMapEvents({
    click: (e) => {
      if (!disabled) {
        onMapClick(e.latlng);
      }
    },
  });
  return null;
}

export default function ZoneMap({ zones, onZoneCreated, onZoneDeleted, employees = [] }) {
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [zoneName, setZoneName] = useState('');
  const [radius, setRadius] = useState(100);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState([]);
  const [isShared, setIsShared] = useState(false);
  const defaultCenter = [56.2965, 44.0020];
  const [center, setCenter] = useState(defaultCenter);

  const handleEmployeeSelect = (employee) => {
    setShowForm(false);
    setSelectedLocation(null);
    if (isShared) {
      setSelectedEmployeeIds((prev) => (
        prev.includes(employee.id)
          ? prev.filter((id) => id !== employee.id)
          : [...prev, employee.id]
      ));
      return;
    }
    setSelectedEmployeeIds([employee.id]);
  };

  const handleMapClick = (latlng) => {
    if (selectedEmployeeIds.length === 0) {
      alert('Пожалуйста, сначала выберите сотрудника из списка');
      return;
    }
    setSelectedLocation(latlng);
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedLocation || !zoneName.trim() || selectedEmployeeIds.length === 0) return;

    setSubmitting(true);
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const employeeIds = isShared ? selectedEmployeeIds : [selectedEmployeeIds[0]];
      const response = await axios.post(
        '/api/zones',
        {
          name: zoneName,
          latitude: selectedLocation.lat,
          longitude: selectedLocation.lng,
          radius: parseFloat(radius),
          isShared,
          employeeIds
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
      setSelectedEmployeeIds([]);
      if (isShared) {
        alert(`Общая зона "${zoneName}" создана для ${employeeIds.length} сотрудников`);
      } else {
        const selectedEmployee = employees.find((employee) => employee.id === employeeIds[0]);
        alert(`Зона "${zoneName}" создана и назначена сотруднику ${selectedEmployee?.name || ''}`);
      }
    } catch (error) {
      console.error('Error creating zone:', error);
      alert(error.response?.data?.error || 'Ошибка при создании зоны');
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

  const handleCancel = () => {
    setShowForm(false);
    setSelectedLocation(null);
    setSelectedEmployeeIds([]);
  };

  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeIds[0]);

  return (
    <div className="space-y-4">
      {/* Employee Selection Section */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold">Назначение зоны</h2>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={isShared}
              onChange={(event) => {
                setIsShared(event.target.checked);
                setSelectedEmployeeIds([]);
                setSelectedLocation(null);
                setShowForm(false);
              }}
            />
            Общая зона для нескольких сотрудников
          </label>
        </div>
        
        {employees.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">Нет зарегистрированных сотрудников</p>
            <p className="text-sm text-gray-400 mt-2">Сотрудники должны зарегистрироваться через веб-приложение</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {employees.map((employee) => {
              const employeeZones = zones.filter(zone => 
                zone.employees?.some(ze => ze.user?.id === employee.id)
              );
              const isSelected = selectedEmployeeIds.includes(employee.id);
              
              return (
                <button
                  key={employee.id}
                  onClick={() => handleEmployeeSelect(employee)}
                  className={`p-4 border-2 rounded-lg text-left transition-all ${
                    isSelected
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="font-medium text-gray-800">{employee.name}</p>
                      <p className="text-sm text-gray-500 mt-1">
                        Зон: {employeeZones.length}
                      </p>
                    </div>
                    {isSelected && (
                      <span className="text-blue-600 text-xl">✓</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {selectedEmployeeIds.length > 0 && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800">
              {isShared ? (
                <>
                  <strong>Выбрано сотрудников:</strong> {selectedEmployeeIds.length}
                </>
              ) : (
                <>
                  <strong>Выбран:</strong> {selectedEmployee?.name}
                </>
              )}
            </p>
            <p className="text-xs text-blue-600 mt-1">
              Нажмите на карту, чтобы выбрать местоположение зоны
            </p>
          </div>
        )}
      </div>

      {/* Zone Creation Form */}
      {showForm && selectedLocation && selectedEmployeeIds.length > 0 && (
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-lg font-semibold mb-4">
            {isShared ? 'Создание общей зоны' : `Создание зоны для ${selectedEmployee?.name || ''}`}
          </h3>
          
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
                placeholder={`Например: Зона для ${selectedEmployee.name}`}
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
                onClick={handleCancel}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Отмена
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Map */}
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
          
          <MapClickHandler 
            onMapClick={handleMapClick} 
            disabled={selectedEmployeeIds.length === 0}
          />
          
          {selectedLocation && (
            <Marker position={[selectedLocation.lat, selectedLocation.lng]} />
          )}
          
          {zones.map((zone) => {
            const zoneEmployees = zone.employees?.map(ze => ze.user?.name).filter(Boolean) || [];
            
            return (
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
            );
          })}
        </MapContainer>
      </div>

      {/* Zones List */}
      {zones.length > 0 && (
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="font-semibold mb-2">Активные зоны: {zones.length}</h3>
          <div className="space-y-2">
            {zones.map((zone) => {
              const zoneEmployees = zone.employees?.map(ze => ze.user?.name).filter(Boolean) || [];
              
              return (
                <div key={zone.id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{zone.name}</span>
                      {zone.isShared && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                          Общая
                        </span>
                      )}
                      <span className="text-sm text-gray-600">
                        Радиус: {zone.radius}м
                      </span>
                    </div>
                    {zoneEmployees.length > 0 && (
                      <p className="text-xs text-gray-500 mt-1">
                        Сотрудники: {zoneEmployees.join(', ')}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(zone.id)}
                    className="text-red-600 hover:text-red-800 text-sm ml-4"
                  >
                    Удалить
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
