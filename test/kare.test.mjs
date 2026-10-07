/*
 * kare.js yuvarlak-dogrusu testleri.
 *   node test\kare.test.mjs
 *
 * Karsilastirma tarafi, Fafnir extension/profiles.js'teki dogrulayicinin
 * tasiyici kopyasidir (kanonik JSON profiles.js'in "i > 0" surumudur; kare.js
 * options.js'in "wrote" surumunu kullanir - ikisi ayni metni uretmelidir).
 * Ayrica uretim sabitleri Fafnir kaynak dosyalarindan okunup eslestirilir.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const KARE = require(join(dirname(fileURLToPath(import.meta.url)), "..", "kare.js"));

const FAFNIR = "C:\\Users\\emrec\\Desktop\\Fafnir\\extension";
const TINY = "data:image/png;base64,iVBORw0KGgo=";
const PASSWORD = "test-sifre-1";
const ID = "21be3568-12af-44f0-b27d-3dada17ab43c";

let passed = 0;
const fails = [];
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("  ok   " + name);
  } catch (error) {
    fails.push(name);
    console.log("  FAIL " + name + " - " + error.message);
  }
}

/* --- profiles.js tasiyici dogrulayici (birebir mantik) ------------------- */

function profilesCanonical(root) {
  if (Array.isArray(root)) return "[" + root.map(profilesCanonical).join(",") + "]";
  if (root && typeof root === "object") {
    const keys = Object.keys(root).sort();
    let out = "{";
    for (let i = 0; i < keys.length; i += 1) {
      if (root[keys[i]] === undefined) continue;
      if (i > 0) out += ",";
      out += JSON.stringify(keys[i]) + ":" + profilesCanonical(root[keys[i]]);
    }
    return out + "}";
  }
  return JSON.stringify(root);
}

async function profilesVerify(text, keyB64) {
  if (typeof text !== "string" || text.length > KARE.MAX_CONFIG_BYTES) throw new Error("acct-bad-size");
  const doc = JSON.parse(text);
  if (!doc || doc.format !== "fafnir-profiles") throw new Error("acct-bad-format");
  if (typeof doc.tag !== "string" || !/^[0-9a-f]{64}$/.test(doc.tag)) throw new Error("acct-bad-tag");
  if (!Array.isArray(doc.profiles)) throw new Error("acct-bad-profiles");
  const canonical = profilesCanonical({
    format: doc.format,
    version: doc.version,
    profiles: doc.profiles,
    updatedAt: doc.updatedAt,
  });
  const keyBytes = Uint8Array.from(Buffer.from(keyB64, "base64"));
  const expected = await KARE.hmacHex(new TextEncoder().encode(canonical), keyBytes);
  if (expected !== doc.tag) throw new Error("acct-bad-signature");
  return doc;
}

async function profilesSign(doc, keyB64) {
  const canonical = profilesCanonical({
    format: doc.format,
    version: doc.version,
    profiles: doc.profiles,
    updatedAt: doc.updatedAt,
  });
  const keyBytes = Uint8Array.from(Buffer.from(keyB64, "base64"));
  const tag = await KARE.hmacHex(new TextEncoder().encode(canonical), keyBytes);
  return Object.assign({}, doc, { tag });
}

const b64 = (bytes) => Buffer.from(bytes).toString("base64");

/* --- testler -------------------------------------------------------------- */

await check("uretim sabitleri Fafnir kaynaklariyla ayni", () => {
  const profilesSrc = readFileSync(join(FAFNIR, "profiles.js"), "utf8");
  const optionsSrc = readFileSync(join(FAFNIR, "options.js"), "utf8");
  for (const src of [profilesSrc, optionsSrc]) {
    assert.match(src, /fafnir-profiles-v1/);
    assert.match(src, /310000/);
    assert.match(src, /fafnir-profiles/);
  }
  /* sinirlar yalnizca profiles.js'te (dogrulayici orada); sifre uretimi
   * options.js'te - ikisi de sifreyi key material olarak kullanmali. */
  assert.match(profilesSrc, /2 \* 1024 \* 1024/);
  assert.match(profilesSrc, /1\.5 \* 1024 \* 1024/);
  assert.match(optionsSrc, /enc\.encode\(password\)/);
  assert.match(profilesSrc, /enc\.encode\(password\)/);
  assert.equal(KARE.SALT, "fafnir-profiles-v1");
  assert.equal(KARE.ITERATIONS, 310000);
  assert.equal(KARE.FORMAT, "fafnir-profiles");
});

await check("kare uretimi profil-komut-merkezi dogrulayicisindan gecer", async () => {
  const built = await KARE.build({ password: PASSWORD, fenridId: ID, avatar: TINY, banner: TINY });
  const doc = await profilesVerify(built.text, b64(built.keyBytes));
  assert.equal(doc.profiles[0].id, "own");
  assert.equal(doc.fenridId, ID);
});

await check("profiles.js tarzi imza kare.js dogrulayicisindan gecer", async () => {
  const keyBytes = await KARE.deriveKey(PASSWORD);
  const doc = await profilesSign(
    {
      format: "fafnir-profiles",
      version: 1,
      profiles: [{ id: "own", avatar: TINY, banner: null }],
      updatedAt: 1700000000000,
    },
    b64(keyBytes)
  );
  const verified = await KARE.verify(JSON.stringify(doc, null, 2), PASSWORD);
  assert.equal(verified.profiles[0].banner, null);
  assert.equal(verified.updatedAt, 1700000000000);
});

await check("yanlis sifre imzayi kabul ettirmez", async () => {
  const built = await KARE.build({ password: PASSWORD, fenridId: ID, avatar: TINY, banner: null });
  await assert.rejects(() => KARE.verify(built.text, "yanlis"), /imza-yanlis/);
  const wrongKey = b64(await KARE.deriveKey("yanlis"));
  await assert.rejects(() => profilesVerify(built.text, wrongKey));
});

await check("tag veya profil alanina dokunulursa imza kirilir", async () => {
  const built = await KARE.build({ password: PASSWORD, fenridId: ID, avatar: TINY, banner: TINY });
  const doc = JSON.parse(built.text);
  doc.profiles[0].avatar = null;
  const tampered = JSON.stringify(doc, null, 2);
  await assert.rejects(() => KARE.verify(tampered, PASSWORD), /imza-yanlis/);
  await assert.rejects(() => profilesVerify(tampered, b64(built.keyBytes)));
  doc.tag = "0".repeat(64);
  await assert.rejects(() => KARE.verify(JSON.stringify(doc, null, 2), PASSWORD), /imza-yanlis/);
});

await check("fenridId imza disidir: meta degisince imza gecerli kalir", async () => {
  const built = await KARE.build({ password: PASSWORD, fenridId: ID, avatar: TINY, banner: null });
  const doc = JSON.parse(built.text);
  doc.fenridId = "farkli-bir-id-degeri";
  const verified = await KARE.verify(JSON.stringify(doc, null, 2), PASSWORD);
  assert.equal(verified.fenridId, "farkli-bir-id-degeri");
});

await check("gorsel kapisi: gecersiz format ve asim uretimde hata", async () => {
  await assert.rejects(
    () => KARE.build({ password: PASSWORD, fenridId: ID, avatar: "data:image/svg+xml;base64,QQ==", banner: null }),
    /avatar-bicim/
  );
  await assert.rejects(
    () => KARE.build({ password: PASSWORD, fenridId: ID, avatar: "data:image/png;base64," + "A".repeat(KARE.MAX_IMAGE_BYTES), banner: null }),
    /avatar-cok-buyuk/
  );
});

await check("bos gorsel kabul edilir (uygulama gomulu gorseline duser)", async () => {
  const built = await KARE.build({ password: PASSWORD, fenridId: ID, avatar: null, banner: null });
  const verified = await KARE.verify(built.text, PASSWORD);
  assert.equal(verified.profiles[0].avatar, null);
  assert.equal(verified.profiles[0].banner, null);
});

await check("2MB'yi asan dosya dogrulamada reddedilir", async () => {
  const built = await KARE.build({ password: PASSWORD, fenridId: ID, avatar: TINY, banner: null });
  const padded = built.text + " ".repeat(KARE.MAX_CONFIG_BYTES);
  await assert.rejects(() => KARE.verify(padded, PASSWORD), /dosya-cok-buyuk/);
});

await check("kanonik cikti iki surumde de ayni", () => {
  const sample = {
    format: "fafnir-profiles",
    version: 1,
    profiles: [{ id: "own", avatar: null, banner: null }],
    updatedAt: 1700000000000,
  };
  assert.equal(KARE.canonicalStringify(sample), profilesCanonical(sample));
});

console.log(`kare.test: ${passed} gecti, ${fails.length} kaldi`);
if (fails.length) process.exit(1);
