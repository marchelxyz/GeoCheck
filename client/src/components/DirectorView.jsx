import { useState, useEffect } from 'react';
import axios from 'axios';
import ZoneMap from './ZoneMap';
import ZoneList from './ZoneList';
import CheckInDashboard from './CheckInDashboard';

export default function DirectorView() {
  const [activeTab, setActiveTab] = useState('map');
  const [zones, setZones] = useState([]);
  const [checkIns, setCheckIns] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState({
    notificationsEnabled: true,
    weeklyZoneReminderEnabled: true
  });
  const [settingsLoading, setSettingsLoading] = useState(false);

  useEffect(() => {
    loadData();
    loadSettings();
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

  const loadSettings = async () => {
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const response = await axios.get('/api/director/settings', {
        headers: { 'x-telegram-init-data': initData }
      });
      setSettings(response.data);
    } catch (error) {
      console.error('Error loading settings:', error);
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

  const handleToggleCheckIns = async (employeeId) => {
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      
      const response = await axios.put(`/api/employees/${employeeId}/toggle-checkins`, 
        {},
        {
          headers: { 'x-telegram-init-data': initData }
        }
      );
      
      // Update local state
      setEmployees(employees.map(emp => 
        emp.id === employeeId 
          ? { ...emp, checkInsEnabled: response.data.checkInsEnabled }
          : emp
      ));
      
      const status = response.data.checkInsEnabled ? 'включены' : 'отключены';
      alert(`Ежедневные проверки для сотрудника ${status}`);
    } catch (error) {
      console.error('Error toggling check-ins:', error);
      alert(error.response?.data?.error || 'Ошибка изменения статуса проверок');
    }
  };

  const handleDeleteEmployee = async (employeeId) => {
    const employee = employees.find(emp => emp.id === employeeId);
    const employeeName = employee?.name || 'сотрудника';
    
    if (!confirm(`Вы уверены, что хотите удалить сотрудника "${employeeName}"? Это действие нельзя отменить.`)) {
      return;
    }

    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      
      await axios.delete(`/api/employees/${employeeId}`, {
        headers: { 'x-telegram-init-data': initData }
      });
      
      // Remove from local state
      setEmployees(employees.filter(emp => emp.id !== employeeId));
      alert(`Сотрудник "${employeeName}" успешно удален`);
    } catch (error) {
      console.error('Error deleting employee:', error);
      alert(error.response?.data?.error || 'Ошибка удаления сотрудника');
    }
  };

  const handleZoneCreated = (newZone) => {
    setZones([...zones, newZone]);
    loadData(); // Reload to get updated employee assignments
  };

  const handleZoneDeleted = (zoneId) => {
    setZones(zones.filter(z => z.id !== zoneId));
  };

  const handleToggleSetting = async (settingName) => {
    setSettingsLoading(true);
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const newValue = !settings[settingName];
      
      const response = await axios.put('/api/director/settings', 
        { [settingName]: newValue },
        {
          headers: { 'x-telegram-init-data': initData }
        }
      );
      
      setSettings(response.data);
      alert(`Настройка "${settingName === 'notificationsEnabled' ? 'Уведомления' : 'Еженедельное напоминание'}" ${newValue ? 'включена' : 'отключена'}`);
    } catch (error) {
      console.error('Error updating settings:', error);
      alert(error.response?.data?.error || 'Ошибка обновления настроек');
    } finally {
      setSettingsLoading(false);
    }
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
          <div className="flex space-x-1 overflow-x-auto">
            <button
              onClick={() => setActiveTab('map')}
              className={`px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === 'map'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              🗺️ Карта зон
            </button>
            <button
              onClick={() => setActiveTab('zones')}
              className={`px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === 'zones'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              📍 Список зон
            </button>
            <button
              onClick={() => setActiveTab('employees')}
              className={`px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === 'employees'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              👥 Сотрудники
            </button>
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === 'dashboard'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              📊 Проверки
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === 'settings'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              ⚙️ Настройки
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === 'map' && (
          <ZoneMap
            zones={zones}
            employees={employees}
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
                {employees.map((employee) => {
                  const employeeZones = zones.filter(zone => 
                    zone.employees?.some(ze => ze.user?.id === employee.id)
                  );
                  
                  return (
                    <div
                      key={employee.id}
                      className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-800">{employee.name}</p>
                          {employee.checkInsEnabled !== undefined && (
                            <span className={`px-2 py-1 text-xs font-medium rounded ${
                              employee.checkInsEnabled
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-600'
                            }`}>
                              {employee.checkInsEnabled ? '✓ Проверки включены' : '✗ Проверки отключены'}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500">
                          Зарегистрирован: {new Date(employee.createdAt).toLocaleDateString('ru-RU')}
                        </p>
                        {employeeZones.length > 0 && (
                          <p className="text-sm text-blue-600 mt-1">
                            Назначено зон: {employeeZones.length}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleToggleCheckIns(employee.id)}
                          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                            employee.checkInsEnabled
                              ? 'bg-yellow-600 hover:bg-yellow-700 text-white'
                              : 'bg-green-600 hover:bg-green-700 text-white'
                          }`}
                          title={employee.checkInsEnabled ? 'Отключить ежедневные проверки (отпуск и т.д.)' : 'Включить ежедневные проверки'}
                        >
                          {employee.checkInsEnabled ? '⏸ Отключить проверки' : '▶ Включить проверки'}
                        </button>
                        <button
                          onClick={() => handleRequestCheckIn(employee.id)}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          Отправить проверку
                        </button>
                        <button
                          onClick={() => handleDeleteEmployee(employee.id)}
                          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
                          title="Удалить сотрудника (уволен)"
                        >
                          🗑 Удалить
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {activeTab === 'dashboard' && (
          <CheckInDashboard checkIns={checkIns} />
        )}
        {activeTab === 'settings' && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-6">Настройки уведомлений</h2>
            
            <div className="space-y-6">
              {/* Уведомления о пропущенных чекингах и вне зоны */}
              <div className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">
                      🔔 Уведомления о чекингах
                    </h3>
                    <p className="text-sm text-gray-600">
                      Получать уведомления в Telegram, если сотрудник не отправил чекинг или находится вне рабочей зоны
                    </p>
                  </div>
                  <button
                    onClick={() => handleToggleSetting('notificationsEnabled')}
                    disabled={settingsLoading}
                    className={`ml-4 relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                      settings.notificationsEnabled ? 'bg-blue-600' : 'bg-gray-200'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        settings.notificationsEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
                <div className="mt-3 text-xs text-gray-500">
                  {settings.notificationsEnabled ? (
                    <span className="text-green-600">✓ Уведомления включены</span>
                  ) : (
                    <span className="text-gray-400">✗ Уведомления отключены</span>
                  )}
                </div>
              </div>

              {/* Еженедельное напоминание о зонах */}
              <div className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">
                      📅 Еженедельное напоминание о зонах
                    </h3>
                    <p className="text-sm text-gray-600">
                      Получать напоминание каждый понедельник в 9:00 о необходимости проставить зоны для командированных сотрудников
                    </p>
                  </div>
                  <button
                    onClick={() => handleToggleSetting('weeklyZoneReminderEnabled')}
                    disabled={settingsLoading}
                    className={`ml-4 relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                      settings.weeklyZoneReminderEnabled ? 'bg-blue-600' : 'bg-gray-200'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        settings.weeklyZoneReminderEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
                <div className="mt-3 text-xs text-gray-500">
                  {settings.weeklyZoneReminderEnabled ? (
                    <span className="text-green-600">✓ Напоминание включено</span>
                  ) : (
                    <span className="text-gray-400">✗ Напоминание отключено</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
