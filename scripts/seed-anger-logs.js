import admin from "firebase-admin";

const DEFAULT_TARGET_UID = "XfSFsJnxsmQAV3KZp3YjR3L7dy52";
const DEFAULT_COUNT = 100;
const SEED_VERSION = "seed-v1";

function hasFlag(name) {
  return process.argv.includes(name);
}

function readOption(name, fallback = "") {
  const index = process.argv.findIndex((arg) => arg === name);
  if (index === -1 || index + 1 >= process.argv.length) {
    return fallback;
  }
  return process.argv[index + 1];
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(items) {
  return items[randomInt(0, items.length - 1)];
}

function jitter(base, delta) {
  return base + (Math.random() * 2 - 1) * delta;
}

function buildRandomDate(index, count) {
  const now = new Date();
  const baseDayOffset = Math.floor((index / count) * 30);
  const randomDayOffset = clamp(baseDayOffset + randomInt(-2, 2), 0, 30);
  const date = new Date(now);
  date.setDate(now.getDate() - randomDayOffset);

  const hourBuckets = [
    [7, 9],
    [10, 12],
    [13, 15],
    [16, 18],
    [19, 22],
  ];
  const [startHour, endHour] = pick(hourBuckets);
  date.setHours(randomInt(startHour, endHour), randomInt(0, 59), randomInt(0, 59), 0);
  return date.toISOString();
}

function buildIntensity() {
  const roll = Math.random();
  if (roll < 0.07) return randomInt(1, 2);
  if (roll < 0.18) return 3;
  if (roll < 0.78) return randomInt(4, 7);
  if (roll < 0.94) return randomInt(8, 9);
  return 10;
}

function buildLocation() {
  const clusters = [
    { placePrefix: "名古屋駅周辺", lat: 35.170915, lng: 136.881537, latJitter: 0.06, lngJitter: 0.07 },
    { placePrefix: "多治見駅周辺", lat: 35.3329, lng: 137.1261, latJitter: 0.04, lngJitter: 0.04 },
    { placePrefix: "東京駅周辺", lat: 35.681236, lng: 139.767125, latJitter: 0.08, lngJitter: 0.1 },
    { placePrefix: "新大阪駅周辺", lat: 34.7335, lng: 135.5003, latJitter: 0.06, lngJitter: 0.07 },
    { placePrefix: "栄エリア", lat: 35.1696, lng: 136.9087, latJitter: 0.03, lngJitter: 0.04 },
    { placePrefix: "金山エリア", lat: 35.1435, lng: 136.9007, latJitter: 0.03, lngJitter: 0.03 },
  ];

  const cluster = pick(clusters);
  return {
    placePrefix: cluster.placePrefix,
    location: {
      latitude: Number(jitter(cluster.lat, cluster.latJitter).toFixed(6)),
      longitude: Number(jitter(cluster.lng, cluster.lngJitter).toFixed(6)),
      accuracy: randomInt(8, 60),
    },
  };
}

function buildTextPair(placePrefix) {
  const subjects = ["同僚", "家族", "先生", "店員さん", "上司", "友人", "取引先"];
  const situations = [
    "連絡が直前になった",
    "約束していた時間に遅れてきた",
    "確認なしで話を進められた",
    "人前で強い言い方をされた",
    "必要な情報を共有してもらえなかった",
    "SNSで断定的に言われた",
    "移動中に急な変更を伝えられた",
    "買い物中に横入りされた",
    "作業依頼が曖昧なまま渡された",
  ];
  const reactions = [
    "気持ちがざわついて集中できなかった。",
    "納得できず、しばらく引きずってしまった。",
    "言い返したくなったけど我慢した。",
    "モヤモヤが続いた。",
    "不公平に感じて腹が立った。",
    "思わず強い口調になりそうだった。",
  ];

  const event = `${placePrefix}で${pick(subjects)}に${pick(situations)}。${pick(reactions)}`;
  return {
    event,
    place: placePrefix,
  };
}

function buildBeki() {
  const bekiPatterns = [
    "もっと早く連絡してほしかった",
    "約束は守るべきだと思った",
    "静かにしてほしかった",
    "ちゃんと確認してから言ってほしかった",
    "急な変更は事前に相談してほしかった",
    "相手の都合も考えて発言してほしかった",
    "責任の所在を明確にするべきだと思った",
    "最低限のマナーは守ってほしかった",
  ];
  return {
    beki_text: pick(bekiPatterns),
    beki_importance: randomInt(2, 5),
  };
}

function buildLogs(count, seedTag) {
  const logs = [];
  for (let i = 0; i < count; i += 1) {
    const date = buildRandomDate(i, count);
    const intensity = buildIntensity();
    const withLocation = Math.random() < 0.72;
    const withBeki = Math.random() < 0.42;

    let place = "場所未入力";
    let location = null;

    if (withLocation) {
      const locationSet = buildLocation();
      place = locationSet.placePrefix;
      location = locationSet.location;
    }

    const textPair = buildTextPair(place);
    const beki = withBeki ? buildBeki() : null;

    logs.push({
      date,
      place: textPair.place,
      event: textPair.event,
      intensity,
      location,
      beki_date: beki ? date : null,
      beki_text: beki ? beki.beki_text : null,
      beki_importance: beki ? beki.beki_importance : null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      seeded: true,
      seedVersion: SEED_VERSION,
      seedTag,
    });
  }
  return logs;
}

function initAdmin() {
  if (admin.apps.length > 0) {
    return admin.firestore();
  }

  const inlineServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inlineServiceAccount) {
    const serviceAccount = JSON.parse(inlineServiceAccount);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  }

  return admin.firestore();
}

async function main() {
  const apply = hasFlag("--apply");
  const dryRun = hasFlag("--dry-run") || !apply;
  const targetUid = readOption("--uid", process.env.TARGET_UID || DEFAULT_TARGET_UID);
  const count = clamp(toNumber(readOption("--count", process.env.SEED_COUNT || String(DEFAULT_COUNT)), DEFAULT_COUNT), 1, 300);
  const seedTag = `seed-${new Date().toISOString()}`;

  if (!targetUid) {
    throw new Error("TARGET_UID is empty.");
  }

  const logs = buildLogs(count, seedTag);
  const withLocation = logs.filter((log) => log.location).length;
  const withBeki = logs.filter((log) => log.beki_text).length;

  console.log("[seed] target uid:", targetUid);
  console.log("[seed] count:", count);
  console.log("[seed] with location:", withLocation);
  console.log("[seed] with beki:", withBeki);
  console.log("[seed] mode:", dryRun ? "dry-run" : "apply");
  console.log("[seed] seedTag:", seedTag);

  if (dryRun) {
    console.log("[seed] first sample:", JSON.stringify(logs[0], null, 2));
    console.log("[seed] dry-run completed. use --apply to write Firestore.");
    return;
  }

  const db = initAdmin();
  const collectionRef = db.collection("users").doc(targetUid).collection("anger_logs");

  const batchSize = 400;
  for (let i = 0; i < logs.length; i += batchSize) {
    const batch = db.batch();
    logs.slice(i, i + batchSize).forEach((log) => {
      batch.set(collectionRef.doc(), log);
    });
    await batch.commit();
  }

  console.log("[seed] completed successfully.");
}

main().catch((error) => {
  console.error("[seed] failed:", error);
  process.exitCode = 1;
});
