export default function EmployeeView() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-md mx-auto mt-20">
        <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="mb-6">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-100 rounded-full mb-4">
              <svg className="w-10 h-10 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
          </div>
          
          <h1 className="text-2xl font-bold text-gray-800 mb-4">
            Вы находитесь под наблюдением
          </h1>
          
          <p className="text-gray-600 mb-6">
            Ожидайте уведомления от бота для проверки местоположения.
          </p>
          
          <div className="bg-blue-50 rounded-lg p-4 mb-6">
            <p className="text-sm text-blue-800">
              ⚠️ Когда вы получите уведомление, отправьте боту ваше текущее местоположение и фото.
            </p>
          </div>
          
          <div className="text-xs text-gray-500">
            Проверки проводятся случайным образом в рабочее время (09:00 - 18:00)
          </div>
        </div>
      </div>
    </div>
  );
}
