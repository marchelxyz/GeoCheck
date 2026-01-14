import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

// Инициализация S3 клиента для Yandex Cloud
const s3Client = new S3Client({
  endpoint: process.env.YC_S3_ENDPOINT || 'https://storage.yandexcloud.net',
  region: process.env.YC_S3_REGION || 'ru-central1',
  credentials: {
    accessKeyId: process.env.YC_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.YC_S3_SECRET_ACCESS_KEY
  }
});

const BUCKET_NAME = process.env.YC_S3_BUCKET;
const PUBLIC_URL = process.env.YC_S3_PUBLIC_URL || `https://storage.yandexcloud.net/${BUCKET_NAME}`;

/**
 * Загружает фото в Yandex Cloud S3
 * @param {Buffer|Readable} fileBuffer - Буфер файла или поток
 * @param {string} fileName - Имя файла (например: "2024/01/request-id-timestamp.jpg")
 * @param {string} contentType - MIME тип (например: "image/jpeg")
 * @returns {Promise<string>} URL загруженного файла
 */
export async function uploadPhoto(fileBuffer, fileName, contentType = 'image/jpeg') {
  if (!BUCKET_NAME) {
    throw new Error('YC_S3_BUCKET не установлен в переменных окружения');
  }

  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `photos/${fileName}`,
      Body: fileBuffer,
      ContentType: contentType,
      // Устанавливаем публичный доступ для чтения (если бакет публичный)
      ACL: 'public-read'
    });

    await s3Client.send(command);
    
    // Возвращаем публичный URL
    const photoUrl = `${PUBLIC_URL}/photos/${fileName}`;
    console.log(`✅ Фото загружено в S3: ${photoUrl}`);
    
    return photoUrl;
  } catch (error) {
    console.error('❌ Ошибка загрузки фото в S3:', error);
    throw error;
  }
}

/**
 * Получает URL для доступа к фото (публичный или presigned)
 * @param {string} fileName - Имя файла в S3
 * @param {number} expiresIn - Время жизни presigned URL в секундах (по умолчанию 1 час)
 * @returns {Promise<string>} URL файла
 */
export async function getPhotoUrl(fileName, expiresIn = 3600) {
  if (!BUCKET_NAME) {
    throw new Error('YC_S3_BUCKET не установлен в переменных окружения');
  }

  try {
    // Если бакет публичный, возвращаем прямой URL
    if (process.env.YC_S3_PUBLIC_ACCESS === 'true') {
      return `${PUBLIC_URL}/photos/${fileName}`;
    }

    // Иначе генерируем presigned URL
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `photos/${fileName}`
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn });
    return url;
  } catch (error) {
    console.error('❌ Ошибка получения URL фото:', error);
    throw error;
  }
}

/**
 * Удаляет фото из S3
 * @param {string} fileName - Имя файла в S3
 */
export async function deletePhoto(fileName) {
  if (!BUCKET_NAME) {
    throw new Error('YC_S3_BUCKET не установлен в переменных окружения');
  }

  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `photos/${fileName}`
    });

    await s3Client.send(command);
    console.log(`✅ Фото удалено из S3: photos/${fileName}`);
  } catch (error) {
    console.error('❌ Ошибка удаления фото из S3:', error);
    throw error;
  }
}

/**
 * Генерирует уникальное имя файла
 * @param {string} requestId - ID запроса на проверку
 * @param {string} originalName - Оригинальное имя файла
 * @returns {string} Уникальное имя файла
 */
export function generateFileName(requestId, originalName) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const timestamp = now.getTime();
  const ext = originalName.split('.').pop() || 'jpg';
  
  return `${year}/${month}/${requestId}-${timestamp}.${ext}`;
}

/**
 * Проверяет подключение к S3
 */
export async function testS3Connection() {
  if (!BUCKET_NAME) {
    console.error('❌ YC_S3_BUCKET не установлен');
    return false;
  }

  try {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      MaxKeys: 1
    });
    
    await s3Client.send(command);
    console.log('✅ Подключение к Yandex Cloud S3 успешно');
    return true;
  } catch (error) {
    console.error('❌ Ошибка подключения к S3:', error.message);
    return false;
  }
}
