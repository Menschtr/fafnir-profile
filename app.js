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
  var PAT_RE = /^(github_pat_[A-Za-z0-9]{20,}_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,})$/;

  var AVATAR_SIZE = 256;
  var BANNER_W = 1200;
  var BANNER_H = 420;
  var AVATAR_BUDGET = 130 * 1024;
  var BANNER_BUDGET = 520 * 1024;
  var RATIO = { avatar: 1, banner: BANNER_W / BANNER_H };
  var VIEW = { avatar: [272, 272], banner: [340, 119] };

  var $ = function (id) {
    return document.getElementById(id);
  };

  var state = {
    avatar: null,
    banner: null,
    pat: (localStorage.getItem(PAT_KEY) || "").replace(/[^A-Za-z0-9_]/g, ""),
    crops: { avatar: null, banner: null },
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

  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

  function initCrop(img, ratio) {
    var sw, sh;
    if (img.width / img.height > ratio) {
      sh = img.height;
      sw = sh * ratio;
    } else {
      sw = img.width;
      sh = sw / ratio;
    }
    return {
      img: img,
      ratio: ratio,
      baseW: sw,
      baseH: sh,
      sx: (img.width - sw) / 2,
      sy: (img.height - sh) / 2,
      sw: sw,
      sh: sh,
    };
  }

  function zoomCrop(crop, t) {
    var cx = crop.sx + crop.sw / 2;
    var cy = crop.sy + crop.sh / 2;
    crop.sw = crop.baseW / t;
    crop.sh = crop.baseH / t;
    crop.sx = clamp(cx - crop.sw / 2, 0, crop.img.width - crop.sw);
    crop.sy = clamp(cy - crop.sh / 2, 0, crop.img.height - crop.sh);
  }

  function paint(canvas, crop, w, h) {
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(crop.img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h);
  }

  function renderView(kind) {
    var crop = state.crops[kind];
    if (!crop) return;
    var v = VIEW[kind];
    paint($(kind === "avatar" ? "avatarView" : "bannerView"), crop, v[0], v[1]);
  }

  var gen = { avatar: 0, banner: 0 };
  var regenTimers = { avatar: null, banner: null };

  async function produce(kind) {
    var crop = state.crops[kind];
    if (!crop) return;
    var my = ++gen[kind];
    var w = kind === "avatar" ? AVATAR_SIZE : BANNER_W;
    var h = kind === "avatar" ? AVATAR_SIZE : BANNER_H;
    var budget = kind === "avatar" ? AVATAR_BUDGET : BANNER_BUDGET;
    var canvas = document.createElement("canvas");
    paint(canvas, crop, w, h);
    var url = await encode(canvas, budget);
    if (my !== gen[kind]) return; /* bu sırada görüntü değişti: geçersiz üretim */
    state[kind] = url;
    refresh();
  }

  function regenerate(kind) {
    clearTimeout(regenTimers[kind]);
    regenTimers[kind] = setTimeout(function () {
      void produce(kind);
    }, 200);
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
      state.crops[kind] = initCrop(img, RATIO[kind]);
      $(kind === "avatar" ? "avatarEditor" : "bannerEditor").hidden = false;
      $(kind === "avatar" ? "avatarZoom" : "bannerZoom").value = 100;
      renderView(kind);
      await produce(kind);
      say("");
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
        ? "Seçilmeyen görsel için uygulama kendi gömülü görselini kullanır."
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
    if (response.status === 401)
      return (
        "Token geçersiz veya süresi dolmuş (401)." +
        detail +
        " Token'ı GitHub'dan yeniden üret — değer yalnızca üretim ekranında görünür, listeden kopyalanamaz."
      );
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

  /* ---------------- bağlantılar ---------------- */

  $("avatarFile").addEventListener("change", function (e) {
    handleFile(e.target.files && e.target.files[0], "avatar");
  });
  $("bannerFile").addEventListener("change", function (e) {
    handleFile(e.target.files && e.target.files[0], "banner");
  });
  $("fenridId").addEventListener("input", refresh);
  $("publish").addEventListener("click", publish);

  var patTimer = null;
  $("pat").addEventListener("input", function () {
    var raw = $("pat").value;
    var v = raw.replace(/[^A-Za-z0-9_]/g, ""); /* bosluk/gorunmez/aksan temizligi */
    if (v !== raw) $("pat").value = v;
    state.pat = v;
    if (v) localStorage.setItem(PAT_KEY, v);
    else localStorage.removeItem(PAT_KEY);
    clearTimeout(patTimer);
    patTimer = setTimeout(function () {
      if (!state.pat) return;
      if (!PAT_RE.test(state.pat)) {
        say(
          "Token biçimi tuhaf — github_pat_… ile başlamalı; yarım kopyalanmış olabilir.",
          "err"
        );
      } else {
        say(
          "Token kaydedildi: " +
            state.pat.slice(0, 13) +
            "…" +
            state.pat.slice(-4) +
            " · " +
            state.pat.length +
            " karakter",
          "ok"
        );
      }
    }, 600);
  });
  $("patClear").addEventListener("click", function () {
    clearTimeout(patTimer);
    state.pat = "";
    $("pat").value = "";
    localStorage.removeItem(PAT_KEY);
    say("Token tarayıcıdan silindi.");
  });

  function wireEditor(kind) {
    var id = function (suffix) {
      return $(kind === "avatar" ? "avatar" + suffix : "banner" + suffix);
    };
    var view = id("View");
    var zoom = id("Zoom");
    var crop = function () {
      return state.crops[kind];
    };

    zoom.addEventListener("input", function () {
      var c = crop();
      if (!c) return;
      zoomCrop(c, Number(zoom.value) / 100);
      renderView(kind);
      regenerate(kind);
    });
    id("Reset").addEventListener("click", function () {
      var c = crop();
      if (!c) return;
      state.crops[kind] = initCrop(c.img, RATIO[kind]);
      zoom.value = 100;
      renderView(kind);
      regenerate(kind);
    });

    var dragging = false;
    var lastX = 0;
    var lastY = 0;
    view.addEventListener("pointerdown", function (e) {
      if (!crop()) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      view.classList.add("dragging");
      view.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    view.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var c = crop();
      if (!c) return;
      var rect = view.getBoundingClientRect();
      var factor = c.sw / rect.width;
      c.sx = clamp(c.sx - (e.clientX - lastX) * factor, 0, c.img.width - c.sw);
      c.sy = clamp(c.sy - (e.clientY - lastY) * factor, 0, c.img.height - c.sh);
      lastX = e.clientX;
      lastY = e.clientY;
      renderView(kind);
    });
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      view.classList.remove("dragging");
      regenerate(kind);
    }
    view.addEventListener("pointerup", endDrag);
    view.addEventListener("pointercancel", endDrag);
    view.addEventListener("lostpointercapture", endDrag);
  }
  wireEditor("avatar");
  wireEditor("banner");

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
