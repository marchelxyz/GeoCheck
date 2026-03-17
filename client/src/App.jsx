import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import DirectorView from './components/DirectorView';
import EmployeeView from './components/EmployeeView';
import CheckInInterface from './components/CheckInInterface';
import Loading from './components/Loading';

axios.defaults.timeout = 15000;

const isDesktopPlatform = () => {
  const platform = window.Telegram?.WebApp?.platform;
  const desktopPlatforms = ['windows', 'macos', 'linux', 'tdesktop', 'web', 'weba', 'webk'];
  if (platform) {
    return desktopPlatforms.includes(platform);
  }
  const ua = navigator.userAgent.toLowerCase();
  return /windows|macintosh|linux/.test(ua) && !/android|iphone|ipad|mobile/.test(ua);
};

/**
 * Выполняет async-функцию с retry при сетевых/таймаут ошибках.
 * Не повторяет при HTTP-ответах (4xx/5xx) — только при полном отсутствии связи.
 */
async function withRetry(fn, { retries = 2, delayMs = 1000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isNetworkError = !error.response && (error.code === 'ECONNABORTED' || error.message === 'Network Error' || error.code === 'ERR_NETWORK');
      if (!isNetworkError || attempt === retries) {
        throw error;
      }
      await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
  throw lastError;
}

function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [requestId, setRequestId] = useState(null);
  const [pendingCheckDone, setPendingCheckDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reqId = params.get('requestId');
    if (reqId) {
      setRequestId(reqId);
    }
    
    initTelegramWebApp();
  }, []);

  useEffect(() => {
    const preventGestureZoom = (event) => {
      event.preventDefault();
    };
    const preventCtrlZoom = (event) => {
      if (event.ctrlKey) {
        event.preventDefault();
      }
    };
    const preventKeyZoom = (event) => {
      if ((event.ctrlKey || event.metaKey) && ['+', '-', '=', '0'].includes(event.key)) {
        event.preventDefault();
      }
    };
    const preventDoubleTapZoom = (event) => {
      if (event.touches && event.touches.length > 1) {
        event.preventDefault();
      }
    };
    const lockVisualViewportScale = () => {
      if (!window.visualViewport) {
        return;
      }
      const scale = window.visualViewport.scale || 1;
      if (scale !== 1) {
        document.body.style.zoom = `${1 / scale}`;
      }
    };

    document.addEventListener('gesturestart', preventGestureZoom);
    document.addEventListener('gesturechange', preventGestureZoom);
    document.addEventListener('gestureend', preventGestureZoom);
    document.addEventListener('touchstart', preventDoubleTapZoom, { passive: false });
    document.addEventListener('touchmove', preventDoubleTapZoom, { passive: false });
    window.addEventListener('wheel', preventCtrlZoom, { passive: false });
    document.addEventListener('wheel', preventCtrlZoom, { passive: false });
    window.addEventListener('keydown', preventKeyZoom);
    window.visualViewport?.addEventListener('resize', lockVisualViewportScale);
    window.visualViewport?.addEventListener('scroll', lockVisualViewportScale);

    return () => {
      document.removeEventListener('gesturestart', preventGestureZoom);
      document.removeEventListener('gesturechange', preventGestureZoom);
      document.removeEventListener('gestureend', preventGestureZoom);
      document.removeEventListener('touchstart', preventDoubleTapZoom);
      document.removeEventListener('touchmove', preventDoubleTapZoom);
      window.removeEventListener('wheel', preventCtrlZoom);
      document.removeEventListener('wheel', preventCtrlZoom);
      window.removeEventListener('keydown', preventKeyZoom);
      window.visualViewport?.removeEventListener('resize', lockVisualViewportScale);
      window.visualViewport?.removeEventListener('scroll', lockVisualViewportScale);
      document.body.style.zoom = '';
    };
  }, []);

  useEffect(() => {
    if (loading || requestId || role !== 'EMPLOYEE' || !user || pendingCheckDone) {
      return;
    }
    checkPendingCheckIn();
  }, [loading, requestId, role, user, pendingCheckDone]);

  /**
   * Проверяет наличие активного pending check-in для сотрудника
   * и устанавливает requestId, если таковой найден.
   * Повторяет запрос при сетевых ошибках (прокси/таймаут).
   */
  async function checkPendingCheckIn() {
    const initData = getTelegramInitData();
    if (!initData) {
      setPendingCheckDone(true);
      return;
    }
    try {
      const response = await withRetry(() =>
        axios.get('/api/check-in/pending', {
          headers: { 'x-telegram-init-data': initData }
        })
      );
      const id = response.data?.id;
      if (id && typeof id === 'string' && id.length > 0) {
        setRequestId(id);
      }
    } catch (error) {
      if (error.response?.status !== 404) {
        console.warn('checkPendingCheckIn failed:', error.message);
      }
    } finally {
      setPendingCheckDone(true);
    }
  }

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

  const initTelegramWebApp = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!window.Telegram) {
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
        const userResponse = await withRetry(() =>
          axios.post('/api/user', {}, {
            headers: { 'x-telegram-init-data': initData }
          })
        );
        
        setUser(userResponse.data);
        setRole(userResponse.data.role);
      } catch (error) {
        if (error.response?.status === 404) {
          setUser(null);
          setRole(null);
        } else {
          console.error('Error initializing user:', error);
          setError(error.response?.data?.error || 'Ошибка соединения. Проверьте интернет-подключение и попробуйте снова.');
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
  }, []);

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

  // Если есть requestId в URL, показываем интерфейс проверки
  // Не ждем загрузки пользователя, так как CheckInInterface может работать независимо
  if (requestId && isDesktopPlatform()) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="text-4xl mb-4">📵</div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">Проверка доступна только на мобильном</h1>
          <p className="text-gray-600">
            Откройте запрос на проверку через мобильное приложение Telegram.
          </p>
        </div>
      </div>
    );
  }

  if (requestId) {
    // Если еще идет загрузка, показываем Loading
    if (loading) {
      return <Loading />;
    }
    
    // Показываем CheckInInterface независимо от наличия user
    // Если пользователь не зарегистрирован, API вернет ошибку, которую обработает CheckInInterface
    return (
      <CheckInInterface 
        requestId={requestId}
        user={user}
        onComplete={() => {
          // После завершения проверки можно вернуться к основному интерфейсу
          window.location.href = '/';
        }}
      />
    );
  }

  if (loading) {
    return <Loading />;
  }

  if (!user && error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">Ошибка подключения</h1>
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-600">{error}</p>
          </div>
          <button
            onClick={initTelegramWebApp}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors"
          >
            Попробовать снова
          </button>
        </div>
      </div>
    );
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
              Приложение должно быть открыто через Telegram бота
            </p>
          )}
        </div>
      </div>
    );
  }

  if (role === 'EMPLOYEE' && !pendingCheckDone) {
    return <Loading />;
  }

  if (role === 'EMPLOYEE' && isDesktopPlatform()) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="text-4xl mb-4">🚫</div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">Доступ с ПК ограничен</h1>
          <p className="text-gray-600">
            Для сотрудников приложение доступно только на мобильных устройствах через Telegram.
          </p>
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
