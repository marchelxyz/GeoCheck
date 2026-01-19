import { useState } from 'react';
import axios from 'axios';

export default function ZoneList({ zones, onZoneDeleted }) {
  const [deletingId, setDeletingId] = useState(null);

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
                    <p>
                      👤 Создано: {zone.createdByUser?.name || 'Неизвестно'}
                    </p>
                    <p>
                      📅 {new Date(zone.createdAt).toLocaleString('ru-RU')}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(zone.id)}
                  disabled={deletingId === zone.id}
                  className="ml-4 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 text-sm"
                >
                  {deletingId === zone.id ? 'Удаление...' : 'Удалить'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
