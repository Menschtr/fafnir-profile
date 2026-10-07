/*
 * Fafnir KARE - imza cekirdegi.
 *
 * Bu dosya Fafnir'in extension/options.js ve extension/profiles.js
 * dosyalarindaki uretimle BIREBIR aynidir: PBKDF2-SHA256 (310000 iterasyon,
 * "fafnir-profiles-v1" tuzu), kanonik JSON (anahtar siralama, bosluksuz) ve
 * HMAC-SHA256 tag'i. Farkli uretilirse uygulamadaki imza dogrulanmaz.
 *
 * Imzalanan alanlar yalnizca su dorttur: format, version, profiles,
 * updatedAt. Ust seviye "fenridId" alani bilgi amaclidir, imza disidir;
 * profildeki "id" anahtari da uygulamanin "own" olarak okudugu sabittir.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KARE = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var SALT = "fafnir-profiles-v1";
  var ITERATIONS = 310000;
  var FORMAT = "fafnir-profiles";
  var VERSION = 1;
  var MAX_CONFIG_BYTES = 2 * 1024 * 1024;
  var MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
  var IMAGE_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

  /*
   * Kanonik JSON: anahtarlar siralanir, bosluk yok. Boylece imzalayan ve
   * dogrulayici ayni dokumenden ayni metni uretir. (Fafnir'deki iki kopya -
   * options.js "wrote" sayaci, profiles.js "i > 0" - dokumanda undefined alan
   * olmadigi surece ayni ciktiyi verir; bu da onlardan biridir.)
   */
  function canonicalStringify(root) {
    if (Array.isArray(root)) return "[" + root.map(canonicalStringify).join(",") + "]";
    if (root && typeof root === "object") {
      var keys = Object.keys(root).sort();
      var out = "{";
      var wrote = 0;
      for (var i = 0; i < keys.length; i += 1) {
        if (root[keys[i]] === undefined) continue;
        if (wrote > 0) out += ",";
        out += JSON.stringify(keys[i]) + ":" + canonicalStringify(root[keys[i]]);
        wrote += 1;
      }
      return out + "}";
    }
    return JSON.stringify(root);
  }

  function bytesToHex(bytes) {
    var hex = "";
    for (var i = 0; i < bytes.length; i += 1) hex += bytes[i].toString(16).padStart(2, "0");
    return hex;
  }

  function base64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deriveKey(password) {
    var enc = new TextEncoder();
    var base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
      "deriveBits",
    ]);
    var bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(SALT), iterations: ITERATIONS },
      base,
      256
    );
    return new Uint8Array(bits);
  }

  async function hmacHex(messageBytes, keyBytes) {
    var key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
    ]);
    var sig = await crypto.subtle.sign("HMAC", key, messageBytes);
    return bytesToHex(new Uint8Array(sig));
  }

  /* Uretim kapisi: gorsel ya gecerli bir data URL'dir ya null'dur. */
  function requireImage(value, label) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string") throw new Error(label + "-gecersiz");
    if (value.length > MAX_IMAGE_BYTES) throw new Error(label + "-cok-buyuk");
    if (!IMAGE_RE.test(value)) throw new Error(label + "-bicim");
    return value;
  }

  /* Dogrulama kapisi: Fafnir profiles.js'teki sanitizeImage ile ayni davranis. */
  function sanitizeImage(value) {
    if (typeof value !== "string") return null;
    if (value.length > MAX_IMAGE_BYTES) return null;
    return IMAGE_RE.test(value) ? value : null;
  }

  function timedEqual(a, b) {
    if (a.length !== b.length) return false;
    var same = true;
    for (var i = 0; i < a.length; i += 1) same = same && a.charCodeAt(i) === b.charCodeAt(i);
    return same;
  }

  /*
   * Imzali KARE dosyasi uretir. options.js'in imza aracinin yaptigiyla ayni
   * islem, yalnizca veri elden gelir.
   */
  async function build(options) {
    var password = options && options.password;
    if (typeof password !== "string" || !password) throw new Error("sifre-gerekli");
    var fenridId = options && typeof options.fenridId === "string" ? options.fenridId.trim() : "";
    if (!fenridId) throw new Error("fenrid-id-gerekli");

    var profiles = [
      {
        id: "own",
        avatar: requireImage(options.avatar, "avatar"),
        banner: requireImage(options.banner, "banner"),
      },
    ];
    var updatedAt = options && options.updatedAt ? Number(options.updatedAt) : Date.now();
    var core = { format: FORMAT, version: VERSION, profiles: profiles, updatedAt: updatedAt };

    var keyBytes = await deriveKey(password);
    var tag = await hmacHex(new TextEncoder().encode(canonicalStringify(core)), keyBytes);
    var signed = {
      fenridId: fenridId,
      format: core.format,
      version: core.version,
      profiles: core.profiles,
      updatedAt: core.updatedAt,
      tag: tag,
    };
    var text = JSON.stringify(signed, null, 2);
    if (text.length > MAX_CONFIG_BYTES) throw new Error("dosya-cok-buyuk");
    return { doc: signed, text: text, keyBytes: keyBytes };
  }

  /*
   * Uygulamanin profiles.js verifyDocument adimlarinin aynisi - yalnizca anahtar
   * parametre olarak gelir (uygulamada o anahtar depodan okunur).
   */
  async function verify(text, password) {
    if (typeof text !== "string" || !text.length || text.length > MAX_CONFIG_BYTES) {
      throw new Error("dosya-cok-buyuk");
    }
    var doc = null;
    try {
      doc = JSON.parse(text);
    } catch (error) {
      throw new Error("json-gecersiz");
    }
    if (!doc || typeof doc !== "object" || doc.format !== FORMAT) throw new Error("bicim");
    if (typeof doc.tag !== "string" || !/^[0-9a-f]{64}$/.test(doc.tag)) throw new Error("tag");
    if (!Array.isArray(doc.profiles)) throw new Error("profiller");

    var core = {
      format: doc.format,
      version: doc.version,
      profiles: doc.profiles,
      updatedAt: doc.updatedAt,
    };
    var keyBytes = await deriveKey(password);
    var expected = await hmacHex(new TextEncoder().encode(canonicalStringify(core)), keyBytes);
    if (!timedEqual(expected, doc.tag)) throw new Error("imza-yanlis");

    var profiles = [];
    for (var i = 0; i < doc.profiles.length; i += 1) {
      var entry = doc.profiles[i];
      if (!entry || typeof entry !== "object") continue;
      var id = String(entry.id || "");
      if (!id) continue;
      profiles.push({ id: id, avatar: sanitizeImage(entry.avatar), banner: sanitizeImage(entry.banner) });
    }
    return {
      fenridId: typeof doc.fenridId === "string" ? doc.fenridId : "",
      profiles: profiles,
      updatedAt: Number(doc.updatedAt) || 0,
    };
  }

  return {
    SALT: SALT,
    ITERATIONS: ITERATIONS,
    FORMAT: FORMAT,
    VERSION: VERSION,
    MAX_CONFIG_BYTES: MAX_CONFIG_BYTES,
    MAX_IMAGE_BYTES: MAX_IMAGE_BYTES,
    canonicalStringify: canonicalStringify,
    deriveKey: deriveKey,
    hmacHex: hmacHex,
    build: build,
    verify: verify,
  };
});
