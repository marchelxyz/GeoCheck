// Get director settings (Director only)
app.get('/api/director/settings', verifyTelegramWebApp, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    
    log('INFO', 'DIRECTOR', 'Get director settings request', {
      requestId: req.requestId,
      telegramId: id
    });

    const user = await prisma.user.findUnique({
      where: { telegramId: String(id) },
      select: {
        role: true,
        notificationsEnabled: true,
        weeklyZoneReminderEnabled: true
      }
    });

    if (!user || user.role !== 'DIRECTOR') {
      log('WARN', 'DIRECTOR', 'Access denied - not a director', {
        requestId: req.requestId,
        telegramId: id,
        role: user?.role
      });
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
      notificationsEnabled: user.notificationsEnabled ?? true,
      weeklyZoneReminderEnabled: user.weeklyZoneReminderEnabled ?? true
    });
  } catch (error) {
    log('ERROR', 'DIRECTOR', 'Error getting director settings', {
      requestId: req.requestId,
      telegramId: req.telegramUser?.id,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message });
  }
});
