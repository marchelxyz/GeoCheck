import { useState, useEffect } from 'react';
import axios from 'axios';
import ZoneMap from './ZoneMap';
import ZoneList from './ZoneList';
import CheckInDashboard from './CheckInDashboard';

export default function DirectorView() {
  const [activeTab, setActiveTab] = useState('map');
  const [zones, setZones] = useState([]);
  const [checkIns, setCheckIns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      
      const [zonesRes, checkInsRes] = await Promise.all([
        axios.get('/api/zones', {
          headers: { 'x-telegram-init-data': initData }
        }),
        axios.get('/api/check-ins', {
          headers: { 'x-telegram-init-data': initData }
        })
      ]);
      
      setZones(zonesRes.data);
      setCheckIns(checkInsRes.data);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
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
        {activeTab === 'dashboard' && (
          <CheckInDashboard checkIns={checkIns} />
        )}
      </div>
    </div>
  );
}
