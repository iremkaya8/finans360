# Finans360 – Yaşam Maliyeti ve Borç Yönetim Sistemi

Finans360, bireysel finans durumunuzu analiz etmek, yaşam maliyetinizi kontrol altında tutmak, kredi/borç yükümlülüklerinizi planlamak, genel finansal sağlığınızı ölçmek ve hanehalkı ortak giderlerini bölüşmek için geliştirilmiş modern, Türkçe arayüze sahip web tabanlı bir bütçe yönetim sistemidir.

Bu sürümde, veriler tarayıcı hafızası yerine güvenli ve kalıcı bir **SQLite3** veritabanına taşınmış ve çok kullanıcılı **Kayıt/Giriş (Authentication)** oturum sistemi entegre edilmiştir.

---

## Özellikler

- **Çok Kullanıcılı Üyelik Sistemi:** E-posta ve şifrenizle kayıt olabilir, sadece kendinize ait finansal verilere güvenle erişebilirsiniz. Şifreler pbkdf2_hmac (SHA-256) algoritmalarıyla güvenli biçimde hash'lenerek depolanır.
- **Kalıcı SQLite3 Veritabanı:** Bütçe girdileri, limitler, borçlar, hedefler, geçmiş trend raporları ve hane ortak giderleri yerel veritabanında kalıcı olarak saklanır.
- **Yaşam Maliyeti Analizi:** Aylık geliriniz ile zorunlu (kira, market, ulaşım vb.) ve isteğe bağlı harcamalarınızı karşılaştırın. Harcama dağılımınızı anında görün.
- **Limit Takibi ve Bildirim Sistemi:** Harcama kalemlerine bütçe limitleri koyun. Limitlerin %90'ına ulaşıldığında sarı, %100 ve üzerine ulaşıldığında kırmızı uyarı bildirimlerini dashboard üzerinde izleyin.
- **Kredi Kartı Asgari Ödeme Tuzağı:** Kart borcunun sadece asgarisini ödediğinizde karşılaşacağınız bileşik faiz maliyetlerini ve sonsuz borç döngüsü tehlikelerini simüle edin.
- **Tasarruf Hedefleri Planlayıcı:** Tatil, ev, araç gibi hedefler ekleyin. Aylık birikim ihtiyacınız bütçe fazlasını aşıyorsa Finansal Sağlık Skorunuzun buna göre düşmesini ve akıllı önerileri gözlemleyin.
- **Geçmiş Trendler ve 12 Aylık Enflasyon Projeksiyonu:** Son 6 ayın trendlerini izleyin ve maaş artış oranınız ile yıllık enflasyona göre gelecek 12 aylık birikim tahmininizi çizgi grafik üzerinde görün.
- **Hanehalkı Paylaşımlı Bütçe:** Ev arkadaşlarınız veya eşinizle ortak harcamaları bölüşün. Splitwise benzeri borç dengeleme algoritmasıyla kimin kime ne kadar borçlu olduğunu saniyeler içinde hesaplayın.
- **Koyu Tema & Cam Efekti (Glassmorphism):** Göz yormayan şık karanlık arayüz.

---

## Dosya Yapısı

```text
finans360/
├── index.html     # Uygulama arayüzü, formlar ve oturum ekranları (HTML5)
├── styles.css     # Tasarım, responsive grid ve cam efektleri (CSS3)
├── app.js         # Finansal hesaplamalar ve backend API fetch istemcisi (JS)
├── server.py      # Python ve SQLite3 tabanlı API sunucusu
├── finans360.db   # SQLite3 veritabanı dosyası (İlk başlatmada otomatik oluşturulur)
└── README.md      # Bu belge
```

---

## Nasıl Çalıştırılır?

Uygulamanın çalışabilmesi için hem **backend veritabanı sunucusunun** hem de **frontend arayüzünün** başlatılması gerekmektedir. macOS üzerinde Python yerleşik olarak bulunduğundan harici bir paket kurmanıza gerek yoktur.

### 1. Adım: Veritabanı ve API Sunucusunu Başlatın
Terminali açın ve proje dizininde backend sunucusunu çalıştırın:
```bash
cd "/Users/iremkaya/.gemini/antigravity/scratch/finans360"
python3 server.py
```
*API sunucusu varsayılan olarak `http://localhost:3000` portunda çalışacaktır.*

### 2. Adım: Arayüz (Frontend) Sunucusunu Başlatın
Yeni bir terminal sekmesi açın ve arayüzü yayınlamak için yerel http sunucusunu başlatın:
```bash
cd "/Users/iremkaya/.gemini/antigravity/scratch/finans360"
python3 -m http.server 8082
```

### 3. Adım: Tarayıcıdan Giriş Yapın
Tarayıcınızı açın ve aşağıdaki adrese gidin:
```text
http://localhost:8082
```

### 🔑 Giriş Bilgileri
*   **Hazır Demo Kullanıcı:** `demo@finans360.com` / Şifre: `123456`
*   Dilerseniz **"Kayıt Olun"** linkine tıklayarak kendinize sıfırdan yeni bir kullanıcı profili oluşturabilirsiniz.

*Not: Grafik çizimleri için Chart.js kütüphanesi CDN üzerinden yüklendiğinden, uygulamayı kullanırken internet bağlantınızın olması önerilir.*
