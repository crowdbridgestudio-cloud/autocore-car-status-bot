// ==================================================
// I18N / TRANSLATIONS
// ==================================================

const SUPPORTED_LANGS = ["en", "az", "tr", "pl", "ru"];
const DEFAULT_LANG = "en";

const LANGUAGE_LABELS = {
    en: "🇬🇧 English",
    az: "🇦🇿 Azərbaycan",
    tr: "🇹🇷 Türkçe",
    pl: "🇵🇱 Polski",
    ru: "🇷🇺 Русский"
};


// --------------------------------------------------
// STATUS LABELS
// --------------------------------------------------

const STATUS_LABELS = {

    en: {
        received: "🚗 Received",
        diagnostics: "🔍 Diagnostics",
        repair: "🔧 In repair",
        waiting_parts: "⏳ Waiting for parts",
        testing: "🧪 Testing",
        payment: "💰 Awaiting payment",
        ready: "✅ Ready",
        delivered: "🚗 Delivered",
        cancelled: "❌ Cancelled"
    },

    az: {
        received: "🚗 Qəbul edildi",
        diagnostics: "🔍 Diaqnostika",
        repair: "🔧 Təmir gedir",
        waiting_parts: "⏳ Ehtiyat hissələri gözlənilir",
        testing: "🧪 Test edilir",
        payment: "💰 Ödəniş gözlənilir",
        ready: "✅ Hazırdır",
        delivered: "🚗 Təhvil verildi",
        cancelled: "❌ Ləğv edildi"
    },

    tr: {
        received: "🚗 Kabul edildi",
        diagnostics: "🔍 Diyagnostik",
        repair: "🔧 Onarım devam ediyor",
        waiting_parts: "⏳ Yedek parça bekleniyor",
        testing: "🧪 Test ediliyor",
        payment: "💰 Ödeme bekleniyor",
        ready: "✅ Hazır",
        delivered: "🚗 Teslim edildi",
        cancelled: "❌ İptal edildi"
    },

    pl: {
        received: "🚗 Przyjęto",
        diagnostics: "🔍 Diagnostyka",
        repair: "🔧 W naprawie",
        waiting_parts: "⏳ Oczekiwanie na części",
        testing: "🧪 Testowanie",
        payment: "💰 Oczekiwanie na płatność",
        ready: "✅ Gotowe",
        delivered: "🚗 Wydano",
        cancelled: "❌ Anulowano"
    },

    // Used by the admin panel's status dropdown/labels (admin languages
    // include German, which the customer-facing bot does not support).
    de: {
        received: "🚗 Angenommen",
        diagnostics: "🔍 Diagnose",
        repair: "🔧 In Reparatur",
        waiting_parts: "⏳ Warten auf Ersatzteile",
        testing: "🧪 Wird getestet",
        payment: "💰 Zahlung ausstehend",
        ready: "✅ Fertig",
        delivered: "🚗 Ausgeliefert",
        cancelled: "❌ Storniert"
    },

    ru: {
        received: "🚗 Принято",
        diagnostics: "🔍 Диагностика",
        repair: "🔧 В ремонте",
        waiting_parts: "⏳ Ожидание запчастей",
        testing: "🧪 Тестирование",
        payment: "💰 Ожидание оплаты",
        ready: "✅ Готово",
        delivered: "🚗 Выдано",
        cancelled: "❌ Отменено"
    }
};


// --------------------------------------------------
// STATUS CHANGE NOTIFICATION MESSAGES
// (sent to the customer by the admin panel)
// --------------------------------------------------

const STATUS_MESSAGES = {

    en: {
        received: "Your car has been received by the service.",
        diagnostics: "Your car is currently undergoing diagnostics.",
        repair: "Repair work on your car has started.",
        waiting_parts: "We are waiting for the parts needed for the repair.",
        testing: "Repair completed. Your car is now in final testing.",
        payment: "Your car is ready. Payment is required before pickup.",
        ready: "Your car has been repaired and is ready for pickup.",
        delivered: "Your car has been delivered to you.",
        cancelled: "The service process for your car has been stopped."
    },

    az: {
        received: "Avtomobiliniz servisə qəbul edilmişdir.",
        diagnostics: "Avtomobiliniz hazırda diaqnostikadan keçirilir.",
        repair: "Avtomobilinizdə təmir işlərinə başlanılmışdır.",
        waiting_parts: "Təmir üçün lazım olan ehtiyat hissələri gözlənilir.",
        testing: "Təmir tamamlanıb. Avtomobiliniz hazırda son test mərhələsindədir.",
        payment: "Avtomobiliniz hazırdır. Təhvil üçün ödəniş gözlənilir.",
        ready: "Avtomobiliniz təmir olunub və təhvil üçün hazırdır.",
        delivered: "Avtomobiliniz sizə təhvil verilmişdir.",
        cancelled: "Avtomobiliniz üzrə servis prosesi dayandırılmışdır."
    },

    tr: {
        received: "Aracınız servise kabul edildi.",
        diagnostics: "Aracınız şu anda diyagnostikten geçiriliyor.",
        repair: "Aracınızda onarım çalışmalarına başlandı.",
        waiting_parts: "Onarım için gerekli yedek parçalar bekleniyor.",
        testing: "Onarım tamamlandı. Aracınız son test aşamasında.",
        payment: "Aracınız hazır. Teslimat için ödeme bekleniyor.",
        ready: "Aracınız onarıldı ve teslim almaya hazır.",
        delivered: "Aracınız size teslim edildi.",
        cancelled: "Aracınızla ilgili servis süreci durduruldu."
    },

    pl: {
        received: "Twój samochód został przyjęty do serwisu.",
        diagnostics: "Twój samochód jest obecnie diagnozowany.",
        repair: "Rozpoczęto naprawę Twojego samochodu.",
        waiting_parts: "Oczekujemy na części potrzebne do naprawy.",
        testing: "Naprawa zakończona. Twój samochód przechodzi testy końcowe.",
        payment: "Twój samochód jest gotowy. Przed odbiorem wymagana jest płatność.",
        ready: "Twój samochód został naprawiony i jest gotowy do odbioru.",
        delivered: "Twój samochód został wydany.",
        cancelled: "Proces serwisowy Twojego samochodu został zatrzymany."
    },

    ru: {
        received: "Ваш автомобиль принят в сервис.",
        diagnostics: "В настоящее время проводится диагностика вашего автомобиля.",
        repair: "Начаты ремонтные работы по вашему автомобилю.",
        waiting_parts: "Ожидаются запчасти, необходимые для ремонта.",
        testing: "Ремонт завершён. Автомобиль проходит финальное тестирование.",
        payment: "Ваш автомобиль готов. Перед выдачей требуется оплата.",
        ready: "Ваш автомобиль отремонтирован и готов к выдаче.",
        delivered: "Ваш автомобиль выдан вам.",
        cancelled: "Процесс обслуживания вашего автомобиля остановлен."
    }
};


// --------------------------------------------------
// GENERAL STRINGS
// --------------------------------------------------

const STRINGS = {

    en: {
        no_car_linked: "❌ No car is linked to your Telegram account.",
        no_cars: "🚗 There are no cars linked to your Telegram account.",
        db_error: "❌ There was a problem connecting to the database.",
        welcome: "🤖 *AutoCore*\n\n🏢 Service: {{name}}\n📍 Address: {{address}}\n📞 Phone: {{phone}}",
        car_not_found: "❌ This car was not found.",
        connect_confirm: "🚗 *{{brand}} {{model}}*\n\n🔢 Registration: {{registration}}\n\nDo you want to link this car to your Telegram account?",
        btn_connect: "✅ Link this car to my account",
        btn_cancel: "❌ Cancel",
        unknown_link: "❌ Unrecognized link.",
        customer_create_error: "❌ Could not create customer.",
        car_already_linked: "❌ This car is already linked to another account.",
        car_connect_error: "❌ Could not link the car.",
        car_connected_alert: "✅ Car linked to your account!",
        car_connected_text: "✅ *Car linked to your account!*\n\nYou can see your car's information below.",
        cancelled_text: "❌ Car was not linked.",
        customer_not_found: "❌ Customer not found.",
        car_not_linked_to_you: "❌ This car is not linked to your account.",
        status_block: "🚗 *{{brand}} {{model}}*\n\n🔢 Registration: {{registration}}\n\n━━━━━━━━━━━━━━\n\n📊 *Current status:*\n\n{{status}}\n\n🕐 Last updated:\n{{date}}",
        car_card: "🚗 *{{brand}} {{model}}*\n\n🔢 Registration: {{registration}}\n\n📊 *Current status:*\n\n{{status}}",
        btn_status_check: "🔄 Check status",
        btn_history: "📋 Status history",
        btn_info: "🚗 Car info",
        btn_contact: "📞 Contact service",
        btn_back: "⬅️ Back",
        history_title: "📋 *{{brand}} {{model}} — Status history*\n\n",
        history_empty: "No status changes yet.",
        history_item: "{{status}}\n🕐 {{date}}\n\n",
        info_title: "🚗 *Car information*\n\n",
        info_brand: "Brand: *{{brand}}*\n",
        info_model: "Model: *{{model}}*\n",
        info_registration: "Registration: *{{registration}}*\n",
        info_vin: "VIN: *{{vin}}*\n\n",
        info_problem_label: "🛠 Problem:\n",
        info_not_specified: "Not specified",
        contact_title: "📞 *Contact service*\n\n",
        contact_phone_missing: "Phone not specified",
        contact_address_missing: "Address not specified",
        status_updated_title: "🔄 *Status updated*\n\n",
        language_prompt: "🌐 Please choose your language:",
        language_set: "✅ Language set to {{language}}",
        btn_delete: "🗑 Delete vehicle",
        btn_delete_confirm: "🗑 Delete",
        btn_delete_cancel: "❌ Cancel",
        delete_confirm: "⚠️ *{{brand}} {{model}}* ({{registration}})\n\nAre you sure you want to delete this vehicle?\nThis action cannot be undone.",
        delete_success: "✅ Vehicle deleted.",
        delete_cancelled: "❌ Deletion cancelled.",
        delete_error: "❌ Could not delete the vehicle. Please try again.",
        company_archived: "❌ This service is currently unavailable. Please contact the workshop directly.",
        onboarding_generic: "🤖 *AutoCore*\n\nWelcome! To see your vehicle's status, please scan the QR code or open the link provided by your workshop.",
        car_different_company: "❌ Your Telegram account is already registered with a different workshop. Please contact support if you believe this is a mistake.",
        menu_btn_status: "📊 Status",
        menu_btn_language: "🌐 Language",
        keyboard_hint: "You can always check your status or change language using the buttons below."
    },

    az: {
        no_car_linked: "❌ Telegram hesabınıza bağlı avtomobil tapılmadı.",
        no_cars: "🚗 Telegram hesabınıza bağlı avtomobil yoxdur.",
        db_error: "❌ Database bağlantısında problem yarandı.",
        welcome: "🤖 *AutoCore*\n\n🏢 Servis: {{name}}\n📍 Ünvan: {{address}}\n📞 Telefon: {{phone}}",
        car_not_found: "❌ Bu avtomobil tapılmadı.",
        connect_confirm: "🚗 *{{brand}} {{model}}*\n\n🔢 Qeydiyyat: {{registration}}\n\nBu avtomobili Telegram hesabınıza bağlamaq istəyirsiniz?",
        btn_connect: "✅ Bu avtomobili mənim hesabıma bağla",
        btn_cancel: "❌ Ləğv et",
        unknown_link: "❌ Tanınmayan bağlantı.",
        customer_create_error: "❌ Müştəri yaratmaq mümkün olmadı.",
        car_already_linked: "❌ Bu avtomobil artıq başqa hesaba bağlıdır.",
        car_connect_error: "❌ Avtomobili bağlamaq mümkün olmadı.",
        car_connected_alert: "✅ Avtomobil hesabınıza bağlandı!",
        car_connected_text: "✅ *Avtomobil hesabınıza bağlandı!*\n\nAşağıdan avtomobiliniz haqqında məlumatı görə bilərsiniz.",
        cancelled_text: "❌ Avtomobil qoşulmadı.",
        customer_not_found: "❌ Müştəri tapılmadı.",
        car_not_linked_to_you: "❌ Bu avtomobil sizin hesabınıza bağlı deyil.",
        status_block: "🚗 *{{brand}} {{model}}*\n\n🔢 Qeydiyyat: {{registration}}\n\n━━━━━━━━━━━━━━\n\n📊 *Hazırkı status:*\n\n{{status}}\n\n🕐 Son yenilənmə:\n{{date}}",
        car_card: "🚗 *{{brand}} {{model}}*\n\n🔢 Qeydiyyat: {{registration}}\n\n📊 *Hazırkı status:*\n\n{{status}}",
        btn_status_check: "🔄 Statusu yoxla",
        btn_history: "📋 Status tarixçəsi",
        btn_info: "🚗 Maşın məlumatları",
        btn_contact: "📞 Servislə əlaqə",
        btn_back: "⬅️ Geri",
        history_title: "📋 *{{brand}} {{model}} — Status tarixçəsi*\n\n",
        history_empty: "Hələ status dəyişiklikləri yoxdur.",
        history_item: "{{status}}\n🕐 {{date}}\n\n",
        info_title: "🚗 *Avtomobil məlumatları*\n\n",
        info_brand: "Marka: *{{brand}}*\n",
        info_model: "Model: *{{model}}*\n",
        info_registration: "Qeydiyyat: *{{registration}}*\n",
        info_vin: "VIN: *{{vin}}*\n\n",
        info_problem_label: "🛠 Problem:\n",
        info_not_specified: "Qeyd edilməyib",
        contact_title: "📞 *Servislə əlaqə*\n\n",
        contact_phone_missing: "Telefon qeyd edilməyib",
        contact_address_missing: "Ünvan qeyd edilməyib",
        status_updated_title: "🔄 *Status yeniləndi*\n\n",
        language_prompt: "🌐 Zəhmət olmasa dilinizi seçin:",
        language_set: "✅ Dil dəyişdirildi: {{language}}",
        btn_delete: "🗑 Avtomobili sil",
        btn_delete_confirm: "🗑 Sil",
        btn_delete_cancel: "❌ Ləğv et",
        delete_confirm: "⚠️ *{{brand}} {{model}}* ({{registration}})\n\nBu avtomobili silmək istədiyinizə əminsiniz?\nBu əməliyyat geri qaytarıla bilməz.",
        delete_success: "✅ Avtomobil silindi.",
        delete_cancelled: "❌ Silinmə ləğv edildi.",
        delete_error: "❌ Avtomobili silmək mümkün olmadı. Zəhmət olmasa yenidən cəhd edin.",
        company_archived: "❌ Bu servis hazırda əlçatan deyil. Zəhmət olmasa birbaşa servislə əlaqə saxlayın.",
        onboarding_generic: "🤖 *AutoCore*\n\nXoş gəlmisiniz! Avtomobilinizin statusunu görmək üçün zəhmət olmasa servisinizin təqdim etdiyi QR kodu skan edin və ya linki açın.",
        car_different_company: "❌ Telegram hesabınız artıq başqa bir servisə qeydiyyatdan keçib. Bunun səhv olduğunu düşünürsünüzsə, dəstək xidməti ilə əlaqə saxlayın.",
        menu_btn_status: "📊 Status",
        menu_btn_language: "🌐 Dil",
        keyboard_hint: "Aşağıdakı düymələrdən istifadə edərək istənilən vaxt statusunuzu yoxlaya və ya dili dəyişə bilərsiniz."
    },

    tr: {
        no_car_linked: "❌ Telegram hesabınıza bağlı araç bulunamadı.",
        no_cars: "🚗 Telegram hesabınıza bağlı araç yok.",
        db_error: "❌ Veritabanı bağlantısında sorun oluştu.",
        welcome: "🤖 *AutoCore*\n\n🏢 Servis: {{name}}\n📍 Adres: {{address}}\n📞 Telefon: {{phone}}",
        car_not_found: "❌ Bu araç bulunamadı.",
        connect_confirm: "🚗 *{{brand}} {{model}}*\n\n🔢 Plaka: {{registration}}\n\nBu aracı Telegram hesabınıza bağlamak istiyor musunuz?",
        btn_connect: "✅ Bu aracı hesabıma bağla",
        btn_cancel: "❌ İptal et",
        unknown_link: "❌ Tanınmayan bağlantı.",
        customer_create_error: "❌ Müşteri oluşturulamadı.",
        car_already_linked: "❌ Bu araç zaten başka bir hesaba bağlı.",
        car_connect_error: "❌ Araç bağlanamadı.",
        car_connected_alert: "✅ Araç hesabınıza bağlandı!",
        car_connected_text: "✅ *Araç hesabınıza bağlandı!*\n\nAşağıda aracınızla ilgili bilgileri görebilirsiniz.",
        cancelled_text: "❌ Araç bağlanmadı.",
        customer_not_found: "❌ Müşteri bulunamadı.",
        car_not_linked_to_you: "❌ Bu araç hesabınıza bağlı değil.",
        status_block: "🚗 *{{brand}} {{model}}*\n\n🔢 Plaka: {{registration}}\n\n━━━━━━━━━━━━━━\n\n📊 *Güncel durum:*\n\n{{status}}\n\n🕐 Son güncelleme:\n{{date}}",
        car_card: "🚗 *{{brand}} {{model}}*\n\n🔢 Plaka: {{registration}}\n\n📊 *Güncel durum:*\n\n{{status}}",
        btn_status_check: "🔄 Durumu kontrol et",
        btn_history: "📋 Durum geçmişi",
        btn_info: "🚗 Araç bilgileri",
        btn_contact: "📞 Servisle iletişim",
        btn_back: "⬅️ Geri",
        history_title: "📋 *{{brand}} {{model}} — Durum geçmişi*\n\n",
        history_empty: "Henüz durum değişikliği yok.",
        history_item: "{{status}}\n🕐 {{date}}\n\n",
        info_title: "🚗 *Araç bilgileri*\n\n",
        info_brand: "Marka: *{{brand}}*\n",
        info_model: "Model: *{{model}}*\n",
        info_registration: "Plaka: *{{registration}}*\n",
        info_vin: "VIN: *{{vin}}*\n\n",
        info_problem_label: "🛠 Sorun:\n",
        info_not_specified: "Belirtilmemiş",
        contact_title: "📞 *Servisle iletişim*\n\n",
        contact_phone_missing: "Telefon belirtilmemiş",
        contact_address_missing: "Adres belirtilmemiş",
        status_updated_title: "🔄 *Durum güncellendi*\n\n",
        language_prompt: "🌐 Lütfen dilinizi seçin:",
        language_set: "✅ Dil değiştirildi: {{language}}",
        btn_delete: "🗑 Aracı sil",
        btn_delete_confirm: "🗑 Sil",
        btn_delete_cancel: "❌ İptal",
        delete_confirm: "⚠️ *{{brand}} {{model}}* ({{registration}})\n\nBu aracı silmek istediğinizden emin misiniz?\nBu işlem geri alınamaz.",
        delete_success: "✅ Araç silindi.",
        delete_cancelled: "❌ Silme işlemi iptal edildi.",
        delete_error: "❌ Araç silinemedi. Lütfen tekrar deneyin.",
        company_archived: "❌ Bu servis şu anda kullanılamıyor. Lütfen servisle doğrudan iletişime geçin.",
        onboarding_generic: "🤖 *AutoCore*\n\nHoş geldiniz! Aracınızın durumunu görmek için lütfen servisinizin verdiği QR kodu tarayın veya bağlantıyı açın.",
        car_different_company: "❌ Telegram hesabınız zaten başka bir servise kayıtlı. Bunun bir hata olduğunu düşünüyorsanız lütfen destek ile iletişime geçin.",
        menu_btn_status: "📊 Durum",
        menu_btn_language: "🌐 Dil",
        keyboard_hint: "Aşağıdaki düğmeleri kullanarak istediğiniz zaman durumunuzu kontrol edebilir veya dili değiştirebilirsiniz."
    },

    pl: {
        no_car_linked: "❌ Do Twojego konta Telegram nie jest przypisany żaden samochód.",
        no_cars: "🚗 Nie masz samochodów przypisanych do konta Telegram.",
        db_error: "❌ Wystąpił problem z połączeniem z bazą danych.",
        welcome: "🤖 *AutoCore*\n\n🏢 Serwis: {{name}}\n📍 Adres: {{address}}\n📞 Telefon: {{phone}}",
        car_not_found: "❌ Nie znaleziono tego samochodu.",
        connect_confirm: "🚗 *{{brand}} {{model}}*\n\n🔢 Rejestracja: {{registration}}\n\nCzy chcesz przypisać ten samochód do swojego konta Telegram?",
        btn_connect: "✅ Przypisz ten samochód do mojego konta",
        btn_cancel: "❌ Anuluj",
        unknown_link: "❌ Nierozpoznany link.",
        customer_create_error: "❌ Nie udało się utworzyć klienta.",
        car_already_linked: "❌ Ten samochód jest już przypisany do innego konta.",
        car_connect_error: "❌ Nie udało się przypisać samochodu.",
        car_connected_alert: "✅ Samochód przypisany do Twojego konta!",
        car_connected_text: "✅ *Samochód przypisany do Twojego konta!*\n\nPoniżej znajdziesz informacje o swoim samochodzie.",
        cancelled_text: "❌ Samochód nie został przypisany.",
        customer_not_found: "❌ Nie znaleziono klienta.",
        car_not_linked_to_you: "❌ Ten samochód nie jest przypisany do Twojego konta.",
        status_block: "🚗 *{{brand}} {{model}}*\n\n🔢 Rejestracja: {{registration}}\n\n━━━━━━━━━━━━━━\n\n📊 *Aktualny status:*\n\n{{status}}\n\n🕐 Ostatnia aktualizacja:\n{{date}}",
        car_card: "🚗 *{{brand}} {{model}}*\n\n🔢 Rejestracja: {{registration}}\n\n📊 *Aktualny status:*\n\n{{status}}",
        btn_status_check: "🔄 Sprawdź status",
        btn_history: "📋 Historia statusów",
        btn_info: "🚗 Informacje o samochodzie",
        btn_contact: "📞 Kontakt z serwisem",
        btn_back: "⬅️ Wstecz",
        history_title: "📋 *{{brand}} {{model}} — Historia statusów*\n\n",
        history_empty: "Brak zmian statusu.",
        history_item: "{{status}}\n🕐 {{date}}\n\n",
        info_title: "🚗 *Informacje o samochodzie*\n\n",
        info_brand: "Marka: *{{brand}}*\n",
        info_model: "Model: *{{model}}*\n",
        info_registration: "Rejestracja: *{{registration}}*\n",
        info_vin: "VIN: *{{vin}}*\n\n",
        info_problem_label: "🛠 Problem:\n",
        info_not_specified: "Nie podano",
        contact_title: "📞 *Kontakt z serwisem*\n\n",
        contact_phone_missing: "Nie podano telefonu",
        contact_address_missing: "Nie podano adresu",
        status_updated_title: "🔄 *Status zaktualizowany*\n\n",
        language_prompt: "🌐 Wybierz swój język:",
        language_set: "✅ Język zmieniony na: {{language}}",
        btn_delete: "🗑 Usuń pojazd",
        btn_delete_confirm: "🗑 Usuń",
        btn_delete_cancel: "❌ Anuluj",
        delete_confirm: "⚠️ *{{brand}} {{model}}* ({{registration}})\n\nCzy na pewno chcesz usunąć ten pojazd?\nTej operacji nie można cofnąć.",
        delete_success: "✅ Pojazd usunięty.",
        delete_cancelled: "❌ Usuwanie anulowane.",
        delete_error: "❌ Nie udało się usunąć pojazdu. Spróbuj ponownie.",
        company_archived: "❌ Ten serwis jest obecnie niedostępny. Skontaktuj się bezpośrednio z warsztatem.",
        onboarding_generic: "🤖 *AutoCore*\n\nWitamy! Aby zobaczyć status swojego pojazdu, zeskanuj kod QR lub otwórz link otrzymany od swojego warsztatu.",
        car_different_company: "❌ Twoje konto Telegram jest już zarejestrowane w innym warsztacie. Jeśli uważasz, że to pomyłka, skontaktuj się z pomocą techniczną.",
        menu_btn_status: "📊 Status",
        menu_btn_language: "🌐 Język",
        keyboard_hint: "Za pomocą przycisków poniżej możesz zawsze sprawdzić status lub zmienić język."
    },

    ru: {
        no_car_linked: "❌ К вашему аккаунту Telegram не привязан автомобиль.",
        no_cars: "🚗 У вас нет автомобилей, привязанных к аккаунту Telegram.",
        db_error: "❌ Возникла проблема с подключением к базе данных.",
        welcome: "🤖 *AutoCore*\n\n🏢 Сервис: {{name}}\n📍 Адрес: {{address}}\n📞 Телефон: {{phone}}",
        car_not_found: "❌ Этот автомобиль не найден.",
        connect_confirm: "🚗 *{{brand}} {{model}}*\n\n🔢 Гос. номер: {{registration}}\n\nПривязать этот автомобиль к вашему аккаунту Telegram?",
        btn_connect: "✅ Привязать этот автомобиль к моему аккаунту",
        btn_cancel: "❌ Отмена",
        unknown_link: "❌ Нераспознанная ссылка.",
        customer_create_error: "❌ Не удалось создать клиента.",
        car_already_linked: "❌ Этот автомобиль уже привязан к другому аккаунту.",
        car_connect_error: "❌ Не удалось привязать автомобиль.",
        car_connected_alert: "✅ Автомобиль привязан к вашему аккаунту!",
        car_connected_text: "✅ *Автомобиль привязан к вашему аккаунту!*\n\nНиже вы можете увидеть информацию о вашем автомобиле.",
        cancelled_text: "❌ Автомобиль не был привязан.",
        customer_not_found: "❌ Клиент не найден.",
        car_not_linked_to_you: "❌ Этот автомобиль не привязан к вашему аккаунту.",
        status_block: "🚗 *{{brand}} {{model}}*\n\n🔢 Гос. номер: {{registration}}\n\n━━━━━━━━━━━━━━\n\n📊 *Текущий статус:*\n\n{{status}}\n\n🕐 Последнее обновление:\n{{date}}",
        car_card: "🚗 *{{brand}} {{model}}*\n\n🔢 Гос. номер: {{registration}}\n\n📊 *Текущий статус:*\n\n{{status}}",
        btn_status_check: "🔄 Проверить статус",
        btn_history: "📋 История статусов",
        btn_info: "🚗 Информация об автомобиле",
        btn_contact: "📞 Связаться с сервисом",
        btn_back: "⬅️ Назад",
        history_title: "📋 *{{brand}} {{model}} — История статусов*\n\n",
        history_empty: "Изменений статуса пока нет.",
        history_item: "{{status}}\n🕐 {{date}}\n\n",
        info_title: "🚗 *Информация об автомобиле*\n\n",
        info_brand: "Марка: *{{brand}}*\n",
        info_model: "Модель: *{{model}}*\n",
        info_registration: "Гос. номер: *{{registration}}*\n",
        info_vin: "VIN: *{{vin}}*\n\n",
        info_problem_label: "🛠 Проблема:\n",
        info_not_specified: "Не указано",
        contact_title: "📞 *Связь с сервисом*\n\n",
        contact_phone_missing: "Телефон не указан",
        contact_address_missing: "Адрес не указан",
        status_updated_title: "🔄 *Статус обновлён*\n\n",
        language_prompt: "🌐 Пожалуйста, выберите язык:",
        language_set: "✅ Язык изменён на: {{language}}",
        btn_delete: "🗑 Удалить автомобиль",
        btn_delete_confirm: "🗑 Удалить",
        btn_delete_cancel: "❌ Отмена",
        delete_confirm: "⚠️ *{{brand}} {{model}}* ({{registration}})\n\nВы уверены, что хотите удалить этот автомобиль?\nЭто действие нельзя отменить.",
        delete_success: "✅ Автомобиль удалён.",
        delete_cancelled: "❌ Удаление отменено.",
        delete_error: "❌ Не удалось удалить автомобиль. Попробуйте ещё раз.",
        company_archived: "❌ Этот сервис временно недоступен. Пожалуйста, свяжитесь с сервисом напрямую.",
        onboarding_generic: "🤖 *AutoCore*\n\nДобро пожаловать! Чтобы увидеть статус вашего автомобиля, отсканируйте QR-код или откройте ссылку, предоставленную вашим сервисом.",
        car_different_company: "❌ Ваш аккаунт Telegram уже зарегистрирован в другом сервисе. Если вы считаете, что это ошибка, свяжитесь с поддержкой.",
        menu_btn_status: "📊 Статус",
        menu_btn_language: "🌐 Язык",
        keyboard_hint: "Вы всегда можете проверить статус или изменить язык с помощью кнопок ниже."
    }
};


// ==================================================
// ADMIN PANEL TRANSLATIONS
// (separate namespace from the customer bot strings above —
// independent language list, independent default, independent keys)
// ==================================================

const ADMIN_LANGS = ["pl", "en", "de", "tr", "az", "ru"];
const DEFAULT_ADMIN_LANG = "pl";

const ADMIN_LANGUAGE_LABELS = {
    pl: "🇵🇱 Polski",
    en: "🇬🇧 English",
    de: "🇩🇪 Deutsch",
    tr: "🇹🇷 Türkçe",
    az: "🇦🇿 Azərbaycan dili",
    ru: "🇷🇺 Русский"
};


const ADMIN_STRINGS = {

    en: {
        dashboard_title: "AutoCore Admin",
        add_car_page_title: "New car - AutoCore",
        login_subtitle: "Admin Panel",
        login_username_placeholder: "Username",
        login_password_placeholder: "Password",
        login_button: "Login",
        login_error_title: "❌ Incorrect username or password.",
        go_back: "Go back",
        app_tagline: "Admin Panel",
        nav_cars_heading: "🚗 Cars",
        nav_add_car: "+ New car",
        no_cars_yet: "No cars yet.",
        search_placeholder: "🔍 Search by registration or customer...",
        registration_missing: "No registration",
        customer_missing: "No customer",
        change_status_button: "Change status",
        qr_button: "📱 QR",
        logout_button: "Logout",
        database_error: "❌ Database error.",
        add_car_title: "➕ New car",
        label_customer: "Customer",
        select_customer_placeholder: "Select customer",
        label_brand: "Brand",
        label_model: "Model",
        label_registration: "Registration number",
        label_vin: "VIN",
        label_problem: "Problem",
        placeholder_problem: "Problem described by the customer",
        create_car_button: "🚗 Create car",
        create_car_loading: "⏳ Creating vehicle...",
        car_create_error_title: "❌ Car was not created",
        qr_heading: "📱 Customer QR code",
        qr_instructions: "The customer should scan this QR code with their phone.",
        qr_print_button: "🖨️ Print QR code",
        back_to_admin: "← Back to admin panel",
        car_not_found_title: "❌ Car not found",
        status_update_error_title: "❌ Status was not updated",
        language_label: "🌐 Language",
        account_suspended: "❌ This company's account has been suspended. Please contact support.",
        account_archived: "❌ This company's account has been archived. Please contact support.",
        delete_car_button: "🗑 Delete",
        delete_confirm_title: "⚠️ Delete vehicle",
        delete_confirm_warning: "Are you sure you want to delete this vehicle? This action cannot be undone.",
        btn_delete_confirm: "🗑 Delete",
        btn_delete_cancel: "Cancel",
        delete_success_notice: "✅ Vehicle deleted.",
        delete_error_title: "❌ Could not delete the vehicle",
        label_phone: "Phone number",
        new_customer_heading: "— or create a new customer —",
        label_new_customer_name: "New customer name",
        label_new_customer_phone: "New customer phone number",
        phone_missing: "No phone number",
        edit_customer_link: "✏️ Edit customer",
        edit_customer_title: "✏️ Edit customer",
        save_button: "💾 Save",
        customer_update_error_title: "❌ Could not update customer"
    },

    pl: {
        dashboard_title: "AutoCore Admin",
        add_car_page_title: "Nowy samochód - AutoCore",
        login_subtitle: "Panel administracyjny",
        login_username_placeholder: "Nazwa użytkownika",
        login_password_placeholder: "Hasło",
        login_button: "Zaloguj się",
        login_error_title: "❌ Nieprawidłowa nazwa użytkownika lub hasło.",
        go_back: "Wróć",
        app_tagline: "Panel administracyjny",
        nav_cars_heading: "🚗 Samochody",
        nav_add_car: "+ Nowy samochód",
        no_cars_yet: "Brak samochodów.",
        search_placeholder: "🔍 Szukaj po rejestracji lub kliencie...",
        registration_missing: "Brak rejestracji",
        customer_missing: "Brak klienta",
        change_status_button: "Zmień status",
        qr_button: "📱 QR",
        logout_button: "Wyloguj się",
        database_error: "❌ Błąd bazy danych.",
        add_car_title: "➕ Nowy samochód",
        label_customer: "Klient",
        select_customer_placeholder: "Wybierz klienta",
        label_brand: "Marka",
        label_model: "Model",
        label_registration: "Numer rejestracyjny",
        label_vin: "VIN",
        label_problem: "Problem",
        placeholder_problem: "Problem zgłoszony przez klienta",
        create_car_button: "🚗 Utwórz samochód",
        create_car_loading: "⏳ Tworzenie pojazdu...",
        car_create_error_title: "❌ Samochód nie został utworzony",
        qr_heading: "📱 Kod QR klienta",
        qr_instructions: "Klient powinien zeskanować ten kod QR telefonem.",
        qr_print_button: "🖨️ Drukuj kod QR",
        back_to_admin: "← Wróć do panelu administracyjnego",
        car_not_found_title: "❌ Nie znaleziono samochodu",
        status_update_error_title: "❌ Status nie został zmieniony",
        language_label: "🌐 Język",
        account_suspended: "❌ Konto tej firmy zostało zawieszone. Skontaktuj się z pomocą techniczną.",
        account_archived: "❌ Konto tej firmy zostało zarchiwizowane. Skontaktuj się z pomocą techniczną.",
        delete_car_button: "🗑 Usuń",
        delete_confirm_title: "⚠️ Usuń samochód",
        delete_confirm_warning: "Czy na pewno chcesz usunąć ten samochód? Tej operacji nie można cofnąć.",
        btn_delete_confirm: "🗑 Usuń",
        btn_delete_cancel: "Anuluj",
        delete_success_notice: "✅ Samochód usunięty.",
        delete_error_title: "❌ Nie udało się usunąć samochodu",
        label_phone: "Numer telefonu",
        new_customer_heading: "— lub utwórz nowego klienta —",
        label_new_customer_name: "Imię nowego klienta",
        label_new_customer_phone: "Numer telefonu nowego klienta",
        phone_missing: "Brak numeru telefonu",
        edit_customer_link: "✏️ Edytuj klienta",
        edit_customer_title: "✏️ Edytuj klienta",
        save_button: "💾 Zapisz",
        customer_update_error_title: "❌ Nie udało się zaktualizować klienta"
    },

    de: {
        dashboard_title: "AutoCore Admin",
        add_car_page_title: "Neues Fahrzeug - AutoCore",
        login_subtitle: "Admin-Bereich",
        login_username_placeholder: "Benutzername",
        login_password_placeholder: "Passwort",
        login_button: "Anmelden",
        login_error_title: "❌ Benutzername oder Passwort falsch.",
        go_back: "Zurück",
        app_tagline: "Admin-Bereich",
        nav_cars_heading: "🚗 Fahrzeuge",
        nav_add_car: "+ Neues Fahrzeug",
        no_cars_yet: "Noch keine Fahrzeuge.",
        search_placeholder: "🔍 Suche nach Kennzeichen oder Kunde...",
        registration_missing: "Kein Kennzeichen",
        customer_missing: "Kein Kunde",
        change_status_button: "Status ändern",
        qr_button: "📱 QR",
        logout_button: "Abmelden",
        database_error: "❌ Datenbankfehler.",
        add_car_title: "➕ Neues Fahrzeug",
        label_customer: "Kunde",
        select_customer_placeholder: "Kunde auswählen",
        label_brand: "Marke",
        label_model: "Modell",
        label_registration: "Kennzeichen",
        label_vin: "Fahrgestellnummer (VIN)",
        label_problem: "Problem",
        placeholder_problem: "Vom Kunden beschriebenes Problem",
        create_car_button: "🚗 Fahrzeug anlegen",
        create_car_loading: "⏳ Fahrzeug wird angelegt...",
        car_create_error_title: "❌ Fahrzeug wurde nicht angelegt",
        qr_heading: "📱 QR-Code für den Kunden",
        qr_instructions: "Der Kunde sollte diesen QR-Code mit dem Telefon scannen.",
        qr_print_button: "🖨️ QR-Code drucken",
        back_to_admin: "← Zurück zum Admin-Bereich",
        car_not_found_title: "❌ Fahrzeug nicht gefunden",
        status_update_error_title: "❌ Status wurde nicht geändert",
        language_label: "🌐 Sprache",
        account_suspended: "❌ Das Konto dieses Unternehmens wurde gesperrt. Bitte kontaktieren Sie den Support.",
        account_archived: "❌ Das Konto dieses Unternehmens wurde archiviert. Bitte kontaktieren Sie den Support.",
        delete_car_button: "🗑 Löschen",
        delete_confirm_title: "⚠️ Fahrzeug löschen",
        delete_confirm_warning: "Möchten Sie dieses Fahrzeug wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.",
        btn_delete_confirm: "🗑 Löschen",
        btn_delete_cancel: "Abbrechen",
        delete_success_notice: "✅ Fahrzeug gelöscht.",
        delete_error_title: "❌ Fahrzeug konnte nicht gelöscht werden",
        label_phone: "Telefonnummer",
        new_customer_heading: "— oder neuen Kunden anlegen —",
        label_new_customer_name: "Name des neuen Kunden",
        label_new_customer_phone: "Telefonnummer des neuen Kunden",
        phone_missing: "Keine Telefonnummer",
        edit_customer_link: "✏️ Kunde bearbeiten",
        edit_customer_title: "✏️ Kunde bearbeiten",
        save_button: "💾 Speichern",
        customer_update_error_title: "❌ Kunde konnte nicht aktualisiert werden"
    },

    tr: {
        dashboard_title: "AutoCore Admin",
        add_car_page_title: "Yeni araç - AutoCore",
        login_subtitle: "Yönetim Paneli",
        login_username_placeholder: "Kullanıcı adı",
        login_password_placeholder: "Şifre",
        login_button: "Giriş yap",
        login_error_title: "❌ Kullanıcı adı veya şifre hatalı.",
        go_back: "Geri dön",
        app_tagline: "Yönetim Paneli",
        nav_cars_heading: "🚗 Araçlar",
        nav_add_car: "+ Yeni araç",
        no_cars_yet: "Henüz araç yok.",
        search_placeholder: "🔍 Plaka veya müşteriye göre ara...",
        registration_missing: "Plaka yok",
        customer_missing: "Müşteri yok",
        change_status_button: "Durumu değiştir",
        qr_button: "📱 QR",
        logout_button: "Çıkış yap",
        database_error: "❌ Veritabanı hatası.",
        add_car_title: "➕ Yeni araç",
        label_customer: "Müşteri",
        select_customer_placeholder: "Müşteri seç",
        label_brand: "Marka",
        label_model: "Model",
        label_registration: "Plaka numarası",
        label_vin: "VIN",
        label_problem: "Sorun",
        placeholder_problem: "Müşterinin belirttiği sorun",
        create_car_button: "🚗 Aracı oluştur",
        create_car_loading: "⏳ Araç oluşturuluyor...",
        car_create_error_title: "❌ Araç oluşturulamadı",
        qr_heading: "📱 Müşteri QR kodu",
        qr_instructions: "Müşteri bu QR kodu telefonuyla taramalıdır.",
        qr_print_button: "🖨️ QR kodu yazdır",
        back_to_admin: "← Yönetim paneline dön",
        car_not_found_title: "❌ Araç bulunamadı",
        status_update_error_title: "❌ Durum değiştirilemedi",
        language_label: "🌐 Dil",
        account_suspended: "❌ Bu firmanın hesabı askıya alındı. Lütfen destek ile iletişime geçin.",
        account_archived: "❌ Bu firmanın hesabı arşivlendi. Lütfen destek ile iletişime geçin.",
        delete_car_button: "🗑 Sil",
        delete_confirm_title: "⚠️ Aracı sil",
        delete_confirm_warning: "Bu aracı silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.",
        btn_delete_confirm: "🗑 Sil",
        btn_delete_cancel: "İptal",
        delete_success_notice: "✅ Araç silindi.",
        delete_error_title: "❌ Araç silinemedi",
        label_phone: "Telefon numarası",
        new_customer_heading: "— veya yeni bir müşteri oluştur —",
        label_new_customer_name: "Yeni müşteri adı",
        label_new_customer_phone: "Yeni müşteri telefon numarası",
        phone_missing: "Telefon numarası yok",
        edit_customer_link: "✏️ Müşteriyi düzenle",
        edit_customer_title: "✏️ Müşteriyi düzenle",
        save_button: "💾 Kaydet",
        customer_update_error_title: "❌ Müşteri güncellenemedi"
    },

    az: {
        dashboard_title: "AutoCore Admin",
        add_car_page_title: "Yeni maşın - AutoCore",
        login_subtitle: "Admin Panel",
        login_username_placeholder: "İstifadəçi adı",
        login_password_placeholder: "Şifrə",
        login_button: "Daxil ol",
        login_error_title: "❌ Username və ya password səhvdir.",
        go_back: "Geri qayıt",
        app_tagline: "Admin Panel",
        nav_cars_heading: "🚗 Avtomobillər",
        nav_add_car: "+ Yeni maşın",
        no_cars_yet: "Hələ maşın yoxdur.",
        search_placeholder: "🔍 Qeydiyyat və ya müştəriyə görə axtar...",
        registration_missing: "Qeydiyyat yoxdur",
        customer_missing: "Müştəri yoxdur",
        change_status_button: "Statusu dəyiş",
        qr_button: "📱 QR",
        logout_button: "Çıxış",
        database_error: "❌ Database xətası.",
        add_car_title: "➕ Yeni avtomobil",
        label_customer: "Müştəri",
        select_customer_placeholder: "Müştəri seç",
        label_brand: "Marka",
        label_model: "Model",
        label_registration: "Qeydiyyat nömrəsi",
        label_vin: "VIN",
        label_problem: "Problem",
        placeholder_problem: "Müştərinin bildirdiyi problem",
        create_car_button: "🚗 Maşını yarat",
        create_car_loading: "⏳ Avtomobil yaradılır...",
        car_create_error_title: "❌ Maşın yaradılmadı",
        qr_heading: "📱 Müştəri QR kodu",
        qr_instructions: "Müştəri bu QR kodu telefonla skan etməlidir.",
        qr_print_button: "🖨️ QR kodu çap et",
        back_to_admin: "← Admin panelə qayıt",
        car_not_found_title: "❌ Avtomobil tapılmadı",
        status_update_error_title: "❌ Status dəyişdirilmədi",
        language_label: "🌐 Dil",
        account_suspended: "❌ Bu şirkətin hesabı dayandırılıb. Zəhmət olmasa dəstək xidməti ilə əlaqə saxlayın.",
        account_archived: "❌ Bu şirkətin hesabı arxivləşdirilib. Zəhmət olmasa dəstək xidməti ilə əlaqə saxlayın.",
        delete_car_button: "🗑 Sil",
        delete_confirm_title: "⚠️ Avtomobili sil",
        delete_confirm_warning: "Bu avtomobili silmək istədiyinizə əminsiniz? Bu əməliyyat geri qaytarıla bilməz.",
        btn_delete_confirm: "🗑 Sil",
        btn_delete_cancel: "Ləğv et",
        delete_success_notice: "✅ Avtomobil silindi.",
        delete_error_title: "❌ Avtomobili silmək mümkün olmadı",
        label_phone: "Telefon nömrəsi",
        new_customer_heading: "— və ya yeni müştəri yarat —",
        label_new_customer_name: "Yeni müştərinin adı",
        label_new_customer_phone: "Yeni müştərinin telefon nömrəsi",
        phone_missing: "Telefon nömrəsi yoxdur",
        edit_customer_link: "✏️ Müştərini redaktə et",
        edit_customer_title: "✏️ Müştərini redaktə et",
        save_button: "💾 Yadda saxla",
        customer_update_error_title: "❌ Müştəri yenilənmədi"
    },

    ru: {
        dashboard_title: "AutoCore Admin",
        add_car_page_title: "Новый автомобиль - AutoCore",
        login_subtitle: "Панель администратора",
        login_username_placeholder: "Имя пользователя",
        login_password_placeholder: "Пароль",
        login_button: "Войти",
        login_error_title: "❌ Неверное имя пользователя или пароль.",
        go_back: "Назад",
        app_tagline: "Панель администратора",
        nav_cars_heading: "🚗 Автомобили",
        nav_add_car: "+ Новый автомобиль",
        no_cars_yet: "Пока нет автомобилей.",
        search_placeholder: "🔍 Поиск по номеру или клиенту...",
        registration_missing: "Нет гос. номера",
        customer_missing: "Нет клиента",
        change_status_button: "Изменить статус",
        qr_button: "📱 QR",
        logout_button: "Выйти",
        database_error: "❌ Ошибка базы данных.",
        add_car_title: "➕ Новый автомобиль",
        label_customer: "Клиент",
        select_customer_placeholder: "Выберите клиента",
        label_brand: "Марка",
        label_model: "Модель",
        label_registration: "Гос. номер",
        label_vin: "VIN",
        label_problem: "Проблема",
        placeholder_problem: "Проблема, указанная клиентом",
        create_car_button: "🚗 Создать автомобиль",
        create_car_loading: "⏳ Создание автомобиля...",
        car_create_error_title: "❌ Автомобиль не создан",
        qr_heading: "📱 QR-код клиента",
        qr_instructions: "Клиент должен отсканировать этот QR-код телефоном.",
        qr_print_button: "🖨️ Печать QR-кода",
        back_to_admin: "← Вернуться в админ-панель",
        car_not_found_title: "❌ Автомобиль не найден",
        status_update_error_title: "❌ Статус не был изменён",
        language_label: "🌐 Язык",
        account_suspended: "❌ Аккаунт этой компании приостановлен. Пожалуйста, свяжитесь с поддержкой.",
        account_archived: "❌ Аккаунт этой компании архивирован. Пожалуйста, свяжитесь с поддержкой.",
        delete_car_button: "🗑 Удалить",
        delete_confirm_title: "⚠️ Удалить автомобиль",
        delete_confirm_warning: "Вы уверены, что хотите удалить этот автомобиль? Это действие нельзя отменить.",
        btn_delete_confirm: "🗑 Удалить",
        btn_delete_cancel: "Отмена",
        delete_success_notice: "✅ Автомобиль удалён.",
        delete_error_title: "❌ Не удалось удалить автомобиль",
        label_phone: "Номер телефона",
        new_customer_heading: "— или создать нового клиента —",
        label_new_customer_name: "Имя нового клиента",
        label_new_customer_phone: "Номер телефона нового клиента",
        phone_missing: "Номер телефона не указан",
        edit_customer_link: "✏️ Редактировать клиента",
        edit_customer_title: "✏️ Редактировать клиента",
        save_button: "💾 Сохранить",
        customer_update_error_title: "❌ Не удалось обновить клиента"
    }
};


function normalizeAdminLang(code) {

    if (!code) return null;

    const base = String(code).toLowerCase().split("-")[0];

    return ADMIN_LANGS.includes(base) ? base : null;
}


function at(lang, key, vars) {

    const dict = ADMIN_STRINGS[lang] || ADMIN_STRINGS[DEFAULT_ADMIN_LANG];

    let str = dict[key] !== undefined ? dict[key] : ADMIN_STRINGS[DEFAULT_ADMIN_LANG][key];

    if (vars) {

        for (const [k, v] of Object.entries(vars)) {
            str = str.split(`{{${k}}}`).join(v == null ? "" : String(v));
        }
    }

    return str;
}


function normalizeLang(code) {

    if (!code) return null;

    const base = String(code).toLowerCase().split("-")[0];

    return SUPPORTED_LANGS.includes(base) ? base : null;
}


function resolveLangFromTelegram(ctx) {

    return normalizeLang(ctx.from && ctx.from.language_code) || DEFAULT_LANG;
}


function t(lang, key, vars) {

    const dict = STRINGS[lang] || STRINGS[DEFAULT_LANG];

    let str = dict[key] !== undefined ? dict[key] : STRINGS[DEFAULT_LANG][key];

    if (vars) {

        for (const [k, v] of Object.entries(vars)) {
            str = str.split(`{{${k}}}`).join(v == null ? "" : String(v));
        }
    }

    return str;
}


function statusLabel(lang, status) {

    const dict = STATUS_LABELS[lang] || STATUS_LABELS[DEFAULT_LANG];

    return dict[status] || status;
}


function statusMessage(lang, status) {

    const dict = STATUS_MESSAGES[lang] || STATUS_MESSAGES[DEFAULT_LANG];

    return dict[status] || "";
}


module.exports = {
    SUPPORTED_LANGS,
    DEFAULT_LANG,
    LANGUAGE_LABELS,
    normalizeLang,
    resolveLangFromTelegram,
    t,
    statusLabel,
    statusMessage,

    ADMIN_LANGS,
    DEFAULT_ADMIN_LANG,
    ADMIN_LANGUAGE_LABELS,
    normalizeAdminLang,
    at
};
