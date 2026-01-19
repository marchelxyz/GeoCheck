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
  const [scheduleDrafts, setScheduleDrafts] = useState({});
  const [directorSettings, setDirectorSettings] = useState({
    notificationsEnabled: true,
    weeklyZoneReminderEnabled: true,
  });

  const weekDays = [
    { value: 1, label: 'Пн' },
    { value: 2, label: 'Вт' },
    { value: 3, label: 'Ср' },
    { value: 4, label: 'Чт' },
    { value: 5, label: 'Пт' },
    { value: 6, label: 'Сб' },
    { value: 0, label: 'Вс' }
  ];

  const parseWorkDays = (value) => {
    if (Array.isArray(value)) {
      return value
        .map((item) => Number(item))
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
    }
    if (typeof value === 'string') {
      const parsed = value
        .split(',')
        .map((item) => Number(item.trim()))
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
      return parsed.length ? parsed : [1, 2, 3, 4, 5];
    }
    return [1, 2, 3, 4, 5];
  };

  const minutesToTime = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  };

  const timeToMinutes = (value) => {
    const [hours, mins] = value.split(':').map(Number);
    if (!Number.isInteger(hours) || !Number.isInteger(mins)) {
      return 0;
    }
    return hours * 60 + mins;
  };

  useEffect(() => {
    loadData();
    loadDirectorSettings();
  }, []);

  useEffect(() => {
    const drafts = {};
    employees.forEach((employee) => {
      drafts[employee.id] = {
        workDays: parseWorkDays(employee.workDays),
        workStartMinutes: Number.isInteger(employee.workStartMinutes) ? employee.workStartMinutes : 540,
        workEndMinutes: Number.isInteger(employee.workEndMinutes) ? employee.workEndMinutes : 1080
      };
    });
    setScheduleDrafts(drafts);
  }, [employees]);

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

  const loadDirectorSettings = async () => {
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const response = await axios.get('/api/director/settings', {
        headers: { 'x-telegram-init-data': initData }
      });
      setDirectorSettings(response.data);
    } catch (error) {
      console.error('Error loading director settings:', error);
      // Fallback to default settings on error
      setDirectorSettings({
        notificationsEnabled: true,
        weeklyZoneReminderEnabled: true,
      });
    }
  };

  const handleToggleDirectorSetting = async (settingName) => {
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const newValue = !directorSettings[settingName];
      
      const response = await axios.put('/api/director/settings', 
        { [settingName]: newValue },
        {
          headers: { 'x-telegram-init-data': initData }
        }
      );
      
      setDirectorSettings(response.data);
      alert(`Настройка "${settingName}" успешно обновлена.`);
    } catch (error) {
      console.error(`Error toggling ${settingName}:`, error);
      alert(error.response?.data?.error || `Ошибка обновления настройки "${settingName}"`);
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

  const handleScheduleChange = (employeeId, changes) => {
    setScheduleDrafts((prev) => ({
      ...prev,
      [employeeId]: {
        ...prev[employeeId],
        ...changes
      }
    }));
  };

  const handleToggleWorkDay = (employeeId, dayValue) => {
    const currentDays = scheduleDrafts[employeeId]?.workDays || [];
    const nextDays = currentDays.includes(dayValue)
      ? currentDays.filter((day) => day !== dayValue)
      : [...currentDays, dayValue].sort((a, b) => a - b);
    handleScheduleChange(employeeId, { workDays: nextDays });
  };

  const handleSaveSchedule = async (employeeId) => {
    const schedule = scheduleDrafts[employeeId];
    if (!schedule) return;

    if (!schedule.workDays || schedule.workDays.length === 0) {
      alert('Выберите хотя бы один рабочий день');
      return;
    }
    if (schedule.workStartMinutes >= schedule.workEndMinutes) {
      alert('Начало рабочего времени должно быть раньше окончания');
      return;
    }

    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const response = await axios.put(
        `/api/employees/${employeeId}/work-schedule`,
        {
          workDays: schedule.workDays,
          workStartMinutes: schedule.workStartMinutes,
          workEndMinutes: schedule.workEndMinutes
        },
        {
          headers: { 'x-telegram-init-data': initData }
        }
      );

      setEmployees(employees.map((emp) =>
        emp.id === employeeId
          ? {
              ...emp,
              workDays: response.data.workDays,
              workStartMinutes: response.data.workStartMinutes,
              workEndMinutes: response.data.workEndMinutes
            }
          : emp
      ));
      alert('График работы обновлен');
    } catch (error) {
      console.error('Error updating work schedule:', error);
      alert(error.response?.data?.error || 'Ошибка обновления графика');
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
            <button
              onClick={() => setActiveTab('settings')}
              className={`px-4 py-3 text-sm font-medium transition-colors ${
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
                  const schedule = scheduleDrafts[employee.id] || {
                    workDays: parseWorkDays(employee.workDays),
                    workStartMinutes: employee.workStartMinutes || 540,
                    workEndMinutes: employee.workEndMinutes || 1080
                  };
                  
                  return (
                    <div
                      key={employee.id}
                      className="flex flex-col gap-4 p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
                    >
                      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
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
                        <div className="flex flex-wrap gap-2">
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

                      <div className="border-t border-gray-200 pt-4">
                        <h3 className="text-sm font-semibold text-gray-700 mb-2">Рабочий график</h3>
                        <div className="flex flex-wrap gap-2 mb-3">
                          {weekDays.map((day) => (
                            <button
                              key={`${employee.id}-${day.value}`}
                              onClick={() => handleToggleWorkDay(employee.id, day.value)}
                              className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                                schedule.workDays.includes(day.value)
                                  ? 'bg-blue-600 text-white border-blue-600'
                                  : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                              }`}
                            >
                              {day.label}
                            </button>
                          ))}
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <label className="text-sm text-gray-600">
                            Начало:
                            <input
                              type="time"
                              className="ml-2 rounded border border-gray-300 px-2 py-1 text-sm"
                              value={minutesToTime(schedule.workStartMinutes)}
                              onChange={(event) =>
                                handleScheduleChange(employee.id, {
                                  workStartMinutes: timeToMinutes(event.target.value)
                                })
                              }
                            />
                          </label>
                          <label className="text-sm text-gray-600">
                            Конец:
                            <input
                              type="time"
                              className="ml-2 rounded border border-gray-300 px-2 py-1 text-sm"
                              value={minutesToTime(schedule.workEndMinutes)}
                              onChange={(event) =>
                                handleScheduleChange(employee.id, {
                                  workEndMinutes: timeToMinutes(event.target.value)
                                })
                              }
                            />
                          </label>
                          <button
                            onClick={() => handleSaveSchedule(employee.id)}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
                          >
                            Сохранить график
                          </button>
                        </div>
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
            <h2 className="text-xl font-bold text-gray-800 mb-4">Настройки уведомлений директора</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                <div>
                  <p className="font-medium text-gray-800">Уведомления о чекингах</p>
                  <p className="text-sm text-gray-500">Получать уведомления, если сотрудник не отправил чекинг или находится вне зоны.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    value="" 
                    className="sr-only peer" 
                    checked={directorSettings.notificationsEnabled}
                    onChange={() => handleToggleDirectorSetting('notificationsEnabled')}
                  />
                  <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                </label>
              </div>
              <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                <div>
                  <p className="font-medium text-gray-800">Еженедельное напоминание о зонах</p>
                  <p className="text-sm text-gray-500">Получать напоминание каждый понедельник о необходимости проставить зоны для командированных сотрудников.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    value="" 
                    className="sr-only peer" 
                    checked={directorSettings.weeklyZoneReminderEnabled}
                    onChange={() => handleToggleDirectorSetting('weeklyZoneReminderEnabled')}
                  />
                  <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                </label>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}