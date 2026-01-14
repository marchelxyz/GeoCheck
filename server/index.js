// ... existing code ...

// Request check-in for specific employee (Director only)
app.post('/api/check-ins/request', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const { employeeId } = req.body;

    const director = await prisma.user.findUnique({
      where: { telegramId: String(id) }
    });

    if (!director || director.role !== 'DIRECTOR') {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!employeeId) {
      return res.status(400).json({ error: 'Employee ID is required' });
    }

    const employee = await prisma.user.findUnique({
      where: { id: employeeId }
    });

    if (!employee || employee.role !== 'EMPLOYEE') {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const pendingRequest = await prisma.checkInRequest.findFirst({
      where: {
        userId: employee.id,
        status: 'PENDING'
      }
    });

    if (pendingRequest) {
      return res.status(400).json({ error: 'Employee already has a pending check-in request' });
    }

    const checkInRequest = await prisma.checkInRequest.create({
      data: {
        userId: employee.id,
        status: 'PENDING'
      }
    });

    // Send notification with button to check-in interface
    const checkInUrl = `${WEB_APP_URL}/check-in?requestId=${checkInRequest.id}`;
    try {
      await bot.telegram.sendMessage(
        employee.telegramId,
        '📍 Проверка местоположения!\\n\\nПожалуйста, отправьте ваше текущее местоположение и фото.',
        Markup.inlineKeyboard([
          [Markup.button.webApp('Открыть интерфейс проверки', checkInUrl)]
        ])
      );
    } catch (error) {
      console.error('Error sending check-in notification:', error);
    }

    res.json(checkInRequest);
  } catch (error) {
    console.error('Error in /api/check-ins/request:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add location for employee (Director only) - директор отправляет геолокацию от имени сотрудника
app.post('/api/employees/:id/location', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id: directorId } = req.telegramUser;
    const { id: employeeId } = req.params;
    const { latitude, longitude } = req.body;

    const director = await prisma.user.findUnique({
      where: { telegramId: String(directorId) }
    });

    if (!director || director.role !== 'DIRECTOR') {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const employee = await prisma.user.findUnique({
      where: { id: employeeId }
    });

    if (!employee || employee.role !== 'EMPLOYEE') {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Create check-in request for employee
    const checkInRequest = await prisma.checkInRequest.create({
      data: {
        userId: employee.id,
        status: 'COMPLETED' // Сразу помечаем как завершенный, т.к. директор сам отправил гео
      }
    });

    // Check location against employee's zones
    const locationCheck = await checkLocationInZones(latitude, longitude, employee.id);

    // Create result with location
    await prisma.checkInResult.create({
      data: {
        requestId: checkInRequest.id,
        locationLat: latitude,
        locationLon: longitude,
        isWithinZone: locationCheck.isWithinZone,
        distanceToZone: locationCheck.distanceToZone
      }
    });

    res.json({
      success: true,
      isWithinZone: locationCheck.isWithinZone,
      distanceToZone: locationCheck.distanceToZone,
      requestId: checkInRequest.id
    });
  } catch (error) {
    console.error('Error in /api/employees/:id/location:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ... existing code ...