import { useState, useEffect } from 'react';
import axios from 'axios';

export default function CheckInDashboard({ checkIns: initialCheckIns }) {
  const [checkIns, setCheckIns] = useState(initialCheckIns || []);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setCheckIns(initialCheckIns || []);
  }, [initialCheckIns]);

  const filteredCheckIns = checkIns.filter(checkIn => {
    const result = checkIn.result;
    if (!result) return filter === 'all';
    
    if (filter === 'success') return result.isWithinZone === true;
    if (filter === 'failed') return result.isWithinZone === false;
    return true;
  });

  const formatDistance = (distance) => {
    if (distance === null || distance === undefined) return 'N/A';
    if (distance < 1000) return `${Math.round(distance)}м`;
    return `${(distance / 1000).toFixed(2)}км`;
  };

  const getPhotoUrl = async (requestId) => {
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const response = await axios.get(`/api/check-ins/${requestId}/photo`, {
        headers: { 'x-telegram-init-data': initData }
      });
      return response.data.url || response.data.fileId || null;
    } catch (error) {
      console.error('Error getting photo URL:', error);
      return null;
    }
  };

  const successfulCount = checkIns.filter(c => c.result?.isWithinZone === true).length;
  const failedCount = checkIns.filter(c => c.result?.isWithinZone === false).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">Всего проверок</div>
          <div className="text-2xl font-bold text-gray-800">{checkIns.length}</div>
        </div>
        <div className="bg-green-50 rounded-lg shadow p-4">
          <div className="text-sm text-green-600">Успешных</div>
          <div className="text-2xl font-bold text-green-700">
            {successfulCount}
          </div>
        </div>
        <div className="bg-red-50 rounded-lg shadow p-4">
          <div className="text-sm text-red-600">Неудачных</div>
          <div className="text-2xl font-bold text-red-700">
            {failedCount}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex space-x-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-md text-sm font-medium ${
              filter === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Все
          </button>
          <button
            onClick={() => setFilter('success')}
            className={`px-4 py-2 rounded-md text-sm font-medium ${
              filter === 'success'
                ? 'bg-green-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            ✅ Успешные
          </button>
          <button
            onClick={() => setFilter('failed')}
            className={`px-4 py-2 rounded-md text-sm font-medium ${
              filter === 'failed'
                ? 'bg-red-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            ❌ Неудачные
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        {filteredCheckIns.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            Нет записей о проверках
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {filteredCheckIns.map((checkIn) => {
              const result = checkIn.result;
              const user = checkIn.user;
              
              if (!result || !user) {
                return (
                  <div key={checkIn.id} className="p-4">
                    <p className="text-sm text-gray-500">
                      Проверка #{checkIn.id} - данные загружаются...
                    </p>
                  </div>
                );
              }

              const isWithinZone = result.isWithinZone === true;
              
              return (
                <div key={checkIn.id} className="p-4 hover:bg-gray-50">
                  <div className="flex items-start space-x-4">
                    <div className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${
                      isWithinZone ? 'bg-green-100' : 'bg-red-100'
                    }`}>
                      {isWithinZone ? (
                        <span className="text-2xl">✅</span>
                      ) : (
                        <span className="text-2xl">❌</span>
                      )}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-gray-800">
                          {user.name}
                        </h3>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          isWithinZone
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {isWithinZone ? 'В зоне' : 'Вне зоны'}
                        </span>
                      </div>
                      
                      <div className="mt-2 space-y-1 text-sm text-gray-600">
                        {result.locationLat && result.locationLon && (
                          <p>
                            📍 Координаты: {result.locationLat.toFixed(6)}, {result.locationLon.toFixed(6)}
                          </p>
                        )}
                        {result.distanceToZone !== null && result.distanceToZone !== undefined && (
                          <p>
                            📏 Расстояние до зоны: {formatDistance(result.distanceToZone)}
                          </p>
                        )}
                        <p>
                          🕐 {new Date(checkIn.requestedAt).toLocaleString('ru-RU')}
                        </p>
                        <p>
                          Статус: {checkIn.status === 'COMPLETED' ? '✅ Завершена' : checkIn.status === 'PENDING' ? '⏳ Ожидает' : checkIn.status === 'MISSED' ? '❌ Пропущена' : checkIn.status}
                        </p>
                      </div>
                      
                      {(result.photoPath || result.photoFileId) && (
                        <div className="mt-3">
                          <PhotoDisplay requestId={checkIn.id} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function PhotoDisplay({ requestId }) {
  const [photoUrl, setPhotoUrl] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadPhoto = async () => {
      try {
        const initData = window.Telegram?.WebApp?.initData || '';
        const response = await axios.get(`/api/check-ins/${requestId}/photo`, {
          headers: { 'x-telegram-init-data': initData }
        });
        
        if (response.data.url) {
          setPhotoUrl(response.data.url);
        } else if (response.data.fileId) {
          // Fallback to Telegram file ID
          setPhotoUrl(`https://api.telegram.org/file/bot${import.meta.env.VITE_BOT_TOKEN || ''}/${response.data.fileId}`);
        }
      } catch (error) {
        console.error('Error loading photo:', error);
      } finally {
        setLoading(false);
      }
    };

    loadPhoto();
  }, [requestId]);

  if (loading) {
    return <div className="text-sm text-gray-500">Загрузка фото...</div>;
  }

  if (!photoUrl) {
    return null;
  }

  return (
    <a
      href={photoUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block"
    >
      <img
        src={photoUrl}
        alt="Check-in photo"
        className="h-24 w-24 object-cover rounded border border-gray-300"
        onError={(e) => {
          e.target.style.display = 'none';
        }}
      />
    </a>
  );
}
