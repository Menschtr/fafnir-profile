/*
 * Fafnir Profil - uygulama ve yazma katmani.
 *
 * Akis: gorsel -> canvas (kirip/kucult) -> KARE.build (imza) -> GitHub
 * Contents API ile data/fafnir-profiles.json dosyasina commit -> uygulama
 * raw.githubusercontent.com uzerinden ceker.
 *
 * Şifre ve token yalnizca bu tarayicida durur; şifreden yalnizca PBKDF2
 * anahtari uretilir, kendisi hicbir isteğe gitmez.
 */
(function () {
  "use strict";

  var REPO = "Menschtr/fafnir-profile";
  var BRANCH = "main";
  var KARE_PATH = "data/fafnir-profiles.json";
  var RAW_URL = "https://raw.githubusercontent.com/" + REPO + "/" + BRANCH + "/" + KARE_PATH;
  var API_URL = "https://api.github.com/repos/" + REPO + "/contents/" + KARE_PATH;
  var PAT_KEY = "fafnir-profile.pat";
  var ID_KEY = "fafnir-profile.fenridId";

  var UUID_RE =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

  var AVATAR_SIZE = 256;
  var BANNER_W = 1200;
  var BANNER_H = 420;
  var AVATAR_BUDGET = 130 * 1024;
  var BANNER_BUDGET = 520 * 1024;

  var $ = function (id) {
    return document.getElementById(id);
  };

  var state = {
    avatar: null,
    banner: null,
    pat: localStorage.getItem(PAT_KEY) || "",
  };

  var ERR = {
    "sifre-gerekli": "İmza şifresi gerekli.",
    "fenrid-id-gerekli": "Fenrid kullanıcı ID gerekli.",
    "avatar-bicim": "Avatar geçerli bir görsel değil.",
    "banner-bicim": "Banner geçerli bir görsel değil.",
    "avatar-cok-buyuk": "Avatar 1.5MB sınırını aşıyor.",
    "banner-cok-buyuk": "Banner 1.5MB sınırını aşıyor.",
    "dosya-cok-buyuk": "Oluşan dosya 2MB sınırını aşıyor.",
    "json-gecersiz": "Dosya JSON değil.",
    bicim: "Dosyanın biçimi (format) yanlış.",
    tag: "Dosyanın imza alanı (tag) eksik veya bozuk.",
    profiller: "Profil listesi yok.",
    "imza-yanlis": "İmza doğrulanamadı — şifre veya dosya yanlış.",
  };

  function say(text, tone) {
    var node = $("status");
    node.textContent = text || "";
    node.className = "status" + (tone ? " " + tone : "");
  }

  function kb(n) {
    return Math.round(n / 1024) + " KB";
  }

  /* ---------------- görsel hattı ---------------- */

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("gorsel-okunamadi"));
      };
      img.src = url;
    });
  }

  function crop(img, targetW, targetH) {
    var scale = Math.max(targetW / img.width, targetH / img.height);
    var sw = targetW / scale;
    var sh = targetH / scale;
    var sx = (img.width - sw) / 2;
    var sy = (img.height - sh) / 2;
    var canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
    return canvas;
  }

  function canvasToUrl(canvas, type, quality) {
    return new Promise(function (resolve) {
      var url = canvas.toDataURL(type, quality);
      /* tarayici desteklemiyorsa type'a bakmadan doner; caller tipi kontrol eder */
      resolve(url);
    });
  }

  var LADDER = [
    ["image/webp", 0.9],
    ["image/webp", 0.8],
    ["image/webp", 0.7],
    ["image/jpeg", 0.85],
    ["image/jpeg", 0.7],
    ["image/jpeg", 0.55],
    ["image/png", undefined],
  ];

  async function encode(canvas, budget) {
    var best = null;
    for (var i = 0; i < LADDER.length; i += 1) {
      var type = LADDER[i][0];
      var quality = LADDER[i][1];
      var url = await canvasToUrl(canvas, type, quality);
      var producedType = url.slice(5, url.indexOf(";"));
      if (producedType !== type) continue; /* bu tip desteklenmiyor */
      if (!best || url.length < best.length) best = url;
      if (url.length <= budget) return url;
    }
    return best; /* hiçbiri bütçeye sığmadı: en küçüğü ver, KARE limiti yine de korunur */
  }

  async function handleFile(file, kind) {
    if (!file) return;
    say(kind === "avatar" ? "Avatar işleniyor…" : "Banner işleniyor…");
    try {
      var img = await loadImage(file);
      var canvas =
        kind === "avatar" ? crop(img, AVATAR_SIZE, AVATAR_SIZE) : crop(img, BANNER_W, BANNER_H);
      var budget = kind === "avatar" ? AVATAR_BUDGET : BANNER_BUDGET;
      var url = await encode(canvas, budget);
      state[kind] = url;
      say("");
      refresh();
    } catch (error) {
      say("Görsel işlenemedi: " + error.message, "err");
    }
  }

  /* ---------------- önizleme + ölçü ---------------- */

  function unsignedSize() {
    var doc = {
      fenridId: $("fenridId").value.trim(),
      format: "fafnir-profiles",
      version: 1,
      profiles: [{ id: "own", avatar: state.avatar, banner: state.banner }],
      updatedAt: Date.now(),
      tag: "",
    };
    return JSON.stringify(doc, null, 2).length;
  }

  function refresh() {
    var pvAvatar = $("pvAvatar");
    var pvBanner = $("pvBanner");
    if (state.avatar) pvAvatar.src = state.avatar;
    else pvAvatar.removeAttribute("src");
    pvBanner.style.backgroundImage = state.banner ? 'url("' + state.banner + '")' : "";

    var parts = [];
    parts.push(state.avatar ? "avatar " + kb(state.avatar.length) : "avatar: gömülü");
    parts.push(state.banner ? "banner " + kb(state.banner.length) : "banner: gömülü");
    var approx = unsignedSize();
    parts.push("dosya ≈ " + kb(approx) + " / 2048 KB");
    $("sizes").textContent = parts.join(" · ");

    $("pvHint").textContent =
      state.avatar || state.banner
        ? "Bir görsel seçilmediğinde uygulama kendi gömülü görselini kullanır."
        : "Görsel seçilmediğinde uygulama kendi gömülü görselini kullanır.";
  }

  /* ---------------- GitHub ---------------- */

  function b64FromText(text) {
    var bytes = new TextEncoder().encode(text);
    var bin = "";
    var CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  function githubHeaders() {
    return {
      Authorization: "Bearer " + state.pat,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    };
  }

  async function githubError(response, fallback) {
    var detail = "";
    try {
      var body = await response.json();
      if (body && body.message) detail = " — " + body.message;
    } catch (ignored) {
      /* govde yok */
    }
    if (response.status === 401) return "Token geçersiz veya süresi dolmuş (401)." + detail;
    if (response.status === 403)
      return "Token'ın bu depoda Contents yazma izni yok ya da kota doldu (403)." + detail;
    if (response.status === 404)
      return "Depo/yol bulunamadı (404). Repo adı: " + REPO + "." + detail;
    return fallback + " (" + response.status + ")." + detail;
  }

  async function commit(text) {
    if (!state.pat) throw new Error("Önce sağ üstteki alanla GitHub token'ını kaydet.");

    var sha = null;
    var head = await fetch(API_URL + "?ref=" + BRANCH, { headers: githubHeaders() });
    if (head.status === 200) {
      var meta = await head.json();
      sha = meta.sha;
    } else if (head.status !== 404) {
      throw new Error(await githubError(head, "Depo okunamadı"));
    }

    var payload = {
      message: "chore: profil guncellemesi " + new Date().toISOString().slice(0, 16).replace("T", " "),
      content: b64FromText(text),
      branch: BRANCH,
    };
    if (sha) payload.sha = sha;

    var put = await fetch(API_URL, { method: "PUT", headers: githubHeaders(), body: JSON.stringify(payload) });
    if (put.status !== 200 && put.status !== 201) {
      if (put.status === 409) throw new Error("Dosya başka bir işlemle değişmiş; bir kez daha dene.");
      throw new Error(await githubError(put, "Yazılamadı"));
    }
    return put.json();
  }

  async function fetchRaw() {
    var res = await fetch(RAW_URL + "?t=" + Date.now());
    if (!res.ok) throw new Error("Dosya indirilemedi (" + res.status + ").");
    return res.text();
  }

  /* ---------------- eylemler ---------------- */

  async function publish() {
    var id = $("fenridId").value.trim();
    var password = $("pass").value;
    if (!UUID_RE.test(id)) {
      say("Fenrid kullanıcı ID bir UUID gibi görünmüyor (36 karakter, tireli).", "err");
      $("fenridId").focus();
      return;
    }
    if (!password) {
      say(ERR["sifre-gerekli"], "err");
      $("pass").focus();
      return;
    }
    if (!state.pat) {
      say("Önce GitHub token'ını kaydet.", "err");
      $("pat").focus();
      return;
    }

    $("publish").disabled = true;
    say("İmzalanıyor…");
    try {
      var built = await KARE.build({
        password: password,
        fenridId: id,
        avatar: state.avatar,
        banner: state.banner,
      });
      say("GitHub'a yazılıyor…");
      localStorage.setItem(PAT_KEY, state.pat);
      localStorage.setItem(ID_KEY, id);
      await commit(built.text);

      say("Yayınlandı. Doğrulanıyor…", "ok");
      var remote = await fetchRaw();
      await KARE.verify(remote, password);
      say("Yayınlandı ve uzak dosya imzası doğrulandı ✓", "ok");
      $("setupBox").hidden = false;
      $("rawUrl").textContent = RAW_URL;
      $("setupBox").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (error) {
      say(ERR[error.message] || error.message, "err");
    } finally {
      $("publish").disabled = false;
    }
  }

  async function verifyRemote() {
    var password = $("pass").value;
    if (!password) {
      say(ERR["sifre-gerekli"], "err");
      return;
    }
    $("verify").disabled = true;
    say("Uzak dosya çekiliyor…");
    try {
      var text = await fetchRaw();
      await KARE.verify(text, password);
      say("Uzak dosya geçerli — uygulama bunu kabul eder ✓", "ok");
    } catch (error) {
      say(ERR[error.message] || error.message, "err");
    } finally {
      $("verify").disabled = false;
    }
  }

  function download() {
    if (!state.avatar && !state.banner) {
      say("Önce en az bir görsel seç.", "err");
      return;
    }
    var password = $("pass").value;
    if (!password) {
      say(ERR["sifre-gerekli"], "err");
      return;
    }
    KARE.build({
      password: password,
      fenridId: $("fenridId").value.trim() || "unknown",
      avatar: state.avatar,
      banner: state.banner,
    }).then(
      function (built) {
        var blob = new Blob([built.text], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "fafnir-profiles.json";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 4000);
        say("Dosya indirildi (elle yayınlamak için).", "ok");
      },
      function (error) {
        say(ERR[error.message] || error.message, "err");
      }
    );
  }

  /* ---------------- bağlantılar ---------------- */

  $("avatarFile").addEventListener("change", function (e) {
    handleFile(e.target.files && e.target.files[0], "avatar");
  });
  $("bannerFile").addEventListener("change", function (e) {
    handleFile(e.target.files && e.target.files[0], "banner");
  });
  $("fenridId").addEventListener("input", refresh);
  $("publish").addEventListener("click", publish);
  $("verify").addEventListener("click", verifyRemote);
  $("download").addEventListener("click", download);

  $("patSave").addEventListener("click", function () {
    state.pat = $("pat").value.trim();
    if (state.pat) {
      localStorage.setItem(PAT_KEY, state.pat);
      say("Token kaydedildi (yalnızca bu tarayıcıda).", "ok");
    } else {
      say("Token alanı boş.", "err");
    }
  });
  $("patForget").addEventListener("click", function () {
    state.pat = "";
    $("pat").value = "";
    localStorage.removeItem(PAT_KEY);
    say("Token tarayıcıdan silindi.", "ok");
  });
  $("copyUrl").addEventListener("click", function () {
    var text = $("rawUrl").textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          say("Adres kopyalandı.", "ok");
        },
        function () {
          say("Kopyalanamadı; adresi elle seç.", "err");
        }
      );
    }
  });

  /* başlangıç değeri */
  var savedId = localStorage.getItem(ID_KEY);
  if (savedId) $("fenridId").value = savedId;
  if (state.pat) $("pat").value = state.pat;
  $("rawUrl").textContent = RAW_URL;
  refresh();
})();
