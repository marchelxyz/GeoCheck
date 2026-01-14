import { useState, useEffect } from 'react';
import axios from 'axios';
import ZoneMap from './ZoneMap';
import ZoneList from './ZoneList';
import CheckInDashboard from './CheckInDashboard';
import EmployeeLocationMap from './EmployeeLocationMap';

export default function DirectorView() {
  const [activeTab, setActiveTab] = useState('map');
  const [zones, setZones] = useState([]);
  const [checkIns, setCheckIns] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEmployeeForLocation, setSelectedEmployeeForLocation] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      
      const [zonesRes, checkInsRes, employeesRes] = await Promise.all([
        axios.get('/api/zones', {
          headers: { 'x-telegram-init-data': initData }
        }),
        axios.get('/api/check-ins', {
          headers: { 'x-telegram-init-data': initData }
        }),
        axios.get('/api/employees', {
          headers: { 'x-telegram-init-data': initData }
        }).catch(() => ({ data: [] }))
      ]);
      
      setZones(zonesRes.data);
      setCheckIns(checkInsRes.data);
      setEmployees(employeesRes.data || []);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestCheckIn = async (employeeId) => {
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      
      await axios.post('/api/check-ins/request', 
        { employeeId },
        {
          headers: { 'x-telegram-init-data': initData }
        }
      );
      
      alert('Запрос на проверку отправлен сотруднику');
      loadData();
    } catch (error) {
      console.error('Error requesting check-in:', error);
      alert(error.response?.data?.error || 'Ошибка отправки запроса');
    }
  };

  const handleAddLocationClick = (employee) => {
    setSelectedEmployeeForLocation(employee);
  };

  const handleLocationSelected = async (location) => {
    if (!selectedEmployeeForLocation) return;

    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      
      const response = await axios.post(
        `/api/employees/${selectedEmployeeForLocation.id}/location`,
        {
          latitude: location.latitude,
          longitude: location.longitude
        },
        {
          headers: { 'x-telegram-init-data': initData }
        }
      );

      const status = response.data.isWithinZone 
        ? '✅ Геолокация добавлена! Сотрудник в рабочей зоне.' 
        : `❌ Геолокация добавлена! Сотрудник вне рабочей зоны (${Math.round(response.data.distanceToZone || 0)}м от ближайшей зоны)`;
      
      alert(status);
      setSelectedEmployeeForLocation(null);
      loadData();
    } catch (error) {
      console.error('Error adding location:', error);
      alert(error.response?.data?.error || 'Ошибка добавления геолокации');
      throw error;
    }
  };

  const handleCancelLocationSelection = () => {
    setSelectedEmployeeForLocation(null);
  };

  const handleZoneCreated = (newZone) => {
    setZones([...zones, newZone]);
  };

  const handleZoneDeleted = (zoneId) => {
    setZones(zones.filter(z => z.id !== zoneId));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600">Загрузка...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-gray-800">GeoCheck</h1>
          <p className="text-sm text-gray-600">Панель управления директора</p>
        </div>
      </div>

      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex space-x-1">
            <button
              onClick={() => setActiveTab('map')}
              className={`px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === 'map'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              🗺️ Карта зон
            </button>
            <button
              onClick={() => setActiveTab('zones')}
              className={`px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === 'zones'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              📍 Список зон
            </button>
            <button
              onClick={() => setActiveTab('employees')}
              className={`px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === 'employees'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              👥 Сотрудники
            </button>
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === 'dashboard'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              📊 Проверки
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === 'map' && (
          <ZoneMap
            zones={zones}
            onZoneCreated={handleZoneCreated}
            onZoneDeleted={handleZoneDeleted}
          />
        )}
        {activeTab === 'zones' && (
          <ZoneList
            zones={zones}
            onZoneDeleted={handleZoneDeleted}
          />
        )}
        {activeTab === 'employees' && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Список сотрудников</h2>
            
            {employees.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500">Нет зарегистрированных сотрудников</p>
                <p className="text-sm text-gray-400 mt-2">Сотрудники должны зарегистрироваться через веб-приложение</p>
              </div>
            ) : (
              <div className="space-y-3">
                {employees.map((employee) => (
                  <div
                    key={employee.id}
                    className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
                  >
                    <div>
                      <p className="font-medium text-gray-800">{employee.name}</p>
                      <p className="text-sm text-gray-500">
                        Зарегистрирован: {new Date(employee.createdAt).toLocaleDateString('ru-RU')}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAddLocationClick(employee)}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        📍 Добавить ГЕО
                      </button>
                      <button
                        onClick={() => handleRequestCheckIn(employee.id)}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        Отправить проверку
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {activeTab === 'dashboard' && (
          <CheckInDashboard checkIns={checkIns} />
        )}
      </div>

      {selectedEmployeeForLocation && (
        <EmployeeLocationMap
          employeeName={selectedEmployeeForLocation.name}
          onLocationSelected={handleLocationSelected}
          onCancel={handleCancelLocationSelection}
        />
      )}
    </div>
  );
}
