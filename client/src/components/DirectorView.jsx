import { useState, useEffect } from 'react';
import axios from 'axios';
import ZoneMap from './ZoneMap';
import ZoneList from './ZoneList';
import CheckInDashboard from './CheckInDashboard';
import LiveTrackingMap from './LiveTrackingMap';
import TrackingHistory from './TrackingHistory';

export default function DirectorView() {
  const [activeTab, setActiveTab] = useState('map');
  const [zones, setZones] = useState([]);
  const [checkIns, setCheckIns] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scheduleDrafts, setScheduleDrafts] = useState({});
  const [displayNameDrafts, setDisplayNameDrafts] = useState({});
  const [dailyCheckInDrafts, setDailyCheckInDrafts] = useState({});
  const [scheduleEmployeeId, setScheduleEmployeeId] = useState('');
  const [scheduleDate, setScheduleDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [scheduleItems, setScheduleItems] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [directorSettings, setDirectorSettings] = useState({
    notificationsEnabled: true,
    weeklyZoneReminderEnabled: true,
    reportDeadlineMinutes: 5,
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
    const nameDrafts = {};
    const dailyDrafts = {};
    employees.forEach((employee) => {
      drafts[employee.id] = {
        workDays: parseWorkDays(employee.workDays),
        workStartMinutes: Number.isInteger(employee.workStartMinutes) ? employee.workStartMinutes : 540,
        workEndMinutes: Number.isInteger(employee.workEndMinutes) ? employee.workEndMinutes : 1080
      };
      nameDrafts[employee.id] = employee.displayName || '';
      const pendingTarget = Number.isInteger(employee.dailyCheckInTargetPending)
        ? employee.dailyCheckInTargetPending
        : null;
      dailyDrafts[employee.id] = pendingTarget ?? (
        Number.isInteger(employee.dailyCheckInTarget)
          ? employee.dailyCheckInTarget
          : 8
      );
    });
    setScheduleDrafts(drafts);
    setDisplayNameDrafts(nameDrafts);
    setDailyCheckInDrafts(dailyDrafts);
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
        reportDeadlineMinutes: 5,
      });
    }
  };

  const handleUpdateDirectorSetting = async (settingName, value) => {
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const response = await axios.put('/api/director/settings',
        { [settingName]: value },
        {
          headers: { 'x-telegram-init-data': initData }
        }
      );
      setDirectorSettings(response.data);
    } catch (error) {
      console.error(`Error updating ${settingName}:`, error);
      alert(error.response?.data?.error || `Ошибка обновления настройки "${settingName}"`);
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

  const handleToggleManualCameraStart = async (employeeId, currentValue) => {
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const response = await axios.put(
        `/api/employees/${employeeId}/camera-manual-start`,
        { cameraManualStartDisabled: !currentValue },
        {
          headers: { 'x-telegram-init-data': initData }
        }
      );

      setEmployees(employees.map(emp =>
        emp.id === employeeId
          ? { ...emp, cameraManualStartDisabled: response.data.cameraManualStartDisabled }
          : emp
      ));

      const status = response.data.cameraManualStartDisabled
        ? 'обычный режим'
        : 'ручной запуск камеры';
      alert(`Для сотрудника включен: ${status}`);
    } catch (error) {
      console.error('Error toggling manual camera start:', error);
      alert(error.response?.data?.error || 'Ошибка изменения настройки камеры');
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

  const handleDisplayNameChange = (employeeId, value) => {
    setDisplayNameDrafts((prev) => ({
      ...prev,
      [employeeId]: value
    }));
  };

  const handleSaveDisplayName = async (employeeId) => {
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const response = await axios.put(
        `/api/employees/${employeeId}/display-name`,
        { displayName: displayNameDrafts[employeeId] || '' },
        { headers: { 'x-telegram-init-data': initData } }
      );
      setEmployees(employees.map((emp) =>
        emp.id === employeeId ? { ...emp, displayName: response.data.displayName } : emp
      ));
    } catch (error) {
      console.error('Error updating display name:', error);
      alert(error.response?.data?.error || 'Ошибка обновления имени сотрудника');
    }
  };

  const handleDailyCheckInChange = (employeeId, value) => {
    setDailyCheckInDrafts((prev) => ({
      ...prev,
      [employeeId]: value
    }));
  };

  const handleSaveDailyCheckIns = async (employeeId) => {
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const response = await axios.put(
        `/api/employees/${employeeId}/daily-checkins`,
        { dailyCheckInTarget: Number(dailyCheckInDrafts[employeeId]) },
        { headers: { 'x-telegram-init-data': initData } }
      );
      setEmployees(employees.map((emp) =>
        emp.id === employeeId
          ? {
              ...emp,
              dailyCheckInTarget: response.data.dailyCheckInTarget,
              dailyCheckInTargetPending: response.data.dailyCheckInTargetPending,
              dailyCheckInTargetPendingFrom: response.data.dailyCheckInTargetPendingFrom
            }
          : emp
      ));
    } catch (error) {
      console.error('Error updating daily check-ins:', error);
      alert(error.response?.data?.error || 'Ошибка обновления количества проверок');
    }
  };

  const loadSchedule = async (employeeId, date) => {
    if (!employeeId) return;
    try {
      setScheduleLoading(true);
      const initData = window.Telegram?.WebApp?.initData || '';
      const response = await axios.get('/api/check-ins/schedule', {
        headers: { 'x-telegram-init-data': initData },
        params: {
          employeeId,
          date
        }
      });
      setScheduleItems(response.data.items || []);
    } catch (error) {
      console.error('Error loading schedule:', error);
      setScheduleItems([]);
    } finally {
      setScheduleLoading(false);
    }
  };

  useEffect(() => {
    if (scheduleEmployeeId) {
      loadSchedule(scheduleEmployeeId, scheduleDate);
    }
  }, [scheduleEmployeeId, scheduleDate]);

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
    const employeeName = employee?.displayName || employee?.name || 'сотрудника';
    
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
    setZones((prev) => [...prev, newZone]);
    loadData(); // Reload to get updated employee assignments
  };

  const handleZoneDeleted = (zoneId) => {
    setZones((prev) => prev.filter(z => z.id !== zoneId));
  };

  const handleZoneUpdated = (updatedZone) => {
    setZones((prev) => prev.map((zone) => (
      zone.id === updatedZone.id
        ? { ...zone, ...updatedZone }
        : zone
    )));
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
              onClick={() => setActiveTab('tracking')}
              className={`px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === 'tracking'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              📡 Трекинг
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
            <button
              onClick={() => setActiveTab('schedule')}
              className={`px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === 'schedule'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              📅 График проверок
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
        {activeTab === 'tracking' && (
          <LiveTrackingMap zones={zones} />
        )}
        {activeTab === 'zones' && (
          <ZoneList
            zones={zones}
            employees={employees}
            onZoneDeleted={handleZoneDeleted}
            onZoneUpdated={handleZoneUpdated}
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
                  const pendingDailyTarget = Number.isInteger(employee.dailyCheckInTargetPending)
                    ? employee.dailyCheckInTargetPending
                    : null;
                  const pendingDailyFrom = employee.dailyCheckInTargetPendingFrom
                    ? new Date(employee.dailyCheckInTargetPendingFrom)
                    : null;
                  
                  return (
                    <div
                      key={employee.id}
                      className="flex flex-col gap-4 p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
                    >
                      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-gray-800">
                              {employee.displayName || employee.name}
                            </p>
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
                          {employee.displayName && (
                            <p className="text-xs text-gray-500 mt-1">
                              Telegram: {employee.name}
                            </p>
                          )}
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
                          {employee.telegramId === '195698852' && (
                            <button
                              onClick={() => handleToggleManualCameraStart(
                                employee.id,
                                Boolean(employee.cameraManualStartDisabled)
                              )}
                              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                                employee.cameraManualStartDisabled
                                  ? 'bg-green-600 hover:bg-green-700 text-white'
                                  : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                              }`}
                              title={employee.cameraManualStartDisabled
                                ? 'Вернуть общий интерфейс камеры'
                                : 'Включить ручной запуск камеры'
                              }
                            >
                              {employee.cameraManualStartDisabled
                                ? '✅ Обычная камера'
                                : '🟦 Ручной старт камеры'
                              }
                            </button>
                          )}
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
                            onClick={() => setActiveTab(`history-${employee.id}`)}
                            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg transition-colors"
                            title="История маршрутов сотрудника"
                          >
                            📍 Маршруты
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
                        <div className="mb-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="text-sm font-semibold text-gray-700">
                              Имя для отображения
                            </label>
                            <span className="text-xs text-gray-500">
                              (только админка, Telegram не меняется)
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              className="flex-1 min-w-[200px] rounded border border-gray-300 px-2.5 py-1.5 text-sm"
                              placeholder="Например: Вадим (склад)"
                              value={displayNameDrafts[employee.id] || ''}
                              onChange={(event) => handleDisplayNameChange(employee.id, event.target.value)}
                            />
                            <button
                              onClick={() => handleSaveDisplayName(employee.id)}
                              className="px-3 py-1.5 border border-blue-600 text-blue-600 hover:bg-blue-50 text-sm font-medium rounded-md transition-colors"
                            >
                              Сохранить
                            </button>
                          </div>
                        </div>

                        <div className="mb-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="text-sm font-semibold text-gray-700">
                              Авто-проверок в день
                            </label>
                            <span className="text-xs text-gray-500">(по умолчанию 8)</span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <input
                              type="number"
                              min="0"
                              max="20"
                              className="w-24 rounded border border-gray-300 px-2.5 py-1.5 text-sm"
                              value={dailyCheckInDrafts[employee.id] ?? 8}
                              onChange={(event) => handleDailyCheckInChange(employee.id, event.target.value)}
                            />
                            <button
                              onClick={() => handleSaveDailyCheckIns(employee.id)}
                              className="px-3 py-1.5 border border-blue-600 text-blue-600 hover:bg-blue-50 text-sm font-medium rounded-md transition-colors"
                            >
                              Сохранить
                            </button>
                          </div>
                          {pendingDailyTarget !== null && pendingDailyFrom && (
                            <p className="mt-1 text-xs text-gray-500">
                              Сейчас действует: {employee.dailyCheckInTarget ?? 8}. Новое значение вступит с{' '}
                              {pendingDailyFrom.toLocaleDateString('ru-RU')}.
                            </p>
                          )}
                        </div>

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
            <h2 className="text-xl font-bold text-gray-800 mb-4">Настройки директора</h2>
            <div className="space-y-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-4 border border-gray-200 rounded-lg">
                <div>
                  <p className="font-medium text-gray-800">Дедлайн на отчет</p>
                  <p className="text-sm text-gray-500">Сколько минут у сотрудника на отправку гео и фото.</p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="120"
                    value={directorSettings.reportDeadlineMinutes ?? 5}
                    onChange={(event) => {
                      const nextValue = Number(event.target.value);
                      setDirectorSettings((prev) => ({
                        ...prev,
                        reportDeadlineMinutes: nextValue
                      }));
                    }}
                    className="w-24 rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                  <button
                    onClick={() => handleUpdateDirectorSetting('reportDeadlineMinutes', directorSettings.reportDeadlineMinutes)}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    Сохранить
                  </button>
                </div>
              </div>
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
        {activeTab === 'schedule' && (
          <div className="bg-white rounded-lg shadow-sm p-6 space-y-4">
            <h2 className="text-xl font-bold text-gray-800">График проверок</h2>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Сотрудник</label>
                <select
                  value={scheduleEmployeeId}
                  onChange={(event) => setScheduleEmployeeId(event.target.value)}
                  className="rounded border border-gray-300 px-3 py-2 text-sm min-w-[220px]"
                >
                  <option value="">Выберите сотрудника</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.displayName || employee.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Дата</label>
                <input
                  type="date"
                  value={scheduleDate}
                  onChange={(event) => setScheduleDate(event.target.value)}
                  className="rounded border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <button
                onClick={() => loadSchedule(scheduleEmployeeId, scheduleDate)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
                disabled={!scheduleEmployeeId || scheduleLoading}
              >
                {scheduleLoading ? 'Загрузка...' : 'Обновить'}
              </button>
            </div>
            <div className="mt-4">
              {scheduleLoading ? (
                <div className="text-sm text-gray-500">Загрузка расписания...</div>
              ) : scheduleEmployeeId ? (
                scheduleItems.length === 0 ? (
                  <div className="text-sm text-gray-500">Нет запланированных проверок на выбранную дату</div>
                ) : (
                  <div className="space-y-2">
                    {scheduleItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between rounded border border-gray-200 px-3 py-2 text-sm"
                      >
                        <span>{item.scheduledAtLocal || new Date(item.scheduledAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                        <span className={`text-xs font-medium ${
                          item.status === 'SENT'
                            ? 'text-green-600'
                            : item.status === 'SKIPPED'
                              ? 'text-gray-500'
                              : 'text-blue-600'
                        }`}>
                          {item.status === 'SENT'
                            ? 'Отправлено'
                            : item.status === 'SKIPPED'
                              ? 'Пропущено'
                              : 'Ожидает'}
                        </span>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <div className="text-sm text-gray-500">Выберите сотрудника для просмотра графика</div>
              )}
            </div>
            <p className="text-xs text-gray-500">
              График формируется ежедневно в 02:00 (МСК). Возможны пропуски при истекшем окне или отключенных проверках.
            </p>
          </div>
        )}
        {activeTab.startsWith('history-') && (() => {
          const employeeId = activeTab.replace('history-', '');
          const employee = employees.find((e) => e.id === employeeId);
          return (
            <div>
              <button
                onClick={() => setActiveTab('employees')}
                className="mb-4 text-sm text-blue-600 hover:text-blue-800"
              >
                ← Назад к сотрудникам
              </button>
              <TrackingHistory
                employeeId={employeeId}
                employeeName={employee?.displayName || employee?.name || 'Сотрудник'}
                zones={zones}
              />
            </div>
          );
        })()}
      </div>
    </div>
  );
}