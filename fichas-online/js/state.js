export const state = {
  roomId: null,
  roomCode: null,
  uid: null,
  role: null, // "GM" | "PLAYER"
  displayName: null,

  // UI selection
  selectedOwnerUid: null,  // em GM pode editar outros
  selectedCharId: null,

  // caches (in-memory)
  members: {},             // { uid: {role, displayName, joinedAt} }
  charactersByOwner: {},   // { ownerUid: { charId: charObj } }
  groups: {},              // gm/groups
  groupChars: {},          // { groupId: { "uid:charId": {addedAt} } }

  // subscriptions control
  unsub: []
};

export function resetState() {
  state.roomId = null;
  state.roomCode = null;
  state.uid = null;
  state.role = null;
  state.displayName = null;
  state.selectedOwnerUid = null;
  state.selectedCharId = null;
  state.members = {};
  state.charactersByOwner = {};
  state.groups = {};
  state.groupChars = {};
  for (const u of state.unsub) {
    try { u(); } catch {}
  }
  state.unsub = [];
}

export function setRoomContext({ roomId, roomCode, uid, role, displayName }) {
  state.roomId = roomId;
  state.roomCode = roomCode || roomId;
  state.uid = uid;
  state.role = role;
  state.displayName = displayName;

  // default selection
  state.selectedOwnerUid = uid;
}

export function isGM() {
  return state.role === "GM";
}

export function ensureRoomReady() {
  if (!state.roomId || !state.uid) throw new Error("Sala não inicializada.");
}

export function getSelectedChar(ownerUid = state.selectedOwnerUid, charId = state.selectedCharId) {
  const m = state.charactersByOwner[ownerUid] || {};
  return charId ? (m[charId] || null) : null;
}
