import { useEffect, useState } from 'react';
import axios from 'axios';

export default function ZoneList({ zones, employees = [], onZoneDeleted, onZoneUpdated }) {
  const [deletingId, setDeletingId] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [radiusDrafts, setRadiusDrafts] = useState({});
  const [savingEmployeesId, setSavingEmployeesId] = useState(null);
  const [employeeDrafts, setEmployeeDrafts] = useState({});

  useEffect(() => {
    setRadiusDrafts((prev) => {
      const next = {};
      zones.forEach((zone) => {
        const current = prev[zone.id];
        next[zone.id] = current !== undefined ? current : String(zone.radius);
      });
      return next;
    });
  }, [zones]);

  useEffect(() => {
    setEmployeeDrafts((prev) => {
      const next = {};
      zones.forEach((zone) => {
        const current = prev[zone.id];
        if (Array.isArray(current)) {
          next[zone.id] = current;
          return;
        }
        const assigned = zone.employees?.map((ze) => ze.user?.id).filter(Boolean) || [];
        next[zone.id] = assigned;
      });
      return next;
    });
  }, [zones]);

  const handleDelete = async (zoneId) => {
    if (!confirm('Удалить эту зону?')) return;
    setDeletingId(zoneId);
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      await axios.delete(`/api/zones/${zoneId}`, {
        headers: { 'x-telegram-init-data': initData }
      });
      onZoneDeleted(zoneId);
    } catch (error) {
      console.error('Error deleting zone:', error);
      alert('Ошибка при удалении зоны');
    } finally {
      setDeletingId(null);
    }
  };

  const handleRadiusChange = (zoneId, value) => {
    setRadiusDrafts((prev) => ({
      ...prev,
      [zoneId]: value
    }));
  };

  const handleSaveRadius = async (zone) => {
    const draftValue = radiusDrafts[zone.id];
    const parsed = Number(draftValue);
    if (!Number.isFinite(parsed) || parsed < 10 || parsed > 5000) {
      alert('Радиус должен быть числом от 10 до 5000 метров.');
      return;
    }
    if (parsed === zone.radius) {
      return;
    }

    setSavingId(zone.id);
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const response = await axios.put(
        `/api/zones/${zone.id}/radius`,
        { radius: parsed },
        {
          headers: { 'x-telegram-init-data': initData }
        }
      );
      onZoneUpdated?.(response.data);
      setRadiusDrafts((prev) => ({
        ...prev,
        [zone.id]: String(response.data.radius)
      }));
    } catch (error) {
      console.error('Error updating zone radius:', error);
      alert(error.response?.data?.error || 'Ошибка при обновлении радиуса зоны');
    } finally {
      setSavingId(null);
    }
  };

  const handleToggleZoneEmployee = (zoneId, employeeId) => {
    setEmployeeDrafts((prev) => {
      const current = prev[zoneId] || [];
      const exists = current.includes(employeeId);
      return {
        ...prev,
        [zoneId]: exists
          ? current.filter((id) => id !== employeeId)
          : [...current, employeeId]
      };
    });
  };

  const handleSaveZoneEmployees = async (zone) => {
    const selected = employeeDrafts[zone.id] || [];
    if (selected.length === 0) {
      alert('Выберите хотя бы одного сотрудника для общей зоны.');
      return;
    }
    setSavingEmployeesId(zone.id);
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const response = await axios.put(
        `/api/zones/${zone.id}/employees`,
        { employeeIds: selected },
        {
          headers: { 'x-telegram-init-data': initData }
        }
      );
      onZoneUpdated?.(response.data);
      const refreshed = response.data.employees?.map((ze) => ze.user?.id).filter(Boolean) || [];
      setEmployeeDrafts((prev) => ({
        ...prev,
        [zone.id]: refreshed
      }));
    } catch (error) {
      console.error('Error updating zone employees:', error);
      alert(error.response?.data?.error || 'Ошибка при обновлении сотрудников зоны');
    } finally {
      setSavingEmployeesId(null);
    }
  };

  if (zones.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <p className="text-gray-500">Нет созданных зон</p>
        <p className="text-sm text-gray-400 mt-2">
          Перейдите на вкладку "Карта зон" для создания новой зоны
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-semibold mb-4">
          Список рабочих зон ({zones.length})
        </h2>

        <div className="space-y-3">
          {zones.map((zone) => (
            <div
              key={zone.id}
              className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold text-lg text-gray-800">
                    {zone.name}
                  </h3>
                  <div className="mt-2 space-y-1 text-sm text-gray-600">
                    <p>
                      🧩 Тип: {zone.isShared ? 'Общая (несколько сотрудников)' : 'Индивидуальная'}
                    </p>
                    <p>
                      📍 Координаты: {zone.latitude.toFixed(6)}, {zone.longitude.toFixed(6)}
                    </p>
                    <p>
                      📏 Радиус: {zone.radius} метров
                    </p>
                    {zone.isShared && (
                      <p>
                        👥 Сотрудников в зоне: {zone.employees?.length || 0}
                      </p>
                    )}
                    <p>
                      👤 Создано: {zone.createdByUser?.name || 'Неизвестно'}
                    </p>
                    <p>
                      📅 {new Date(zone.createdAt).toLocaleString('ru-RU')}
                    </p>
                  </div>
                </div>
                <div className="ml-4 flex flex-col items-end gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="10"
                      max="5000"
                      step="10"
                      value={radiusDrafts[zone.id] ?? ''}
                      onChange={(event) => handleRadiusChange(zone.id, event.target.value)}
                      className="w-28 px-2 py-1 border border-gray-300 rounded-md text-sm"
                      aria-label={`Радиус зоны ${zone.name}`}
                    />
                    <button
                      onClick={() => handleSaveRadius(zone)}
                      disabled={savingId === zone.id || deletingId === zone.id || savingEmployeesId === zone.id}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm"
                    >
                      {savingId === zone.id ? 'Сохранение...' : 'Сохранить'}
                    </button>
                  </div>
                  <button
                    onClick={() => handleDelete(zone.id)}
                    disabled={deletingId === zone.id || savingId === zone.id || savingEmployeesId === zone.id}
                    className="px-4 py-1.5 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 text-sm"
                  >
                    {deletingId === zone.id ? 'Удаление...' : 'Удалить'}
                  </button>
                </div>
              </div>
              {zone.isShared && (
                <div className="mt-4 border-t border-gray-200 pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-gray-700">
                      Сотрудники в общей зоне
                    </p>
                    <button
                      onClick={() => handleSaveZoneEmployees(zone)}
                      disabled={savingEmployeesId === zone.id || deletingId === zone.id || savingId === zone.id}
                      className="px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 text-sm"
                    >
                      {savingEmployeesId === zone.id ? 'Сохранение...' : 'Сохранить сотрудников'}
                    </button>
                  </div>
                  {employees.length === 0 ? (
                    <p className="text-xs text-gray-500">Нет доступных сотрудников</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {employees.map((employee) => {
                        const label = employee.displayName || employee.name;
                        const selected = employeeDrafts[zone.id]?.includes(employee.id);
                        return (
                          <label
                            key={`${zone.id}-${employee.id}`}
                            className={`flex items-center gap-2 px-2 py-1 border rounded text-sm cursor-pointer ${
                              selected
                                ? 'border-indigo-500 bg-indigo-50'
                                : 'border-gray-200'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(selected)}
                              onChange={() => handleToggleZoneEmployee(zone.id, employee.id)}
                            />
                            <span className="text-gray-700">{label}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
