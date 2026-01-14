// ... existing code ...

// Middleware to verify Telegram Web App
function verifyTelegramWebApp(req, res, next) {
  // Проверяем заголовок в разных регистрах (Express может нормализовать заголовки)
  const initData = req.headers['x-telegram-init-data'] || 
                   req.headers['X-Telegram-Init-Data'] ||
                   req.headers['X-TELEGRAM-INIT-DATA'];
  
  if (!initData) {
    console.error('Missing Telegram init data header. Available headers:', Object.keys(req.headers));
    return res.status(401).json({ 
      error: 'Missing Telegram init data. Пожалуйста, откройте приложение через Telegram бота.' 
    });
  }

  if (!verifyTelegramWebAppData(initData)) {
    console.error('Invalid Telegram init data. InitData length:', initData.length);
    return res.status(401).json({ 
      error: 'Invalid Telegram init data. Пожалуйста, перезагрузите страницу.' 
    });
  }

  const user = parseInitData(initData);
  if (!user) {
    console.error('Failed to parse user data from initData');
    return res.status(401).json({ 
      error: 'Invalid user data. Пожалуйста, перезагрузите страницу.' 
    });
  }

  req.telegramUser = user;
  next();
}

// ... existing code ...
