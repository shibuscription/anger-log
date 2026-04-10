import admin from "firebase-admin";

const DEFAULT_TARGET_UID = "XfSFsJnxsmQAV3KZp3YjR3L7dy52";
const DEFAULT_SEED_VERSION = "seed-v1";

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
  const seedVersion = readOption("--seed-version", process.env.SEED_VERSION || DEFAULT_SEED_VERSION);

  if (!targetUid) {
    throw new Error("TARGET_UID is empty.");
  }

  console.log("[cleanup] target uid:", targetUid);
  console.log("[cleanup] seedVersion:", seedVersion);
  console.log("[cleanup] mode:", dryRun ? "dry-run" : "apply");

  const db = initAdmin();
  const col = db.collection("users").doc(targetUid).collection("anger_logs");
  const snap = await col
    .where("seeded", "==", true)
    .where("seedVersion", "==", seedVersion)
    .get();

  console.log("[cleanup] matched docs:", snap.size);
  if (snap.empty) {
    console.log("[cleanup] nothing to delete.");
    return;
  }

  if (dryRun) {
    console.log("[cleanup] sample doc ids:", snap.docs.slice(0, 10).map((doc) => doc.id).join(", "));
    console.log("[cleanup] dry-run completed. use --apply to delete.");
    return;
  }

  const batchSize = 400;
  for (let i = 0; i < snap.docs.length; i += batchSize) {
    const batch = db.batch();
    snap.docs.slice(i, i + batchSize).forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();
  }

  console.log("[cleanup] completed successfully.");
}

main().catch((error) => {
  console.error("[cleanup] failed:", error);
  process.exitCode = 1;
});
