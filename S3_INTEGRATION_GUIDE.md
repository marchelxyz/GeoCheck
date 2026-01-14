# Интеграция Yandex Cloud S3 - Инструкция

## Что нужно сделать

### 1. Настройка Yandex Cloud S3

Следуйте инструкции в файле `YANDEX_S3_SETUP.md`:
- Создайте бакет
- Создайте сервисный аккаунт
- Получите ключи доступа
- Настройте переменные окружения

### 2. Восстановление server/index.js

**ВАЖНО:** Файл `server/index.js` был случайно перезаписан. Нужно восстановить его из коммита `389c2cc9a14d29d570d9cd0aa6a597123ac6db5e`.

**Как восстановить:**
```bash
git checkout 389c2cc9a14d29d570d9cd0aa6a597123ac6db5e -- server/index.js
```

### 3. Добавление интеграции с S3 в server/index.js

После восстановления файла добавьте в начало файла (после импортов):

```javascript
import { uploadPhoto, generateFileName, testS3Connection, deletePhoto } from './s3Service.js';
```

И обновите endpoint `/api/check-in/photo`:

```javascript
// Submit photo for check-in
app.post('/api/check-in/photo', 
  verifyTelegramWebApp,
  upload.single('photo'),
  async (req, res) => {
    try {
      const { id } = req.telegramUser;
      const file = req.file;
      
      if (!file) {
        return res.status(400).json({ error: 'Фото не загружено' });
      }

      const user = await prisma.user.findUnique({
        where: { telegramId: String(id) }
      });

      if (!user) {
        fs.unlinkSync(file.path);
        return res.status(404).json({ error: 'User not found' });
      }

      const pendingRequest = await prisma.checkInRequest.findFirst({
        where: {
          userId: user.id,
          status: 'PENDING'
        },
        orderBy: { requestedAt: 'desc' }
      });

      if (!pendingRequest) {
        fs.unlinkSync(file.path);
        return res.status(404).json({ error: 'No pending check-in request' });
      }

      // Генерируем имя файла
      const fileName = generateFileName(pendingRequest.id, file.originalname);
      
      // Читаем файл в буфер
      const fileBuffer = fs.readFileSync(file.path);
      
      // Загружаем в S3
      const photoUrl = await uploadPhoto(
        fileBuffer,
        fileName,
        file.mimetype || 'image/jpeg'
      );
      
      // Удаляем временный файл
      fs.unlinkSync(file.path);

      // Обновляем результат
      const result = await prisma.checkInResult.findUnique({
        where: { requestId: pendingRequest.id }
      });

      if (result) {
        // Удаляем старое фото из S3 если есть
        if (result.photoUrl) {
          try {
            const oldFileName = result.photoUrl.split('/photos/')[1];
            if (oldFileName) {
              await deletePhoto(oldFileName);
            }
          } catch (error) {
            console.error('Ошибка удаления старого фото:', error);
          }
        }
        
        await prisma.checkInResult.update({
          where: { id: result.id },
          data: { 
            photoUrl,
            photoPath: fileName // Сохраняем путь для удаления
          }
        });
      } else {
        await prisma.checkInResult.create({
          data: {
            requestId: pendingRequest.id,
            locationLat: 0,
            locationLon: 0,
            isWithinZone: false,
            photoUrl,
            photoPath: fileName
          }
        });
      }

      res.json({ success: true, photoUrl });
    } catch (error) {
      console.error('Error in /api/check-in/photo:', error);
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ error: error.message });
    }
  }
);
```

### 4. Добавление cron job для очистки старых фото

Добавьте в конец файла перед `startBot()`:

```javascript
// Cron job для очистки старых фото (старше 6 месяцев)
cron.schedule('0 3 * * *', async () => {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  
  try {
    // Находим старые результаты с фото
    const oldResults = await prisma.checkInResult.findMany({
      where: {
        timestamp: { lt: sixMonthsAgo },
        photoPath: { not: null }
      },
      select: { 
        id: true,
        photoPath: true,
        photoUrl: true
      }
    });
    
    console.log(`🧹 Найдено ${oldResults.length} старых фото для удаления`);
    
    // Удаляем фото из S3
    for (const result of oldResults) {
      if (result.photoPath) {
        try {
          await deletePhoto(result.photoPath);
        } catch (error) {
          console.error(`Ошибка удаления фото ${result.photoPath}:`, error);
        }
      }
    }
    
    // Удаляем записи из БД
    await prisma.checkInResult.deleteMany({
      where: {
        timestamp: { lt: sixMonthsAgo }
      }
    });
    
    console.log(`✅ Очищено ${oldResults.length} старых фото`);
  } catch (error) {
    console.error('Ошибка очистки старых фото:', error);
  }
});
```

### 5. Проверка подключения к S3 при старте

Добавьте в функцию `startBot()` после успешных миграций:

```javascript
async function startBot() {
  console.log('🔄 Running database migrations...');
  const migrationsOk = await runMigrations();
  if (!migrationsOk) {
    // ... existing error handling ...
  }

  // Проверяем подключение к S3
  if (process.env.YC_S3_BUCKET) {
    await testS3Connection();
  } else {
    console.warn('⚠️  YC_S3_BUCKET не установлен. Хранение фото в S3 отключено.');
  }

  // ... rest of the function ...
}
```

### 6. Обновление multer конфигурации

В начале файла обновите конфигурацию multer:

```javascript
// Configure multer for file uploads
const upload = multer({ 
  dest: '/tmp/',
  limits: { 
    fileSize: 10 * 1024 * 1024 // 10MB максимум
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Только изображения разрешены'));
    }
  }
});
```

## Переменные окружения для Railway

Добавьте в Railway:

```env
YC_S3_ENDPOINT=https://storage.yandexcloud.net
YC_S3_REGION=ru-central1
YC_S3_BUCKET=geocheck-photos
YC_S3_ACCESS_KEY_ID=ваш_access_key_id
YC_S3_SECRET_ACCESS_KEY=ваш_secret_access_key
YC_S3_PUBLIC_URL=https://storage.yandexcloud.net/geocheck-photos
YC_S3_PUBLIC_ACCESS=true
```

## Проверка работы

После деплоя проверьте логи:
- Должно быть: `✅ Подключение к Yandex Cloud S3 успешно`
- При загрузке фото: `✅ Фото загружено в S3: https://...`

## Структура файлов в S3

Фото будут храниться по пути:
```
geocheck-photos/photos/2024/01/request-id-timestamp.jpg
```

Это позволяет легко управлять файлами по датам и автоматически очищать старые.
