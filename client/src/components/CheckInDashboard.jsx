import { useState, useEffect } from 'react';
import axios from 'axios';

export default function CheckInDashboard({ checkIns: initialCheckIns }) {
  const [checkIns, setCheckIns] = useState(initialCheckIns || []);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState(null);

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
          // Для Telegram file ID нужно использовать другой подход
          // Но лучше использовать URL из S3, если он есть
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
