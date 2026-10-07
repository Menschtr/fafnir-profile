# Fafnir Profil

Fenrid avatarını ve banner'ını **uygulamayı güncellemeden** değiştirmek için tek sayfalık
editör. Değişiklik bu depoya imzalı bir JSON olarak yazılır; Fafnir uygulaması dosyayı
internetten çeker ve profilinde anında kullanır.

Canlı sayfa: <https://menschtr.github.io/fafnir-profile/>

## Kullanım

1. **Fenrid kullanıcı ID** alanına kendi UUID'ni yaz (36 karakter, tireli).
2. **Avatar** ve **banner** görsellerini seç. Seçimden sonra açılan editörde
   görseli **sürükle**, slider ile **yakınlaştır** — kadrajda tam olarak hangi
   kısmın görüneceğini sen belirlersin (Discord'daki gibi). Site sonucu
   otomatik boyutlandırır ve KARE sınırlarına (görsel ≤ 1.5MB, dosya ≤ 2MB)
   sığdırır.
3. **Şifre** gir. Bu şifre Fafnir'deki şifreyle **aynı** olmalı; şifre
   tarayıcıdan çıkmaz, yalnızca imza anahtarı türetilir.
4. **GitHub token'ını** alana yapıştır — yazdığın an kendiliğinden kaydedilir
   (aşağıya bak).
5. **Yayınla** → dosya `data/fafnir-profiles.json` olarak depoya commit
   edilir, site uzak dosyayı geri çekip imzayı doğrular.
6. **Fafnir'e bağla** kutusundaki adresi Fafnir → **Ayarlar → Profil komuta
   merkezi**'ne yapıştır, aynı şifreyle **Kaydet**. (Bu adım yalnızca bir kez gerekir.)

## GitHub token (PAT)

Site, dosyayı depoya yazabilmek için bir fine-grained Personal Access Token ister:

1. <https://github.com/settings/tokens?type=beta> → **Generate new token**
2. Repository access: **Only select repositories** → bu depo
3. Permissions → Repository permissions → **Contents: Read and write** → Generate
4. Token'ı sitedeki alana yapıştır — yazıldığı an otomatik kaydedilir. Token
   yalnızca bu tarayıcının localStorage'ında durur; ortak/bölünmüş bir
   bilgisayarda **Sil** ile temizle.

## Güvenlik notları

- Bu depo **public** olmalıdır: uygulama dosyayı `raw.githubusercontent.com`
  üzerinden kimlik doğrulamasız çeker. Yayınladığın avatar/banner bu yüzden
  herkese açıktır (Fenrid profilinde zaten görünürler).
- KARE şifresi hiçbir yere gönderilmez; tarayıcıda PBKDF2 ile 310.000
  iterasyonda anahtar türetilir, imza bu anahtarla atılır.
- İmza bozulursa (ör. biri dosyayı değiştirmeye çalışırsa) uygulama dosyayı
  reddeder ve kendi gömülü görsellerine döner; zararlı bir şey işleme konmaz.
- `fenridId` alanı imza **dışındadır** (bilgi amaçlıdır); profil verisinin
  kendisi imza koruması altındadır.

## Eski kurulumlar

Önceki Fafnir sürümlerinde şifre, anahtar üretimine girmezdi (bir hata yüzünden
her şifre aynı sabit anahtarı üretiyordu). Bu artık düzeltildi. Daha önce
Ayarlar'a şifre kaydettiysen bir kez daha **Ayarlar → şifre → Kaydet** demen
ve dosyayı bu siteyle yeniden imzalaman gerekir.

## Geliştirme

```bash
node test/kare.test.mjs   # imza çekirdeği round-trip testleri
```

`kare.js`, Fafnir'ın `extension/options.js` + `extension/profiles.js` içindeki
PBKDF2 + kanonik JSON + HMAC-SHA256 üretimiyle birebir aynıdır; test bunu
Fafnir kaynaklarına karşı doğrular. Algoritma değişirse bu depo ile uygulama
uyumsuzlaşır — iki taraf birlikte değişmeli.
