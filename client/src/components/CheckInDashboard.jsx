import { useState, useEffect } from 'react';
import axios from 'axios';

export default function CheckInDashboard({ checkIns: initialCheckIns }) {
  const [checkIns, setCheckIns] = useState(initialCheckIns);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    setCheckIns(initialCheckIns);
  }, [initialCheckIns]);

  const filteredCheckIns = checkIns.filter(checkIn => {
    if (filter === 'success') return checkIn.isWithinZone;
    if (filter === 'failed') return !checkIn.isWithinZone;
    return true;
  });

  const formatDistance = (distance) => {
    if (distance === null || distance === undefined) return 'N/A';
    if (distance < 1000) return `${Math.round(distance)}м`;
    return `${(distance / 1000).toFixed(2)}км`;
  };

  const getPhotoUrl = (fileId) => {
    if (!fileId) return null;
    return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileId}`;
  };

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
            {checkIns.filter(c => c.isWithinZone).length}
          </div>
        </div>
        <div className="bg-red-50 rounded-lg shadow p-4">
          <div className="text-sm text-red-600">Неудачных</div>
          <div className="text-2xl font-bold text-red-700">
            {checkIns.filter(c => !c.isWithinZone).length}
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
            {filteredCheckIns.map((checkIn) => (
              <div key={checkIn.id} className="p-4 hover:bg-gray-50">
                <div className="flex items-start space-x-4">
                  <div className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${
                    checkIn.isWithinZone ? 'bg-green-100' : 'bg-red-100'
                  }`}>
                    {checkIn.isWithinZone ? (
                      <span className="text-2xl">✅</span>
                    ) : (
                      <span className="text-2xl">❌</span>
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-gray-800">
                        {checkIn.request.user.name}
                      </h3>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        checkIn.isWithinZone
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {checkIn.isWithinZone ? 'В зоне' : 'Вне зоны'}
                      </span>
                    </div>
                    
                    <div className="mt-2 space-y-1 text-sm text-gray-600">
                      <p>
                        📍 Координаты: {checkIn.locationLat.toFixed(6)}, {checkIn.locationLon.toFixed(6)}
                      </p>
                      {checkIn.distanceToZone !== null && (
                        <p>
                          📏 Расстояние до зоны: {formatDistance(checkIn.distanceToZone)}
                        </p>
                      )}
                      <p>
                        🕐 {new Date(checkIn.timestamp).toLocaleString('ru-RU')}
                      </p>
                    </div
