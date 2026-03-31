/**
 * Ограничивает число одновременных запросов превью фото (каждый тянет файл с S3 через API).
 */
const MAX_CONCURRENT = 4;
let activeCount = 0;
const waiters = [];

/**
 * Возвращает функцию `release` — вызвать после onLoad/onError у img или при отмене (unmount).
 *
 * @returns {Promise<() => void>}
 */
export function acquirePhotoPreviewSlot() {
  return new Promise((resolve) => {
    const grant = () => {
      activeCount += 1;
      let released = false;
      resolve(() => {
        if (released) {
          return;
        }
        released = true;
        activeCount -= 1;
        const next = waiters.shift();
        if (next) {
          next();
        }
      });
    };

    if (activeCount < MAX_CONCURRENT) {
      grant();
    } else {
      waiters.push(grant);
    }
  });
}

export const PHOTO_PREVIEW_MAX_CONCURRENT = MAX_CONCURRENT;
