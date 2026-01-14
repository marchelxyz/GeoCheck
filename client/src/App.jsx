import { useState, useEffect } from 'react';
import axios from 'axios';
import DirectorView from './components/DirectorView';
import EmployeeView from './components/EmployeeView';
import Loading from './components/Loading';

function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    initTelegramWebApp();
  }, []);

  const getTelegramInitData = () => {
    if (!window.Telegram?.WebApp) {
      return null;
    }
    
    // Пробуем получить initData разными способами
    const webApp = window.Telegram.WebApp;
    
    // Основной способ - через initData
    if (webApp.initData) {
      return webApp.initData;
    }
    
    // Альтернативный способ - через initDataUnsafe (если доступен)
    if (webApp.initDataUnsafe) {
      // Если initDataUnsafe есть, но initData нет, нужно сформировать строку вручную
      // Но лучше использовать готовый initData, если он есть
      console.warn('initDataUnsafe available but initData is missing');
    }
    
    return null;
  };

  const initTelegramWebApp = async () => {
    // Ждем загрузки Telegram Web App SDK
    if (!window.Telegram) {
      // Пробуем подождать немного
      await new Promise(resolve => setTimeout(resolve, 500));
      
      if (!window.Telegram?.WebApp) {
        console.warn('Telegram WebApp not available, using mock data');
        setUser({ id: 'dev', role: 'DIRECTOR' });
        setRole('DIRECTOR');
        setLoading(false);
        return;
      }
    }

    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand();
      
      const initData = getTelegramInitData();
      
      if (!initData) {
        console.error('Telegram initData is not available');
        setError('Не удалось получить данные Telegram. Пожалуйста, откройте приложение через Telegram бота.');
        setLoading(false);
        return;
      }
      
      try {
        const userResponse = await axios.post('/api/user', {}, {
          headers: {
            'x-telegram-init-data': initData
          }
        });
        
        setUser(userResponse.data);
        setRole(userResponse.data.role);
      } catch (error) {
        if (error.response?.status === 404) {
          setUser(null);
          setRole(null);
        } else {
          console.error('Error initializing user:', error);
          setError(error.response?.data?.error || 'Ошибка инициализации пользователя');
        }
      } finally {
        setLoading(false);
      }
    } else {
      console.warn('Telegram WebApp not available, using mock data');
      setUser({ id: 'dev', role: 'DIRECTOR' });
      setRole('DIRECTOR');
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!window.Telegram?.WebApp) {
      alert('Telegram WebApp недоступен. Пожалуйста, откройте приложение через Telegram бота.');
      return;
    }
    
    const initData = getTelegramInitData();
    
    if (!initData) {
      alert('Не удалось получить данные Telegram. Пожалуйста, перезагрузите страницу или откройте приложение через Telegram бота.');
      console.error('initData is missing:', {
        hasTelegram: !!window.Telegram,
        hasWebApp: !!window.Telegram?.WebApp,
        initData: window.Telegram?.WebApp?.initData,
        initDataUnsafe: window.Telegram?.WebApp?.initDataUnsafe
      });
      return;
    }
    
    try {
      setError(null);
      const userResponse = await axios.post('/api/user/register', {}, {
        headers: {
          'x-telegram-init-data': initData
        }
      });
      
      setUser(userResponse.data);
      setRole(userResponse.data.role);
    } catch (error) {
      console.error('Error registering user:', error);
      const errorMessage = error.response?.data?.error || 'Ошибка регистрации';
      setError(errorMessage);
      alert(errorMessage);
    }
  };

  if (loading) {
    return <Loading />;
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
              <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-800 mb-2">Добро пожаловать в GeoCheck!</h1>
            <p className="text-gray-600">Для начала работы необходимо зарегистрироваться</p>
          </div>
          
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}
          
          <button
            onClick={handleRegister}
            disabled={!window.Telegram?.WebApp}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-medium py-3 px-4 rounded-lg transition-colors"
          >
            Зарегистрироваться
          </button>
          
          <p className="text-xs text-gray-500 text-center mt-4">
            Первый зарегистрированный пользователь получит права директора
          </p>
          
          {!window.Telegram?.WebApp && (
            <p className="text-xs text-red-500 text-center mt-2">
              ⚠️ Приложение должно быть открыто через Telegram бота
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {role === 'DIRECTOR' ? (
        <DirectorView />
      ) : (
        <EmployeeView />
      )}
    </div>
  );
}

export default App;
