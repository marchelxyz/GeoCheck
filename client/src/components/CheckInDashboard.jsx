import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function CheckInDashboard({ checkIns: initialCheckIns }) {
  const [checkIns, setCheckIns] = useState(initialCheckIns || []);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [timeGrouping, setTimeGrouping] = useState('day'); // 'hour', 'day', 'week', 'date'
  const [selectedUser, setSelectedUser] = useState('all');
  const [sortBy, setSortBy] = useState('date'); // 'date', 'user', 'status'

  useEffect(() => {
    setCheckIns(initialCheckIns || []);
  }, [initialCheckIns]);

  // Получаем список уникальных пользователей
  const users = useMemo(() => {
    const uniqueUsers = new Set();
    checkIns.forEach(checkIn => {
      if (checkIn.user?.name) {
        uniqueUsers.add(checkIn.user.name);
      }
    });
    return Array.from(uniqueUsers).sort();
  }, [checkIns]);

  // Фильтрация по пользователю
  const userFilteredCheckIns = useMemo(() => {
    if (selectedUser === 'all') return checkIns;
    return checkIns.filter(checkIn => checkIn.user?.name === selectedUser);
  }, [checkIns, selectedUser]);

  // Фильтрация по статусу
  const filteredCheckIns = useMemo(() => {
    return userFilteredCheckIns.filter(checkIn => {
      const result = checkIn.result;
      if (!result) return filter === 'all';
      
      if (filter === 'success') return result.isWithinZone === true;
      if (filter === 'failed') return result.isWithinZone === false;
      return true;
    });
  }, [userFilteredCheckIns, filter]);

  // Группировка данных для диаграммы
  const chartData = useMemo(() => {
    const grouped = {};
    
    userFilteredCheckIns.forEach(checkIn => {
      const date = new Date(checkIn.requestedAt);
      let key;
      
      switch (timeGrouping) {
        case 'hour':
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:00`;
          break;
        case 'day':
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          break;
        case 'week':
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
          break;
        case 'date':
        default:
          key = date.toLocaleDateString('ru-RU');
          break;
      }
      
      if (!grouped[key]) {
        grouped[key] = {
          period: key,
          inZone: 0,
          outZone: 0,
          notSent: 0
        };
      }
      
      if (checkIn.status === 'COMPLETED' && checkIn.result) {
        if (checkIn.result.isWithinZone === true) {
          grouped[key].inZone++;
        } else {
          grouped[key].outZone++;
        }
      } else if (checkIn.status === 'MISSED' || checkIn.status === 'PENDING') {
        grouped[key].notSent++;
      }
    });
    
    return Object.values(grouped).sort((a, b) => {
      return new Date(a.period) - new Date(b.period);
    });
  }, [userFilteredCheckIns, timeGrouping]);

  // Сортировка списка проверок
  const sortedCheckIns = useMemo(() => {
    const sorted = [...filteredCheckIns];
    
    switch (sortBy) {
      case 'date':
        sorted.sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
        break;
      case 'user':
        sorted.sort((a, b) => {
          const nameA = a.user?.name || '';
          const nameB = b.user?.name || '';
          return nameA.localeCompare(nameB);
        });
        break;
      case 'status':
        sorted.sort((a, b) => {
          const statusA = a.status || '';
          const statusB = b.status || '';
          return statusA.localeCompare(statusB);
        });
        break;
      default:
        break;
    }
    
    return sorted;
  }, [filteredCheckIns, sortBy]);

  const formatDistance = (distance) => {
    if (distance === null || distance === undefined) return 'N/A';
    if (distance < 1000) return `${Math.round(distance)}м`;
    return `${(distance / 1000).toFixed(2)}км`;
  };

  const successfulCount = checkIns.filter(c => c.result?.isWithinZone === true).length;
  const failedCount = checkIns.filter(c => c.result?.isWithinZone === false).length;
  const notSentCount = checkIns.filter(c => c.status === 'MISSED' || c.status === 'PENDING').length;

  return (
    <div className="space-y-4">
      {/* Статистика */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">Всего проверок</div>
          <div className="text-2xl font-bold text-gray-800">{checkIns.length}</div>
        </div>
        <div className="bg-green-50 rounded-lg shadow p-4">
          <div className="text-sm text-green-600">В зоне</div>
          <div className="text-2xl font-bold text-green-700">
            {successfulCount}
          </div>
        </div>
        <div className="bg-red-50 rounded-lg shadow p-4">
          <div className="text-sm text-red-600">Вне зоны</div>
          <div className="text-2xl font-bold text-red-700">
            {failedCount}
          </div>
        </div>
        <div className="bg-yellow-50 rounded-lg shadow p-4">
          <div className="text-sm text-yellow-600">Не отправлено</div>
          <div className="text-2xl font-bold text-yellow-700">
            {notSentCount}
          </div>
        </div>
      </div>

      {/* Диаграмма */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-bold text-gray-800 mb-4">Тенденция по отчетам</h2>
        
        {/* Фильтры для диаграммы */}
        <div className="mb-4 flex flex-wrap gap-2">
          <div className="flex items-center space-x-2">
            <label className="text-sm font-medium text-gray-700">Группировка:</label>
            <select
              value={timeGrouping}
              onChange={(e) => setTimeGrouping(e.target.value)}
              className="px-3 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="hour">По часам</option>
              <option value="day">По дням</option>
              <option value="week">По неделям</option>
              <option value="date">По датам</option>
            </select>
          </div>
          
          <div className="flex items-center space-x-2">
            <label className="text-sm font-medium text-gray-700">Пользователь:</label>
            <select
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="px-3 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Все пользователи</option>
              {users.map(user => (
                <option key={user} value={user}>{user}</option>
              ))}
            </select>
          </div>
        </div>

        {/* График */}
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="period" 
                angle={-45}
                textAnchor="end"
                height={80}
                interval={0}
                style={{ fontSize: '12px' }}
              />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="inZone" 
                stroke="#10b981" 
                strokeWidth={2}
                name="В зоне"
                dot={{ r: 4 }}
              />
              <Line 
                type="monotone" 
                dataKey="outZone" 
                stroke="#ef4444" 
                strokeWidth={2}
                name="Вне зоны"
                dot={{ r: 4 }}
              />
              <Line 
                type="monotone" 
                dataKey="notSent" 
                stroke="#eab308" 
                strokeWidth={2}
                name="Не отправлено"
                dot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-96 flex items-center justify-center text-gray-500">
            Нет данных для отображения
          </div>
        )}
      </div>

      {/* Фильтры для списка */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center space-x-2">
            <label className="text-sm font-medium text-gray-700">Статус:</label>
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
                ✅ В зоне
              </button>
              <button
                onClick={() => setFilter('failed')}
                className={`px-4 py-2 rounded-md text-sm font-medium ${
                  filter === 'failed'
                    ? 'bg-red-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                ❌ Вне зоны
              </button>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <label className="text-sm font-medium text-gray-700">Сортировка:</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="date">По дате</option>
              <option value="user">По пользователю</option>
              <option value="status">По статусу</option>
            </select>
          </div>

          <div className="flex items-center space-x-2">
            <label className="text-sm font-medium text-gray-700">Пользователь:</label>
            <select
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Все пользователи</option>
              {users.map(user => (
                <option key={user} value={user}>{user}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Список проверок */}
      <div className="bg-white rounded-lg shadow">
        {sortedCheckIns.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            Нет записей о проверках
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {sortedCheckIns.map((checkIn) => {
              const result = checkIn.result;
              const user = checkIn.user;
              
              if (!user) {
                return (
                  <div key={checkIn.id} className="p-4">
                    <p className="text-sm text-gray-500">
                      Проверка #{checkIn.id} - данные загружаются...
                    </p>
                  </div>
                );
              }

              const isWithinZone = result?.isWithinZone === true;
              const status = checkIn.status;
              
              return (
                <div key={checkIn.id} className="p-4 hover:bg-gray-50">
                  <div className="flex items-start space-x-4">
                    <div className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${
                      status === 'COMPLETED' 
                        ? (isWithinZone ? 'bg-green-100' : 'bg-red-100')
                        : 'bg-yellow-100'
                    }`}>
                      {status === 'COMPLETED' ? (
                        isWithinZone ? (
                          <span className="text-2xl">✅</span>
                        ) : (
                          <span className="text-2xl">❌</span>
                        )
                      ) : (
                        <span className="text-2xl">⏳</span>
                      )}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-gray-800">
                          {user.name}
                        </h3>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          status === 'COMPLETED'
                            ? (isWithinZone
                                ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-800')
                            : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {status === 'COMPLETED' 
                            ? (isWithinZone ? 'В зоне' : 'Вне зоны')
                            : status === 'PENDING' 
                            ? 'Ожидает'
                            : 'Пропущена'}
                        </span>
                      </div>
                      
                      <div className="mt-2 space-y-1 text-sm text-gray-600">
                        {result?.locationLat && result?.locationLon && (
                          <p>
                            📍 Координаты: {result.locationLat.toFixed(6)}, {result.locationLon.toFixed(6)}
                          </p>
                        )}
                        {result?.distanceToZone !== null && result?.distanceToZone !== undefined && (
                          <p>
                            📏 Расстояние до зоны: {formatDistance(result.distanceToZone)}
                          </p>
                        )}
                        <p>
                          🕐 {new Date(checkIn.requestedAt).toLocaleString('ru-RU')}
                        </p>
                        <p>
                          Статус: {status === 'COMPLETED' ? '✅ Завершена' : status === 'PENDING' ? '⏳ Ожидает' : status === 'MISSED' ? '❌ Пропущена' : status}
                        </p>
                      </div>
                      
                      {result && (result.photoPath || result.photoFileId) && (
                        <div className="mt-3">
                          <PhotoDisplay 
                            requestId={checkIn.id} 
                            onPhotoClick={(url) => setSelectedPhoto(url)}
                          />
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

      {/* Модальное окно для просмотра фото в полном размере */}
      {selectedPhoto && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedPhoto(null)}
        >
          <div className="relative max-w-4xl max-h-full">
            <button
              onClick={() => setSelectedPhoto(null)}
              className="absolute top-4 right-4 bg-white rounded-full p-2 shadow-lg hover:bg-gray-100 z-10"
            >
              <svg className="w-6 h-6 text-gray-800" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <img
              src={selectedPhoto}
              alt="Check-in photo"
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PhotoDisplay({ requestId, onPhotoClick }) {
  const [photoUrl, setPhotoUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

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
          console.warn('Photo available only as Telegram file ID, S3 URL preferred');
          setError(true);
        }
      } catch (error) {
        console.error('Error loading photo:', error);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    loadPhoto();
  }, [requestId]);

  if (loading) {
    return (
      <div className="flex items-center space-x-2">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
        <span className="text-sm text-gray-500">Загрузка фото...</span>
      </div>
    );
  }

  if (error || !photoUrl) {
    return (
      <div className="text-sm text-gray-400 italic">
        📷 Фото недоступно
      </div>
    );
  }

  return (
    <div className="mt-2">
      <div className="text-xs text-gray-500 mb-1">Фото проверки:</div>
      <button
        onClick={() => onPhotoClick(photoUrl)}
        className="group relative overflow-hidden rounded-lg border-2 border-gray-300 hover:border-blue-500 transition-all duration-200"
      >
        <img
          src={photoUrl}
          alt="Check-in photo"
          className="h-32 w-32 object-cover cursor-pointer hover:opacity-90 transition-opacity"
          onError={(e) => {
            e.target.style.display = 'none';
            setError(true);
          }}
        />
        <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-200 flex items-center justify-center">
          <svg className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
          </svg>
        </div>
      </button>
      <p className="text-xs text-gray-400 mt-1">Нажмите для просмотра в полном размере</p>
    </div>
  );
}
