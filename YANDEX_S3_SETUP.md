# Настройка Yandex Cloud S3 для хранения фото

## Шаг 1: Создание бакета в Yandex Cloud

1. Войдите в [Yandex Cloud Console](https://console.cloud.yandex.ru/)
2. Перейдите в раздел **Object Storage**
3. Нажмите **Создать бакет**
4. Укажите:
   - **Имя бакета**: `geocheck-photos` (или другое уникальное имя)
   - **Тип доступа**: `Публичный` (если нужен публичный доступ) или `Приватный`
   - **Регион**: выберите ближайший (например, `ru-central1`)
5. Нажмите **Создать**

## Шаг 2: Создание сервисного аккаунта

1. Перейдите в раздел **IAM** → **Сервисные аккаунты**
2. Нажмите **Создать сервисный аккаунт**
3. Укажите имя: `geocheck-s3-service`
4. Нажмите **Создать**
5. Откройте созданный аккаунт и перейдите на вкладку **Роли**
6. Нажмите **Назначить роли** и добавьте роль: **`storage.editor`** (для записи) или **`storage.admin`** (полный доступ)

## Шаг 3: Создание статического ключа доступа

1. В сервисном аккаунте перейдите на вкладку **Ключи**
2. Нажмите **Создать новый ключ** → **Создать статический ключ доступа**
3. Сохраните:
   - **Access Key ID** (идентификатор ключа)
   - **Secret Access Key** (секретный ключ) - показывается только один раз!

## Шаг 4: Настройка CORS (если нужен публичный доступ)

1. В настройках бакета перейдите в **CORS**
2. Добавьте правило:
   ```json
   {
     "AllowedOrigins": ["*"],
     "AllowedMethods": ["GET", "HEAD"],
     "AllowedHeaders": ["*"],
     "MaxAgeSeconds": 3600
   }
   ```

## Шаг 5: Настройка переменных окружения

Добавьте в Railway (или в `.env` для локальной разработки):

```env
# Yandex Cloud S3
YC_S3_ENDPOINT=https://storage.yandexcloud.net
YC_S3_REGION=ru-central1
YC_S3_BUCKET=geocheck-photos
YC_S3_ACCESS_KEY_ID=ваш_access_key_id
YC_S3_SECRET_ACCESS_KEY=ваш_secret_access_key
YC_S3_PUBLIC_URL=https://storage.yandexcloud.net/geocheck-photos
```

## Шаг 6: Настройка политики доступа к бакету

Если бакет приватный, но нужен публичный доступ к фото:

1. В настройках бакета перейдите в **Политики доступа**
2. Добавьте политику для чтения:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": "*",
         "Action": "s3:GetObject",
         "Resource": "arn:aws:s3:::geocheck-photos/*"
       }
     ]
   }
   ```

Или используйте **Presigned URLs** для временного доступа к приватным файлам.

## Структура хранения

Фото будут храниться в бакете по пути:
```
geocheck-photos/
  photos/
    2024/
      01/
        request-id-timestamp.jpg
```

## Проверка настройки

После настройки проверьте подключение:
```bash
# В Railway или локально
node -e "
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
const s3 = new S3Client({
  endpoint: process.env.YC_S3_ENDPOINT,
  region: process.env.YC_S3_REGION,
  credentials: {
    accessKeyId: process.env.YC_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.YC_S3_SECRET_ACCESS_KEY
  }
});
s3.send(new ListBucketsCommand()).then(r => console.log('✅ Подключение успешно:', r.Buckets));
"
```

## Стоимость

Yandex Cloud Object Storage:
- Первые 10 ГБ: **бесплатно**
- Дальше: от **1.5₽ за ГБ/месяц**
- Исходящий трафик: первые 10 ГБ бесплатно, дальше от **1.2₽ за ГБ**

Для хранения фото на полгода это очень экономично!
