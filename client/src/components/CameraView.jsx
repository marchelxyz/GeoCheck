import { useEffect, useRef, useState } from 'react';

export default function CameraView({
  onCapture,
  onClose,
  onError,
  onCameraEvent,
  manualStartOnly = false,
  captureDisabled = false
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [permissionNeeded, setPermissionNeeded] = useState(false);
  const [userGestureRequired, setUserGestureRequired] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [captureLocked, setCaptureLocked] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(() => {
    return localStorage.getItem('cameraPermissionDenied') === '1';
  });

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  };

  const emitCameraEvent = (eventType, eventData = {}) => {
    onCameraEvent?.(eventType, eventData);
  };

  const startCamera = async (source = 'auto') => {
    setLoading(true);
    setCameraError(null);
    setPermissionNeeded(false);
    setUserGestureRequired(false);
    setCameraReady(false);
    emitCameraEvent('camera_start', { source });
    try {
      const constraints = {
        video: {
          facingMode: { ideal: 'user' },
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 }
        }
      };

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        console.warn('Failed with ideal constraints, trying simplified:', err);
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'user'
            }
          });
        } catch (err2) {
          console.warn('Failed with environment camera, trying any camera:', err2);
          stream = await navigator.mediaDevices.getUserMedia({
            video: true
          });
        }
      }

      if (!stream) {
        throw new Error('Не удалось получить поток камеры');
      }

      streamRef.current = stream;
      if (!videoRef.current) {
        throw new Error('Video элемент не найден');
      }

      videoRef.current.srcObject = stream;
      await new Promise((resolve, reject) => {
        const video = videoRef.current;
        const onLoadedMetadata = () => {
          video.removeEventListener('loadedmetadata', onLoadedMetadata);
          video.removeEventListener('error', onErrorEvent);
          resolve();
        };
        const onErrorEvent = (event) => {
          video.removeEventListener('loadedmetadata', onLoadedMetadata);
          video.removeEventListener('error', onErrorEvent);
          reject(event);
        };
        video.addEventListener('loadedmetadata', onLoadedMetadata);
        video.addEventListener('error', onErrorEvent);
        video.play().catch(reject);
      });
      setCameraReady(true);
      emitCameraEvent('camera_ready', { source });
    } catch (err) {
      const errorPayload = { source, name: err?.name, message: err?.message };
      emitCameraEvent('camera_error', errorPayload);
      const message = err?.name === 'NotAllowedError'
        ? 'Разрешите доступ к камере, чтобы сделать фото.'
        : 'Не удалось получить доступ к камере. Проверьте разрешения и попробуйте снова.';
      setCameraError(message);
      setPermissionNeeded(err?.name === 'NotAllowedError');
      if (err?.name === 'NotAllowedError') {
        emitCameraEvent('camera_permission_denied', errorPayload);
        localStorage.setItem('cameraPermissionDenied', '1');
        setPermissionDenied(true);
      }
      onError?.(message);
      stopStream();
    } finally {
      setLoading(false);
    }
  };

  const handleCapture = async () => {
    if (!videoRef.current || !canvasRef.current || loading || captureLocked || captureDisabled) return;
    setLoading(true);
    setCaptureLocked(true);
    emitCameraEvent('camera_capture_click');
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video.readyState < 2) {
      await new Promise((resolve) => {
        if (video.readyState >= 2) {
          resolve();
          return;
        }
        const onLoadedMetadata = () => {
          video.removeEventListener('loadedmetadata', onLoadedMetadata);
          resolve();
        };
        video.addEventListener('loadedmetadata', onLoadedMetadata);
      });
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      setLoading(false);
      if (!blob) {
        const message = 'Не удалось создать файл изображения.';
        emitCameraEvent('camera_capture_failed', { reason: 'blob_empty' });
        setCameraError(message);
        onError?.(message);
        setCaptureLocked(false);
        return;
      }
      emitCameraEvent('camera_capture_success', { size: blob.size, type: blob.type });
      const file = new File([blob], 'checkin_photo.jpg', { type: 'image/jpeg' });
      onCapture?.(file);
    }, 'image/jpeg', 0.9);
  };

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      const message = 'Ваше устройство не поддерживает доступ к камере через браузер.';
      emitCameraEvent('camera_not_supported');
      setCameraError(message);
      onError?.(message);
      return undefined;
    }
    if (manualStartOnly) {
      emitCameraEvent('camera_user_gesture_required');
      setUserGestureRequired(true);
      setPermissionNeeded(true);
      return () => {
        stopStream();
      };
    }
    if (permissionDenied) {
      const message = 'Доступ к камере запрещен. Разрешите доступ в настройках браузера.';
      emitCameraEvent('camera_permission_cached_denied');
      setCameraError(message);
      onError?.(message);
      setPermissionNeeded(true);
      return undefined;
    }
    if (isIosDevice()) {
      emitCameraEvent('camera_user_gesture_required');
      setUserGestureRequired(true);
      setPermissionNeeded(true);
      return undefined;
    }
    startCamera('auto');
    return () => {
      stopStream();
    };
  }, [manualStartOnly, permissionDenied]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 z-50 flex flex-col items-center justify-center p-4">
      <video
        ref={videoRef}
        className="max-w-full max-h-[70vh] object-contain rounded-lg"
        autoPlay
        playsInline
        muted
      ></video>
      <canvas ref={canvasRef} style={{ display: 'none' }}></canvas>
      <div className="mt-4 flex flex-wrap justify-center gap-3">
        {(!manualStartOnly || cameraReady) && (
          <button
            onClick={handleCapture}
            className="px-6 py-3 bg-green-500 hover:bg-green-600 text-white font-medium rounded-full shadow-lg transition-colors"
            disabled={loading || captureLocked || captureDisabled}
          >
            📷 Сделать фото
          </button>
        )}
        <button
          onClick={onClose}
          className="px-6 py-3 bg-red-500 hover:bg-red-600 text-white font-medium rounded-full shadow-lg transition-colors"
          disabled={loading}
        >
          ✕ Отмена
        </button>
      </div>
      {loading && <p className="text-white mt-4">Загрузка...</p>}
      {cameraError && <p className="text-red-400 mt-4 text-center max-w-md">{cameraError}</p>}
      {userGestureRequired && !cameraError && (
        <p className="text-gray-200 mt-3 text-center max-w-md text-sm">
          Нажмите «Включить камеру», чтобы продолжить.
        </p>
      )}
      {permissionNeeded && (
        <button
          onClick={() => {
            localStorage.removeItem('cameraPermissionDenied');
            setPermissionDenied(false);
            startCamera('user');
          }}
          className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          disabled={loading}
        >
          Включить камеру
        </button>
      )}
    </div>
  );
}

function isIosDevice() {
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  if (/iPad|iPhone|iPod/i.test(ua)) {
    return true;
  }
  return platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}
