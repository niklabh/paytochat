/**
 * One-shot backfill: add `participants: [senderId, recipientId].sort()`
 * to every message doc that doesn't already have it.
 *
 * Run once after deploying the new firestore.rules + firestore.indexes:
 *
 *   pnpm dlx tsx scripts/backfill-message-participants.ts
 *
 * Reads `FIREBASE_ADMIN_*` from .env.local exactly the way the API
 * routes do, so no extra config is required.
 *
 * Idempotent: skips docs that already have `participants`. Safe to run
 * multiple times.
 */

import * as admin from "firebase-admin";
import { readFileSync } from "fs";
import { resolve } from "path";

// Inline .env.local parser (avoids pulling in `dotenv` as a root dep
// just for this one-off script). Handles quoted multi-line values like
// FIREBASE_ADMIN_PRIVATE_KEY which contains literal \n sequences.
(function loadDotEnvLocal() {
  let raw: string;
  try {
    raw = readFileSync(resolve(__dirname, "..", ".env.local"), "utf8");
  } catch {
    return; // file optional; rely on whatever's already in env
  }
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1).replace(/\\n/g, "\n");
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
})();

function init() {
  if (admin.apps.length > 0) return admin.app();
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_ADMIN_PRIVATE_KEY || "").replace(
    /\\n/g,
    "\n",
  );
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Missing FIREBASE_ADMIN_* env vars. Make sure .env.local has them set.",
    );
  }
  return admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
}

async function main() {
  init();
  const db = admin.firestore();
  const snap = await db.collection("messages").get();
  console.log(`scanning ${snap.size} messages…`);

  let updated = 0;
  let skipped = 0;
  let invalid = 0;

  // Firestore caps batches at 500 writes; chunk just in case.
  const CHUNK = 400;
  let batch = db.batch();
  let pending = 0;

  for (const doc of snap.docs) {
    const m = doc.data();
    if (Array.isArray(m.participants) && m.participants.length === 2) {
      skipped++;
      continue;
    }
    if (typeof m.senderId !== "string" || typeof m.recipientId !== "string") {
      invalid++;
      console.warn(
        `  skipping ${doc.id} — no senderId / recipientId on the doc`,
      );
      continue;
    }
    const participants = [m.senderId, m.recipientId].sort();
    batch.update(doc.ref, { participants });
    pending++;
    updated++;

    if (pending >= CHUNK) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();

  console.log(
    `done. updated=${updated}  already_had_field=${skipped}  invalid=${invalid}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
