import { useState, useEffect } from 'react';
import axios from 'axios';
import DirectorView from './components/DirectorView';
import EmployeeView from './components/EmployeeView';
import Loading from './components/Loading';

function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    initTelegramWebApp();
  }, []);

  const initTelegramWebApp = async () => {
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand();
      
      const initData = window.Telegram.WebApp.initData;
      
      try {
        const userResponse = await axios.post('/api/user', {}, {
          headers: {
            'x-telegram-init-data': initData
          }
        });
        
        setUser(userResponse.data);
        setRole(userResponse.data.role);
      } catch (error) {
        console.error('Error initializing user:', error);
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

  if (loading) {
    return <Loading />;
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
