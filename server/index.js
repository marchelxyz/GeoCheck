// Bot handlers
bot.start(async (ctx) => {
  const userId = String(ctx.from.id);
  
  const user = await prisma.user.findUnique({
    where: { telegramId: userId }
  });
  
  if (!user) {
    await ctx.reply(
      '👋 Привет!\n\n' +
      'Для использования бота необходимо зарегистрироваться через веб-приложение.\n' +
      'Нажмите кнопку ниже, чтобы открыть приложение и зарегистрироваться.'
    );
    const keyboard = Markup.keyboard([
      [Markup.button.webApp('Открыть GeoCheck', WEB_APP_URL)]
    ]).resize();
    await ctx.reply('Откройте приложение для регистрации:', keyboard);
    return;
  }
  
  const keyboard = Markup.keyboard([
    [Markup.button.webApp('Открыть GeoCheck', WEB_APP_URL)]
  ]).resize();
  
  await ctx.reply(
    `Привет, ${user.name}! 👋\n\n` +
    `Это бот для отслеживания геолокации сотрудников.\n` +
    `Нажмите кнопку ниже, чтобы открыть приложение.`,
    keyboard
  );
});
