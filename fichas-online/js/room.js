import {
  db, ref, get, set, update, push,
  query, orderByChild, equalTo, limitToFirst
} from "./firebase.js";
import { state, setRoomContext } from "./state.js";
import { auth } from "./firebase.js";

function normalizeCode(code) {
  return (code || "").trim().toUpperCase().replace(/\s+/g, "");
}

async function findRoomByCode(roomCode) {
  const code = normalizeCode(roomCode);
  const q = query(ref(db, "rooms"), orderByChild("meta/code"), equalTo(code), limitToFirst(1));
  const snap = await get(q);
  if (!snap.exists()) return null;

  const val = snap.val();
  const roomId = Object.keys(val)[0];
  return { roomId, room: val[roomId] };
}

export async function resolveOrCreateRoomAndJoin({ roomCode, displayName, uid }) {
  const code = normalizeCode(roomCode);
  if (!code) throw new Error("roomCode inválido.");

  const found = await findRoomByCode(code);

  if (!found) {
    // create room
    const roomId = push(ref(db, "rooms")).key;
    const now = Date.now();

    const updatesObj = {};
    updatesObj[`rooms/${roomId}/meta`] = { code, createdAt: now, gmUid: uid };
    updatesObj[`rooms/${roomId}/members/${uid}`] = { role: "GM", displayName, joinedAt: now };

    await update(ref(db), updatesObj);
    return { roomId, role: "GM" };
  }

  const { roomId, room } = found;
  const gmUid = room?.meta?.gmUid || null;
  const role = (gmUid === uid) ? "GM" : "PLAYER";

  // join as member if missing
  const memberPath = `rooms/${roomId}/members/${uid}`;
  const memberSnap = await get(ref(db, memberPath));
  if (!memberSnap.exists()) {
    await set(ref(db, memberPath), { role, displayName, joinedAt: Date.now() });
  } else {
    // keep role (in case GM re-login) + refresh displayName
    const cur = memberSnap.val() || {};
    const next = {
      role: cur.role || role,
      displayName,
      joinedAt: cur.joinedAt || Date.now()
    };
    await set(ref(db, memberPath), next);
  }

  return { roomId, role };
}

export async function bootstrapRoom(roomId) {
  if (!roomId) throw new Error("roomId ausente.");

  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Auth não inicializado.");

  // read meta
  const metaSnap = await get(ref(db, `rooms/${roomId}/meta`));
  if (!metaSnap.exists()) throw new Error("Sala não encontrada.");

  const meta = metaSnap.val();
  const roomCode = meta?.code || roomId;
  const gmUid = meta?.gmUid || null;

  // read my member (or create if missing)
  const dn = (localStorage.getItem("fo_displayName") || "").trim() || "Player";
  const memberSnap = await get(ref(db, `rooms/${roomId}/members/${uid}`));
  if (!memberSnap.exists()) {
    const role = (gmUid === uid) ? "GM" : "PLAYER";
    await set(ref(db, `rooms/${roomId}/members/${uid}`), { role, displayName: dn, joinedAt: Date.now() });
  }

  const member = (await get(ref(db, `rooms/${roomId}/members/${uid}`))).val();
  const role = (gmUid === uid || member?.role === "GM") ? "GM" : "PLAYER";
  const displayName = member?.displayName || dn;

  setRoomContext({ roomId, roomCode, uid, role, displayName });

  return state;
}
