import {
  auth, db,
  setPersistence, browserLocalPersistence,
  signInAnonymously, signOut, onAuthStateChanged,
  ref, get, set, update, onValue, push, serverTimestamp
} from "./firebase.js";

/** --------------------------
 * Utilities
 * -------------------------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function setStatus(msg, type=""){
  const el = $("#status");
  if(!el) return;
  el.classList.remove("ok","err","warn");
  if(type) el.classList.add(type);
  el.textContent = msg || "";
}

function toast(msg, type="ok", ms=1200){
  try{
    const div = document.createElement("div");
    div.className = `toast ${type}`;
    div.textContent = String(msg || "");
    document.body.appendChild(div);
    requestAnimationFrame(()=> div.classList.add("show"));
    setTimeout(()=>{
      div.classList.remove("show");
      setTimeout(()=> div.remove(), 220);
    }, ms);
  }catch(_){}
}

function mustRoomId(){
  const url = new URL(location.href);
  const roomId = url.searchParams.get("roomId");
  if(!roomId){
    setStatus("roomId ausente na URL.", "err");
    throw new Error("Missing roomId");
  }
  return roomId;
}

function safeRoomCode(code){
  return String(code || "").trim().toUpperCase().replace(/\s+/g,"");
}

function safeName(name){
  return String(name || "").trim().slice(0,40);
}

async function ensureAnonAuth(){
  await setPersistence(auth, browserLocalPersistence);
  if(auth.currentUser) return auth.currentUser;
  const cred = await signInAnonymously(auth);
  return cred.user;
}

function asInt(v, fallback=0){
  const n = Number(v);
  if(!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}
function asNum(v, fallback=0){
  const n = Number(v);
  if(!Number.isFinite(n)) return fallback;
  return n;
}

function parseJsonLenient(text){
  try{
    return { ok:true, value: JSON.parse(text) };
  }catch(e){
    return { ok:false, error: String(e?.message || e) };
  }
}

function buildDice(n){ return 1 + Math.floor(Math.random() * n); }

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function slugify(input){
  let s = String(input || "").trim().toLowerCase();
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/\s+/g, "-");
  s = s.replace(/[^a-z0-9-]/g, "");
  s = s.replace(/-+/g, "-");
  s = s.replace(/^-+/, "").replace(/-+$/, "");
  return s;
}


// --- GM key (recuperação de GM) ---
function normalizeGmKey(key){
  return String(key || "").trim().toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9-]/g, "");
}
function gmKeyStorageKey(roomCode){
  return `fo_gmKey_${safeRoomCode(roomCode)}`;
}
function getGmKey(roomCode){
  return localStorage.getItem(gmKeyStorageKey(roomCode)) || "";
}
function setGmKey(roomCode, gmKey){
  localStorage.setItem(gmKeyStorageKey(roomCode), String(gmKey || ""));
}
function generateGmKey(){
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let raw = "";
  for(let i=0;i<16;i++) raw += alphabet[Math.floor(Math.random()*alphabet.length)];
  return raw.match(/.{1,4}/g).join("-");
}
async function sha256Hex(input){
  const data = new TextEncoder().encode(String(input));
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function claimGmWithKey({ roomId, roomCode, displayName, gmKey }){
  const user = await ensureAnonAuth();
  const uid = user.uid;
  const code = safeRoomCode(roomCode || "");
  const name = safeName(displayName || localStorage.getItem("fo_displayName") || "GM");
  const key = normalizeGmKey(gmKey || getGmKey(code));
  if(!code) throw new Error("roomCode ausente.");
  if(!key) throw new Error("Chave do GM ausente.");

  // garante que existe um member para mostrar nome (cria como PLAYER se não existir)
  const memberRef = ref(db, `rooms/${roomId}/members/${uid}`);
  try{
    const ms = await get(memberRef);
    if(!ms.exists()){
      await set(memberRef, { role: "PLAYER", displayName: name, joinedAt: serverTimestamp() });
    }
  }catch(_){
    // se falhar por permissão, segue (GM pode estar lendo depois)
  }

  const hash = await sha256Hex(key);
  await set(ref(db, `rooms/${roomId}/gmClaims/${uid}`), { hash, at: serverTimestamp() });

  const metaRef = ref(db, `rooms/${roomId}/meta`);
  const metaSnap = await get(metaRef);
  const oldGmUid = metaSnap.exists() ? (metaSnap.val()?.gmUid || null) : null;

  await update(metaRef, { gmUid: uid });

  // best-effort: manter 1 GM só
  try{
    await update(ref(db, `rooms/${roomId}/members/${uid}`), { role: "GM" });
    if(oldGmUid && oldGmUid !== uid){
      await update(ref(db, `rooms/${roomId}/members/${oldGmUid}`), { role: "PLAYER" });
    }
  }catch(_){}

  setGmKey(code, key);
  return { uid, oldGmUid, code, key };
}

function ensureObj(x){ return (x && typeof x === "object" && !Array.isArray(x)) ? x : {}; }

function debounce(fn, ms){
  let t = null;
  return (...args)=>{
    if(t) clearTimeout(t);
    t = setTimeout(()=> fn(...args), ms);
  };
}

function linkifyRole(role){
  return role === "GM" ? "GM" : "PLAYER";
}

// onValue com handler de erro para evitar "Uncaught (in promise) Object"
function onValueSafe(r, cb, label=""){
  return onValue(r, cb, (err)=>{
    console.error("RTDB permission/error", label, err);
    // tenta mostrar algo útil sem quebrar a página
    try{
      const msg = err?.message || err?.code || String(err);
      setStatus(`Erro RTDB${label ? " ("+label+")" : ""}: ${msg}`, "err");
    }catch(_){}
  });
}


/** --------------------------
 * Routing by page
 * -------------------------- */
const page = document.body?.dataset?.page || "";
onAuthStateChanged(auth, () => { /* keep firebase warm */ });

if(page === "index") initIndex();
if(page === "gm") initGM();
if(page === "player") initPlayer();

/** --------------------------
 * index.html
 * -------------------------- */
function initIndex(){
  const displayNameEl = $("#displayName");
  const roomCodeEl = $("#roomCode");
  const btnCreate = $("#btnCreate");
  const btnJoin = $("#btnJoin");
  const gmKeyEl = $("#gmKey");
  const btnJoinGM = $("#btnJoinGM");

  displayNameEl.value = localStorage.getItem("fo_displayName") || "";
  roomCodeEl.value = localStorage.getItem("fo_roomCode") || "";
  displayNameEl.addEventListener("input", ()=> localStorage.setItem("fo_displayName", displayNameEl.value));
  roomCodeEl.addEventListener("input", ()=> localStorage.setItem("fo_roomCode", roomCodeEl.value));

  if(gmKeyEl){
    const initCode = safeRoomCode(roomCodeEl.value);
    gmKeyEl.value = getGmKey(initCode) || localStorage.getItem("fo_gmKey_last") || "";
    gmKeyEl.addEventListener("input", ()=>{
      localStorage.setItem("fo_gmKey_last", gmKeyEl.value);
      const code = safeRoomCode(roomCodeEl.value);
      if(code) setGmKey(code, normalizeGmKey(gmKeyEl.value));
    });
    roomCodeEl.addEventListener("input", ()=>{
      const code = safeRoomCode(roomCodeEl.value);
      const stored = code ? getGmKey(code) : "";
      if(stored) gmKeyEl.value = stored;
    });
  }

  btnCreate.addEventListener("click", async () => {
    setStatus("Autenticando...", "warn");
    try{
      const user = await ensureAnonAuth();
      const displayName = safeName(displayNameEl.value);
      const roomCode = safeRoomCode(roomCodeEl.value);
      if(!displayName) return setStatus("Preencha displayName.", "err");
      if(!roomCode) return setStatus("Preencha roomCode.", "err");

      setStatus("Verificando código...", "warn");
      const codeRef = ref(db, `roomsByCode/${roomCode}`);
      const snap = await get(codeRef);
      if(snap.exists()) return setStatus("código já usado", "err");

      const roomId = push(ref(db, "rooms")).key;
      const gmUid = user.uid;
      const ts = serverTimestamp();

      const updates = {};
      updates[`roomsByCode/${roomCode}`] = roomId;
      updates[`rooms/${roomId}/meta`] = { code: roomCode, createdAt: ts, gmUid };
      updates[`rooms/${roomId}/members/${gmUid}`] = { role: "GM", displayName, joinedAt: ts };

      await update(ref(db), updates);

      // Chave do GM (para recuperar em outro navegador/dispositivo)
      const gmKey = generateGmKey();
      const gmKeyNorm = normalizeGmKey(gmKey);
      try{
        const hash = await sha256Hex(gmKeyNorm);
        await set(ref(db, `rooms/${roomId}/secrets/gmKeyHash`), hash);
        setGmKey(roomCode, gmKeyNorm);
        localStorage.setItem("fo_gmKey_last", gmKeyNorm);
      }catch(e){
        console.warn("Falha ao salvar chave do GM no DB:", e);
      }
      if(gmKeyEl) gmKeyEl.value = gmKeyNorm;
      try{ window.prompt("Chave do GM (guarde para recuperar):", gmKeyNorm); }catch(_){ }

      setStatus("Mesa criada. Redirecionando...", "ok");
      location.href = `./app/gm.html?roomId=${encodeURIComponent(roomId)}`;
    }catch(e){
      console.error(e);
      setStatus(`Erro: ${e?.message || e}`, "err");
    }
  });

  btnJoin.addEventListener("click", async () => {
    setStatus("Autenticando...", "warn");
    try{
      const user = await ensureAnonAuth();
      const displayName = safeName(displayNameEl.value);
      const roomCode = safeRoomCode(roomCodeEl.value);
      if(!displayName) return setStatus("Preencha displayName.", "err");
      if(!roomCode) return setStatus("Preencha roomCode.", "err");

      setStatus("Resolvendo mesa...", "warn");
      const codeSnap = await get(ref(db, `roomsByCode/${roomCode}`));
      if(!codeSnap.exists()) return setStatus("mesa não encontrada", "err");

      const roomId = codeSnap.val();
      const uid = user.uid;
      const ts = serverTimestamp();

      await set(ref(db, `rooms/${roomId}/members/${uid}`), { role:"PLAYER", displayName, joinedAt: ts });

      setStatus("Entrou. Redirecionando...", "ok");
      location.href = `./app/player.html?roomId=${encodeURIComponent(roomId)}`;
    }catch(e){
      console.error(e);
      setStatus(`Erro: ${e?.message || e}`, "err");
    }
  });

  btnJoinGM?.addEventListener("click", async () => {
    setStatus("Autenticando...", "warn");
    try{
      await ensureAnonAuth();
      const displayName = safeName(displayNameEl.value);
      const roomCode = safeRoomCode(roomCodeEl.value);
      const gmKey = gmKeyEl ? gmKeyEl.value : getGmKey(roomCode);
      if(!displayName) return setStatus("Preencha displayName.", "err");
      if(!roomCode) return setStatus("Preencha roomCode.", "err");
      if(!gmKey) return setStatus("Preencha a chave do GM.", "err");

      setStatus("Resolvendo mesa...", "warn");
      const codeSnap = await get(ref(db, `roomsByCode/${roomCode}`));
      if(!codeSnap.exists()) return setStatus("mesa não encontrada", "err");

      const roomId = codeSnap.val();
      setStatus("Reivindicando GM...", "warn");
      await claimGmWithKey({ roomId, roomCode, displayName, gmKey });

      setStatus("OK. Redirecionando...", "ok");
      location.href = `./app/gm.html?roomId=${encodeURIComponent(roomId)}`;
    }catch(e){
      console.error(e);
      setStatus(`Erro: ${e?.message || e}`, "err");
    }
  });
}

/** --------------------------
 * GM
 * -------------------------- */
function initGM(){
  const roomId = mustRoomId();
  const roomIdOut = $("#roomIdOut");
  if(roomIdOut) roomIdOut.textContent = roomId;

  $("#btnSignOut")?.addEventListener("click", async () => {
    await signOut(auth);
    location.href = "../index.html";
  });

  const roomCodeOut = $("#roomCodeOut");
  const gmKeyOut = $("#gmKeyOut");
  const btnCopyGmKey = $("#btnCopyGmKey");
  const membersList = $("#membersList");
  const sheetsList = $("#sheetsList");

  const btnNewSheet = $("#btnNewSheet");
  const sheetForm = $("#sheetForm");
  const sheetIdEl = $("#sheetId");
  const sheetNameEl = $("#sheetName");
  const attrQI = $("#attrQI");
  const attrFOR = $("#attrFOR");
  const attrDEX = $("#attrDEX");
  const attrVIG = $("#attrVIG");
  const mentalEl = $("#mental");
  const sharedNotesEl = $("#sharedNotes");
  const btnDeleteSheet = $("#btnDeleteSheet");
  const btnSaveSheet = $("#btnSaveSheet");
  const btnCancelSheet = $("#btnCancelSheet");

  const assignPlayer = $("#assignPlayer");
  const assignSheet = $("#assignSheet");
  const btnAssign = $("#btnAssign");
  const btnUnassign = $("#btnUnassign");

  const importText = $("#importText");
  const importFile = $("#importFile");
  const importMode = $("#importMode");
  const btnValidateImport = $("#btnValidateImport");
  const btnDoImport = $("#btnDoImport");
  const importReport = $("#importReport");

  // Entry CRUD UI
  const itemsCrudList = $("#itemsCrudList");
  const advantagesCrudList = $("#advantagesCrudList");
  const disadvantagesCrudList = $("#disadvantagesCrudList");
  const btnAddItem = $("#btnAddItem");
  const btnAddAdv = $("#btnAddAdv");
  const btnAddDis = $("#btnAddDis");

  const entryCategory = $("#entryCategory");
  const entryId = $("#entryId");
  const entryName = $("#entryName");
  const entryType = $("#entryType");
  const entryAttrBase = $("#entryAttrBase");
  const entryModMode = $("#entryModMode");
  const entryModValue = $("#entryModValue");
  const entryUsesCurrent = $("#entryUsesCurrent");
  const entryUsesMax = $("#entryUsesMax");
  const entryNotes = $("#entryNotes");
  const btnSaveEntry = $("#btnSaveEntry");
  const btnDeleteEntry = $("#btnDeleteEntry");
  const btnClearEntry = $("#btnClearEntry");

  // optional editor pane controls (if present in gm.html)
  const sheetEditorPane = $("#sheetEditorPane");
  const sheetEditorEmpty = $("#sheetEditorEmpty");
  function openEditor(){
    sheetEditorPane?.classList.remove("hidden");
    sheetEditorEmpty?.classList.add("hidden");
  }
  function closeEditor(){
    sheetEditorPane?.classList.add("hidden");
    sheetEditorEmpty?.classList.remove("hidden");
  }

  // State
  let userUid = null;
  let meta = null;
  let members = {};
  let sheets = {};
  let currentSheetId = null; // slug
  let gmNotesUnsub = null;
  let gmNotesLocalEditing = false;
  let currentSheetDraft = null; // {items,advantages,disadvantages}

  function debounce(fn, ms){
    let t = null;
    return (...args)=>{
      if(t) clearTimeout(t);
      t = setTimeout(()=> fn(...args), ms);
    };
  }


  function emptyEntry(){
    return {
      name: "",
      type: "PASSIVA",
      atributoBase: null,
      modValue: null,
      modMode: "NONE",
      usesCurrent: null,
      usesMax: null,
      notes: null
    };
  }

  function normalizeEntryPayload(e){
    const out = {};
    out.name = String(e?.name || "").trim().slice(0,80);
    out.type = (e?.type === "ATIVA") ? "ATIVA" : "PASSIVA";
    out.atributoBase = (["QI","FOR","DEX","VIG","INTENCOES","DEF","MOV","INV"].includes(e?.atributoBase)) ? e.atributoBase : null;

    const mm = e?.modMode;
    out.modMode = (mm === "SOMA" || mm === "MULT" || mm === "NONE") ? mm : "NONE";

    if(out.modMode === "NONE"){
      out.modValue = null;
    }else{
      const mv = Number(e?.modValue);
      out.modValue = Number.isFinite(mv) ? mv : 0;
    }

    const uc = e?.usesCurrent;
    const um = e?.usesMax;
    out.usesCurrent = (uc === null || uc === undefined || uc === "") ? null : (Number.isFinite(Number(uc)) ? Math.trunc(Number(uc)) : null);
    out.usesMax = (um === null || um === undefined || um === "") ? null : (Number.isFinite(Number(um)) ? Math.trunc(Number(um)) : null);
    out.notes = (e?.notes === null || e?.notes === undefined) ? null : String(e.notes).slice(0,800);

    return out;
  }

  function clearEntryEditor(){
    if(!entryCategory) return;
    entryCategory.value = "items";
    entryId.value = "";
    entryName.value = "";
    entryType.value = "PASSIVA";
    entryAttrBase.value = "";
    entryModMode.value = "NONE";
    entryModValue.value = "";
    entryUsesCurrent.value = "";
    entryUsesMax.value = "";
    entryNotes.value = "";
  }

  function nextAvailableEntryId(category, baseSlug){
    const obj = ensureObj(currentSheetDraft?.[category]);
    if(!obj[baseSlug]) return baseSlug;
    for(let i=2;i<200;i++){
      const cand = `${baseSlug}-${i}`;
      if(!obj[cand]) return cand;
    }
    throw new Error("Não foi possível gerar sufixo disponível (registro).");
  }

  function renderEntryLists(){
    renderEntryList(itemsCrudList, "items");
    renderEntryList(advantagesCrudList, "advantages");
    renderEntryList(disadvantagesCrudList, "disadvantages");
  }

  function renderEntryList(container, category){
    if(!container) return;
    container.innerHTML = "";
    const obj = ensureObj(currentSheetDraft?.[category]);
    const entries = Object.entries(obj);
    if(entries.length === 0){
      container.innerHTML = '<div class="muted">(vazio)</div>';
      return;
    }

    entries
      .sort((a,b)=> (a[1]?.name || "").localeCompare(b[1]?.name || ""))
      .forEach(([id, e]) => {
        const div = document.createElement("div");
        div.className = "item";

        const badges = [
          `<span class="badge">${escapeHtml(e?.type || "")}</span>`,
          e?.atributoBase ? `<span class="badge">${escapeHtml(e.atributoBase)}</span>` : `<span class="badge">sem atributo</span>`,
          `<span class="badge">${escapeHtml(e?.modMode || "NONE")}</span>`,
          (e?.modMode !== "NONE" && e?.modValue !== null && e?.modValue !== undefined) ? `<span class="badge">${escapeHtml(String(e.modValue))}</span>` : ""
        ].filter(Boolean).join(" ");

        const uses = ((e?.usesCurrent !== null && e?.usesCurrent !== undefined) || (e?.usesMax !== null && e?.usesMax !== undefined))
          ? `<span class="badge">uses ${e?.usesCurrent ?? "?"}/${e?.usesMax ?? "?"}</span>`
          : "";

        div.innerHTML = `
          <div class="meta">
            <div class="title">${escapeHtml(e?.name || "(sem nome)")}</div>
            <div class="kv">${badges} ${uses}</div>
          </div>
          <div class="row" style="margin:0">
            <button class="btn small" data-edit="1">Editar</button>
          </div>
        `;
        div.querySelector("[data-edit]")?.addEventListener("click", () => selectEntry(category, id));
        container.appendChild(div);
      });
  }

  function selectEntry(category, id){
    const obj = ensureObj(currentSheetDraft?.[category]);
    const e = obj[id];
    if(!e) return;

    entryCategory.value = category;
    entryId.value = id;
    entryName.value = e.name || "";
    entryType.value = (e.type === "ATIVA") ? "ATIVA" : "PASSIVA";
    entryAttrBase.value = e.atributoBase || "";
    entryModMode.value = (e.modMode === "SOMA" || e.modMode === "MULT" || e.modMode === "NONE") ? e.modMode : "NONE";
    entryModValue.value = (e.modValue === null || e.modValue === undefined) ? "" : String(e.modValue);
    entryUsesCurrent.value = (e.usesCurrent === null || e.usesCurrent === undefined) ? "" : String(e.usesCurrent);
    entryUsesMax.value = (e.usesMax === null || e.usesMax === undefined) ? "" : String(e.usesMax);
    entryNotes.value = (e.notes === null || e.notes === undefined) ? "" : String(e.notes);

    setStatus("Registro carregado no editor.", "ok");
  }

  function createNewEntry(category){
    if(!currentSheetDraft){
      setStatus("Selecione/crie uma ficha primeiro.", "err");
      return;
    }
    // cria temporário; ao salvar, move para slug(name)
    const tmpId = push(ref(db, `rooms/${roomId}/_tmp`)).key;
    currentSheetDraft[category] = ensureObj(currentSheetDraft[category]);
    currentSheetDraft[category][tmpId] = emptyEntry();
    renderEntryLists();
    selectEntry(category, tmpId);
    setStatus("Novo registro criado (draft). Defina o nome e clique Salvar registro.", "ok");
  }

  btnAddItem?.addEventListener("click", ()=> createNewEntry("items"));
  btnAddAdv?.addEventListener("click", ()=> createNewEntry("advantages"));
  btnAddDis?.addEventListener("click", ()=> createNewEntry("disadvantages"));

  btnSaveEntry?.addEventListener("click", ()=>{
    const category = entryCategory.value;
    const oldId = entryId.value;
    if(!currentSheetDraft) return setStatus("Sem ficha carregada.", "err");

    const payload = normalizeEntryPayload({
      name: entryName.value,
      type: entryType.value,
      atributoBase: entryAttrBase.value || null,
      modMode: entryModMode.value,
      modValue: entryModValue.value,
      usesCurrent: entryUsesCurrent.value,
      usesMax: entryUsesMax.value,
      notes: entryNotes.value
    });

    if(!payload.name) return setStatus("Nome do registro é obrigatório.", "err");

    const baseSlug = slugify(payload.name);
    if(!baseSlug) return setStatus("Nome inválido para gerar ID do registro.", "err");

    currentSheetDraft[category] = ensureObj(currentSheetDraft[category]);

    let finalId = baseSlug;
    if(!oldId){
      finalId = nextAvailableEntryId(category, baseSlug);
    }else if(oldId !== baseSlug){
      if(currentSheetDraft[category][baseSlug] && baseSlug !== oldId){
        const overwrite = confirm(`Já existe um registro "${baseSlug}" nesta categoria.\n\nOK = sobrescrever\nCancelar = criar sufixo (-2, -3...)`);
        finalId = overwrite ? baseSlug : nextAvailableEntryId(category, baseSlug);
      }else{
        finalId = baseSlug;
      }
    }else{
      finalId = oldId;
    }

    currentSheetDraft[category][finalId] = payload;
    if(oldId && oldId !== finalId) delete currentSheetDraft[category][oldId];

    renderEntryLists();
    selectEntry(category, finalId);
    setStatus("Registro salvo no draft (salvar ficha para persistir).", "ok");
  });

  btnDeleteEntry?.addEventListener("click", ()=>{
    const category = entryCategory.value;
    const id = entryId.value;
    if(!currentSheetDraft) return setStatus("Sem ficha carregada.", "err");
    if(!id) return setStatus("Selecione um registro para deletar.", "err");

    const obj = ensureObj(currentSheetDraft[category]);
    if(!obj[id]) return setStatus("Registro não existe.", "warn");
    delete obj[id];
    currentSheetDraft[category] = obj;

    renderEntryLists();
    clearEntryEditor();
    setStatus("Registro removido do draft (salvar ficha para persistir).", "ok");
  });

  btnClearEntry?.addEventListener("click", ()=>{
    clearEntryEditor();
    setStatus("Seleção limpa.", "ok");
  });

  if(sharedNotesEl){
    const saveNotes = debounce(async ()=>{
      if(!currentSheetId) return;
      try{
        await set(ref(db, `rooms/${roomId}/sheets/${currentSheetId}/sharedNotes`), String(sharedNotesEl.value || ""));
        setStatus("Anotações salvas.", "ok");
      }catch(e){
        console.error(e);
        setStatus(`Erro ao salvar anotações: ${e?.message || e}`, "err");
      }
    }, 400);

    sharedNotesEl.addEventListener("input", ()=>{
      gmNotesLocalEditing = true;
      saveNotes();
    });
    sharedNotesEl.addEventListener("blur", ()=>{ gmNotesLocalEditing = false; });
  }

  // ---- Sheets ----
  function numOr0(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }
  function intOr0(v){ const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : 0; }

  function renderMembers(){
    if(!membersList) return;
    membersList.innerHTML = "";
    const entries = Object.entries(members);
    if(entries.length === 0){
      membersList.innerHTML = '<div class="muted">Nenhum membro.</div>';
      return;
    }
    entries
      .sort((a,b)=> (a[1]?.role === "GM" ? 0 : 1) - (b[1]?.role === "GM" ? 0 : 1))
      .forEach(([uid, m]) => {
        const div = document.createElement("div");
        div.className = "item";
        div.innerHTML = `
          <div class="meta">
            <div class="title">${escapeHtml(m?.displayName || "(sem nome)")}</div>
            <div class="sub">${escapeHtml(linkifyRole(m?.role))}</div>
          </div>
        `;
        membersList.appendChild(div);
      });
  }

  function renderSheets(){
    if(!sheetsList) return;
    sheetsList.innerHTML = "";
    const entries = Object.entries(sheets);
    if(entries.length === 0){
      sheetsList.innerHTML = '<div class="muted">Nenhuma ficha.</div>';
      return;
    }
    entries
      .sort((a,b)=> (a[1]?.name || "").localeCompare(b[1]?.name || ""))
      .forEach(([id, s]) => {
        const div = document.createElement("div");
        div.className = "item";
        div.innerHTML = `
          <div class="meta">
            <div class="title">${escapeHtml(s?.name || "(sem nome)")}</div>
            <div class="sub"><code>${id}</code> • QI:${numOr0(s?.attributes?.QI)} FOR:${numOr0(s?.attributes?.FOR)} DEX:${numOr0(s?.attributes?.DEX)} VIG:${numOr0(s?.attributes?.VIG)} • Mental:${intOr0(s?.mental)}</div>
          </div>
          <div class="row" style="margin:0">
            <button class="btn small" data-edit="1">Editar</button>
          </div>
        `;
        div.querySelector("[data-edit]")?.addEventListener("click", () => loadSheetIntoForm(id, true));
        sheetsList.appendChild(div);
      });
  }

  function renderAssignPlayers(){
    if(!assignPlayer) return;
    const players = Object.entries(members)
      .filter(([,m]) => (m?.role === "PLAYER"))
      .map(([uid,m]) => ({ uid, name: m?.displayName || uid }))
      .sort((a,b)=> a.name.localeCompare(b.name));

    assignPlayer.innerHTML = "";
    if(players.length === 0){
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Nenhum player";
      assignPlayer.appendChild(opt);
      assignPlayer.disabled = true;
    }else{
      assignPlayer.disabled = false;
      for(const p of players){
        const opt = document.createElement("option");
        opt.value = p.uid;
        opt.textContent = `${p.name}`;
        assignPlayer.appendChild(opt);
      }
    }
  }

  function renderAssignSheets(){
    if(!assignSheet) return;
    const list = Object.entries(sheets)
      .map(([id,s]) => ({ id, name: s?.name || id }))
      .sort((a,b)=> a.name.localeCompare(b.name));

    assignSheet.innerHTML = "";
    if(list.length === 0){
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Nenhuma ficha";
      assignSheet.appendChild(opt);
      assignSheet.disabled = true;
    }else{
      assignSheet.disabled = false;
      for(const s of list){
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = `${s.name}`;
        assignSheet.appendChild(opt);
      }
    }
  }

  function clearForm(){
    sheetIdEl.value = "";
    sheetNameEl.value = "";
    attrQI.value = 0;
    attrFOR.value = 0;
    attrDEX.value = 0;
    attrVIG.value = 0;
    mentalEl.value = 0;
    if(sharedNotesEl) sharedNotesEl.value = "";
    if(gmNotesUnsub){ try{ gmNotesUnsub(); }catch(_){} gmNotesUnsub = null; }
    $("#sheetFormTitle") && ($("#sheetFormTitle").textContent = "Criar");
    if(btnSaveSheet) btnSaveSheet.textContent = "Criar ficha";
    if(btnDeleteSheet) btnDeleteSheet.classList.add("hidden");
    currentSheetId = null;
    currentSheetDraft = { items:{}, advantages:{}, disadvantages:{} };
    renderEntryLists();
    clearEntryEditor();
    closeEditor();
  }

  async function nextAvailableSlug(baseSlug){
    for(let i=2;i<200;i++){
      const cand = `${baseSlug}-${i}`;
      const snap = await get(ref(db, `rooms/${roomId}/sheets/${cand}`));
      if(!snap.exists()) return cand;
    }
    throw new Error("Não foi possível gerar sufixo disponível.");
  }

  async function resolveSlugForCreate(baseSlug){
    const snap = await get(ref(db, `rooms/${roomId}/sheets/${baseSlug}`));
    if(!snap.exists()) return baseSlug;
    const overwrite = confirm(`Já existe uma ficha com ID "${baseSlug}".\n\nOK = sobrescrever (MERGE)\nCancelar = criar com sufixo (-2, -3...)`);
    if(overwrite) return baseSlug;
    return await nextAvailableSlug(baseSlug);
  }

  async function resolveSlugForImport(baseSlug, mode, existingSet){
    if(mode === "MERGE") return baseSlug;
    if(!existingSet.has(baseSlug)) return baseSlug;
    for(let i=2;i<200;i++){
      const cand = `${baseSlug}-${i}`;
      if(!existingSet.has(cand)) return cand;
    }
    throw new Error("Não foi possível gerar sufixo disponível (import).");
  }

  function loadSheetIntoForm(id, userAction){
    const s = sheets[id];
    if(!s) return;
    openEditor();

    currentSheetId = id;
    sheetIdEl.value = id;
    sheetNameEl.value = s.name || "";
    attrQI.value = numOr0(s?.attributes?.QI);
    attrFOR.value = numOr0(s?.attributes?.FOR);
    attrDEX.value = numOr0(s?.attributes?.DEX);
    attrVIG.value = numOr0(s?.attributes?.VIG);
    mentalEl.value = intOr0(s?.mental);

    // Shared notes live-sync
    if(sharedNotesEl){
      sharedNotesEl.value = String(s?.sharedNotes || "");
      gmNotesLocalEditing = false;
      if(gmNotesUnsub) { try{ gmNotesUnsub(); }catch(_){} }
      gmNotesUnsub = onValueSafe(ref(db, `rooms/${roomId}/sheets/${id}/sharedNotes`), (ns)=>{
        if(gmNotesLocalEditing) return;
        sharedNotesEl.value = String(ns.val() || "");
      }, "gmSharedNotes");
    }

    currentSheetDraft = {
      items: ensureObj(s?.items),
      advantages: ensureObj(s?.advantages),
      disadvantages: ensureObj(s?.disadvantages),
    };

    $("#sheetFormTitle") && ($("#sheetFormTitle").textContent = `Editar: ${s.name || id}`);
    if(btnSaveSheet) btnSaveSheet.textContent = "Salvar ficha";
    if(btnDeleteSheet) btnDeleteSheet.classList.remove("hidden");
    renderEntryLists();
    if(userAction){
      clearEntryEditor();
      setStatus("Ficha carregada.", "ok");
    }
  }

  btnNewSheet?.addEventListener("click", () => {
    clearForm();
    openEditor();
    setStatus("Nova ficha (draft).", "ok");
  });

  btnCancelSheet?.addEventListener("click", () => {
    clearForm();
    toast("Cancelado.", "warn");
    setStatus("Cancelado.", "warn");
  });


  sheetForm?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try{
      if(!meta || meta.gmUid !== userUid) return setStatus("Sem permissão.", "err");

      const name = String(sheetNameEl.value || "").trim();
      if(!name) return setStatus("Nome é obrigatório.", "err");

      const desiredSlug = slugify(name);
      if(!desiredSlug) return setStatus("Nome inválido para gerar slug.", "err");

      const oldId = sheetIdEl.value || "";
      let finalId = desiredSlug;

      if(!oldId){
        setStatus("Resolvendo slug...", "warn");
        finalId = await resolveSlugForCreate(desiredSlug);
      }else if(oldId !== desiredSlug){
        setStatus("Renomeando (slug mudou)...", "warn");
        const existsSnap = await get(ref(db, `rooms/${roomId}/sheets/${desiredSlug}`));
        if(existsSnap.exists()){
          const overwrite = confirm(`Já existe uma ficha com ID "${desiredSlug}".\n\nOK = sobrescrever (MERGE)\nCancelar = criar com sufixo (-2, -3...)`);
          finalId = overwrite ? desiredSlug : await nextAvailableSlug(desiredSlug);
        }else{
          finalId = desiredSlug;
        }
      }else{
        finalId = oldId;
      }

      const ts = serverTimestamp();
      const payload = {
        name,
        attributes: {
          QI: asNum(attrQI.value, 0),
          FOR: asNum(attrFOR.value, 0),
          DEX: asNum(attrDEX.value, 0),
          VIG: asNum(attrVIG.value, 0),
        },
        mental: asInt(mentalEl.value, 0),
        sharedNotes: sharedNotesEl ? String(sharedNotesEl.value || "") : (sheets[oldId]?.sharedNotes || ""),
        items: ensureObj(currentSheetDraft?.items),
        advantages: ensureObj(currentSheetDraft?.advantages),
        disadvantages: ensureObj(currentSheetDraft?.disadvantages),
        createdAt: oldId && sheets[oldId]?.createdAt ? sheets[oldId].createdAt : ts,
        updatedAt: ts,
      };

      const updates = {};
      updates[`rooms/${roomId}/sheets/${finalId}`] = payload;

      if(oldId && oldId !== finalId){
        updates[`rooms/${roomId}/sheets/${oldId}`] = null;

        const asSnap = await get(ref(db, `rooms/${roomId}/assignments`));
        const asObj = asSnap.val() || {};
        for(const [uid, a] of Object.entries(asObj)){
          // legacy: sheetId único
          if(a?.sheetId === oldId){
            updates[`rooms/${roomId}/assignments/${uid}/sheetId`] = finalId;
          }

          // novo: sheetIds map
          const m = a?.sheetIds;
          if(m && typeof m === "object" && !Array.isArray(m) && (m[oldId] === true || m[oldId] === 1 || m[oldId] === "true")){
            updates[`rooms/${roomId}/assignments/${uid}/sheetIds/${oldId}`] = null;
            updates[`rooms/${roomId}/assignments/${uid}/sheetIds/${finalId}`] = true;
          }

          if(a?.primarySheetId === oldId){
            updates[`rooms/${roomId}/assignments/${uid}/primarySheetId`] = finalId;
          }
        }
      }

      await update(ref(db), updates);
      sheetIdEl.value = finalId;
      currentSheetId = finalId;
      setStatus(`Ficha salva: ${payload.name}`, "ok");
      toast("Salvo.", "ok");
      clearForm();
    }catch(e){
      console.error(e);
      setStatus(`Erro ao salvar: ${e?.message || e}`, "err");
    }
  });

  btnDeleteSheet?.addEventListener("click", async () => {
    try{
      const id = sheetIdEl.value;
      if(!id) return setStatus("Nenhuma ficha selecionada.", "warn");
      if(!sheets[id]) return setStatus("Ficha já não existe.", "warn");

      const asSnap = await get(ref(db, `rooms/${roomId}/assignments`));
      const asObj = asSnap.val() || {};

      const updates = {};
      updates[`rooms/${roomId}/sheets/${id}`] = null;

      for(const [uid, a] of Object.entries(asObj)){
        const legacyId = (typeof a?.sheetId === "string") ? a.sheetId : null;

        const m = a?.sheetIds;
        const hasMap = (m && typeof m === "object" && !Array.isArray(m));
        const mapKeys = hasMap
          ? Object.keys(m).filter(k => k !== id && (m[k] === true || m[k] === 1 || m[k] === "true"))
          : [];

        const remainingLegacy = (legacyId && legacyId !== id) ? legacyId : null;

        const willRemoveLegacy = (legacyId === id);
        const willRemoveMap = hasMap && (m[id] === true || m[id] === 1 || m[id] === "true");

        const remainingCount = (remainingLegacy ? 1 : 0) + mapKeys.length;

        // se a atribuição só apontava pra essa ficha, remove toda a assignment
        if(remainingCount === 0){
          if(willRemoveLegacy || willRemoveMap){
            updates[`rooms/${roomId}/assignments/${uid}`] = null;
          }
          continue;
        }

        if(willRemoveLegacy){
          updates[`rooms/${roomId}/assignments/${uid}/sheetId`] = null;
        }
        if(willRemoveMap){
          updates[`rooms/${roomId}/assignments/${uid}/sheetIds/${id}`] = null;
        }

        if(a?.primarySheetId === id){
          const nextPrimary = remainingLegacy || mapKeys[0] || null;
          updates[`rooms/${roomId}/assignments/${uid}/primarySheetId`] = nextPrimary;
        }
      }

      await update(ref(db), updates);
      clearForm();
      setStatus("Ficha deletada.", "ok");
    }catch(e){
      console.error(e);
      setStatus(`Erro ao deletar: ${e?.message || e}`, "err");
    }
  });

  btnAssign?.addEventListener("click", async () => {
    try{
      const playerUid = assignPlayer.value;
      const sheetId = assignSheet.value;
      if(!playerUid) return setStatus("Selecione um player.", "err");
      if(!sheetId) return setStatus("Selecione uma ficha.", "err");

      // multi-fichas: assignments/<uid> = { sheetIds: {<sheetId>: true}, primarySheetId }
      const aRef = ref(db, `rooms/${roomId}/assignments/${playerUid}`);
      const aSnap = await get(aRef);
      const cur = aSnap.val() || {};

      const sheetIds = ensureObj(cur.sheetIds);

      // migração do formato antigo (sheetId único)
      const legacy = (typeof cur.sheetId === "string" && cur.sheetId.trim()) ? cur.sheetId.trim() : null;
      if(legacy) sheetIds[legacy] = true;

      sheetIds[sheetId] = true;

      const primary = (typeof cur.primarySheetId === "string" && cur.primarySheetId.trim())
        ? cur.primarySheetId.trim()
        : (legacy || sheetId);

      await set(aRef, { sheetIds, primarySheetId: primary });

      setStatus("Atribuição salva (multi-fichas).", "ok");
    }catch(e){
      console.error(e);
      setStatus(`Erro ao atribuir: ${e?.message || e}`, "err");
    }
  });


  btnUnassign?.addEventListener("click", async () => {
    try{
      const playerUid = assignPlayer.value;
      const sheetId = assignSheet.value;
      if(!playerUid) return setStatus("Selecione um player.", "err");
      if(!sheetId) return setStatus("Selecione uma ficha.", "err");

      const aRef = ref(db, `rooms/${roomId}/assignments/${playerUid}`);
      const aSnap = await get(aRef);
      const cur = aSnap.val() || {};

      const sheetIds = ensureObj(cur.sheetIds);

      // migração do formato antigo
      const legacy = (typeof cur.sheetId === "string" && cur.sheetId.trim()) ? cur.sheetId.trim() : null;
      if(legacy) sheetIds[legacy] = true;

      // remover
      delete sheetIds[sheetId];
      const remaining = Object.keys(sheetIds).filter(k => sheetIds[k] === true || sheetIds[k] === 1 || sheetIds[k] === "true");

      // ajustar primária
      const curPrimary = (typeof cur.primarySheetId === "string" && cur.primarySheetId.trim()) ? cur.primarySheetId.trim() : null;
      const nextPrimary = (curPrimary === sheetId) ? (remaining[0] || null) : (curPrimary || remaining[0] || null);

      if(remaining.length === 0){
        await set(aRef, null);
        setStatus("Atribuição removida (player ficou sem fichas).", "ok");
        return;
      }

      await set(aRef, { sheetIds, primarySheetId: nextPrimary });

      setStatus("Ficha removida do player.", "ok");
    }catch(e){
      console.error(e);
      setStatus(`Erro ao remover: ${e?.message || e}`, "err");
    }
  });

  importFile?.addEventListener("change", async () => {
    const f = importFile.files?.[0];
    if(!f) return;
    importText.value = await f.text();
    setStatus("Arquivo carregado no textarea.", "ok");
  });

  btnValidateImport?.addEventListener("click", async () => {
    const report = await validateImport();
    importReport.textContent = JSON.stringify(report, null, 2);
    setStatus(report.ok ? "Validação OK." : "Validação com erros.", report.ok ? "ok" : "err");
  });

  btnDoImport?.addEventListener("click", async () => {
    try{
      const report = await validateImport();
      importReport.textContent = JSON.stringify(report, null, 2);
      if(!report.ok) return setStatus("Corrija os erros antes de importar.", "err");

      const mode = importMode.value === "CREATE_ONLY" ? "CREATE_ONLY" : "MERGE";

      setStatus("Carregando estado atual...", "warn");
      const sheetsSnap = await get(ref(db, `rooms/${roomId}/sheets`));
      const existing = sheetsSnap.val() || {};
      const existingIds = new Set(Object.keys(existing));

      const ts = serverTimestamp();
      const updates = {};

      for(const entry of report.normalizedSheets){
        const baseSlug = entry.sheetIdSlug;
        const finalSlug = await resolveSlugForImport(baseSlug, mode, existingIds);
        existingIds.add(finalSlug);

        const payload = {
          name: entry.name,
          attributes: entry.attributes,
          mental: entry.mental,
          items: arrayToObject(entry.items),
          advantages: arrayToObject(entry.advantages),
          disadvantages: arrayToObject(entry.disadvantages),
          createdAt: existing[finalSlug]?.createdAt || ts,
          updatedAt: ts,
        };

        updates[`rooms/${roomId}/sheets/${finalSlug}`] = payload;
      }

      if(Object.keys(updates).length === 0){
        setStatus("Nada para importar.", "warn");
        return;
      }

      setStatus(`Importando ${report.normalizedSheets.length} fichas...`, "warn");
      await update(ref(db), updates);
      setStatus("Import concluído.", "ok");
    }catch(e){
      console.error(e);
      setStatus(`Erro no import: ${e?.message || e}`, "err");
    }
  });

  function arrayToObject(arr){
    const a = Array.isArray(arr) ? arr : [];
    const out = {};
    for(const raw of a){
      const payload = normalizeEntryPayload(raw);
      if(!payload.name) continue;
      const id = slugify(payload.name) || push(ref(db, `rooms/${roomId}/_tmpEntry`)).key;
      // garante unicidade
      const finalId = out[id] ? (()=>{
        for(let i=2;i<200;i++){
          const cand = `${id}-${i}`;
          if(!out[cand]) return cand;
        }
        return push(ref(db, `rooms/${roomId}/_tmpEntry`)).key;
      })() : id;
      out[finalId] = payload;
    }
    return out;
  }

  async function validateImport(){
    const rawText = String(importText.value || "").trim();
    if(!rawText) return { ok:false, errors:["JSON vazio."], normalizedSheets:[] };

    const parsed = parseJsonLenient(rawText);
    if(!parsed.ok) return { ok:false, errors:[`JSON inválido: ${parsed.error}`], normalizedSheets:[] };

    const obj = parsed.value;
    if(!obj || typeof obj !== "object") return { ok:false, errors:["Raiz deve ser objeto."], normalizedSheets:[] };
    const sheetsArr = obj.sheets;
    if(!Array.isArray(sheetsArr)) return { ok:false, errors:["Campo 'sheets' deve ser array."], normalizedSheets:[] };

    const errors = [];
    const normalizedSheets = [];

    sheetsArr.forEach((s, idx) => {
      if(!s || typeof s !== "object"){
        errors.push(`sheets[${idx}] deve ser objeto.`);
        return;
      }

      const name = typeof s.name === "string" ? s.name.trim() : "";
      if(!name) errors.push(`sheets[${idx}].name obrigatório (string).`);

      const sheetIdRaw = (typeof s.sheetId === "string") ? s.sheetId.trim() : "";
      const sheetIdSlug = slugify(sheetIdRaw || name);
      if(!sheetIdSlug) errors.push(`sheets[${idx}] slug inválido (name/sheetId).`);

      const a = s.attributes;
      const attrs = { QI:0, FOR:0, DEX:0, VIG:0 };
      if(a && typeof a === "object" && !Array.isArray(a)){
        for(const k of ["QI","FOR","DEX","VIG"]){
          const v = a[k];
          if(v === undefined) continue;
          if(typeof v !== "number" || !Number.isFinite(v)) errors.push(`sheets[${idx}].attributes.${k} deve ser número.`);
          else attrs[k] = v;
        }
      }else if(a !== undefined){
        errors.push(`sheets[${idx}].attributes deve ser objeto.`);
      }

      const mental = s.mental;
      if(mental !== undefined){
        if(typeof mental !== "number" || !Number.isFinite(mental) || Math.trunc(mental) !== mental){
          errors.push(`sheets[${idx}].mental deve ser int.`);
        }
      }

      const items = Array.isArray(s.items) ? s.items : [];
      const advantages = Array.isArray(s.advantages) ? s.advantages : [];
      const disadvantages = Array.isArray(s.disadvantages) ? s.disadvantages : [];

      for(const [cat, arr] of [["items",items],["advantages",advantages],["disadvantages",disadvantages]]){
        if(!Array.isArray(arr)){
          errors.push(`sheets[${idx}].${cat} deve ser array.`);
          continue;
        }
        arr.forEach((e, j)=>{
          if(!e || typeof e !== "object"){
            errors.push(`sheets[${idx}].${cat}[${j}] deve ser objeto.`);
            return;
          }
          if(typeof e.name !== "string" || !e.name.trim()){
            errors.push(`sheets[${idx}].${cat}[${j}].name obrigatório.`);
          }
          if(e.type !== "ATIVA" && e.type !== "PASSIVA"){
            errors.push(`sheets[${idx}].${cat}[${j}].type deve ser ATIVA|PASSIVA.`);
          }
          if(e.atributoBase !== null && e.atributoBase !== undefined && e.atributoBase !== "" && !["QI","FOR","DEX","VIG"].includes(e.atributoBase)){
            errors.push(`sheets[${idx}].${cat}[${j}].atributoBase inválido.`);
          }
          if(e.modMode !== undefined && !["SOMA","MULT","NONE"].includes(e.modMode)){
            errors.push(`sheets[${idx}].${cat}[${j}].modMode inválido.`);
          }
          if(e.modMode && e.modMode !== "NONE" && e.modValue !== undefined){
            const mv = Number(e.modValue);
            if(!Number.isFinite(mv)) errors.push(`sheets[${idx}].${cat}[${j}].modValue deve ser número.`);
          }
          if(e.usesCurrent !== undefined && e.usesCurrent !== null && e.usesCurrent !== ""){
            const uc = Number(e.usesCurrent);
            if(!Number.isFinite(uc) || Math.trunc(uc) !== uc) errors.push(`sheets[${idx}].${cat}[${j}].usesCurrent deve ser int.`);
          }
          if(e.usesMax !== undefined && e.usesMax !== null && e.usesMax !== ""){
            const um = Number(e.usesMax);
            if(!Number.isFinite(um) || Math.trunc(um) !== um) errors.push(`sheets[${idx}].${cat}[${j}].usesMax deve ser int.`);
          }
        });
      }

      normalizedSheets.push({
        sheetIdSlug,
        name,
        attributes: attrs,
        mental: mental === undefined ? 0 : Math.trunc(mental),
        items,
        advantages,
        disadvantages
      });
    });

    return {
      ok: errors.length === 0,
      errors,
      count: normalizedSheets.length,
      normalizedSheets
    };
  }

  // ---- realtime ----
  (async () => {
    setStatus("Autenticando...", "warn");
    const user = await ensureAnonAuth();
    userUid = user.uid;

    setStatus("Carregando meta...", "warn");
    const metaSnap = await get(ref(db, `rooms/${roomId}/meta`));
    if(!metaSnap.exists()){
      setStatus("Sala inválida (meta não existe).", "err");
      return;
    }
    meta = metaSnap.val();
    roomCodeOut && (roomCodeOut.textContent = meta.code || "?");

    if(gmKeyOut){
      const k = getGmKey(meta.code || "");
      gmKeyOut.value = k || "";
    }
    btnCopyGmKey?.addEventListener("click", async () => {
      try{
        const v = String(gmKeyOut?.value || "");
        if(!v) return setStatus("Sem chave neste navegador.", "warn");
        await navigator.clipboard.writeText(v);
        setStatus("Chave copiada.", "ok");
      }catch(e){
        console.error(e);
        setStatus("Falha ao copiar (clipboard).", "err");
      }
    });

    if(meta.gmUid !== userUid){
      const storedKey = getGmKey(meta.code || "");
      if(storedKey){
        setStatus("Reivindicando GM pela chave...", "warn");
        try{
          await claimGmWithKey({ roomId, roomCode: meta.code, displayName: localStorage.getItem("fo_displayName") || "GM", gmKey: storedKey });
          setStatus("GM recuperado. Recarregando...", "ok");
          location.reload();
          return;
        }catch(e){
          console.error(e);
        }
      }
      setStatus("Acesso negado: você não é o GM desta sala (use a chave do GM).", "err");
      return;
    }

    setStatus("OK. Sincronizando...", "ok");

    onValueSafe(ref(db, `rooms/${roomId}/members`), (snap) => {
      members = snap.val() || {};
      renderMembers();
      renderAssignPlayers();
    }, "members");

    onValueSafe(ref(db, `rooms/${roomId}/sheets`), (snap) => {
      sheets = snap.val() || {};
      renderSheets();
      renderAssignSheets();
      // não sobrescrever o editor automaticamente
    }, "sheets");
  })().catch((e)=>{
    console.error(e);
    setStatus(`Erro: ${e?.message || e}`, "err");
  });

  // init
  clearForm();
}

/** --------------------------
 * Player
 * -------------------------- */
function initPlayer(){
  const roomId = mustRoomId();

  const roomCodeOut = $("#roomCodeOut");
  const uidOut = $("#uidOut");
  $("#btnSignOut")?.addEventListener("click", async () => {
    await signOut(auth);
    location.href = "../index.html";
  });

  const sheetTabsEl = $("#sheetTabs");

  const charName = $("#charName");
  const mentalOut = $("#mentalOut");
  const rollOut = $("#rollOut");
  const diceOut = $("#diceOut");

  const itemsList = $("#itemsList");
  const advantagesList = $("#advantagesList");
  const disadvantagesList = $("#disadvantagesList");
  const sharedNotesEl = $("#sharedNotes");

  const hpCurrentEl = $("#hpCurrent");
  const invCurrentEl = $("#invCurrent");

  const attrSpans = {
    QI: $("#aQI"),
    FOR: $("#aFOR"),
    DEX: $("#aDEX"),
    VIG: $("#aVIG"),
  };

  const derivedSpans = {
    intentions: $("#statIntentions"),
    move: $("#statMove"),
    defBase: $("#statDef"),
    invLimit: $("#statInv"),
    resHead: $("#resHead"),
    resTorso: $("#resTorso"),
    resLimb: $("#resLimb"),
    hpTotal: $("#hpTotal"),
  };

  const derivedModSpans = {
    intentions: $("#statIntentionsMods"),
    move: $("#statMoveMods"),
    defBase: $("#statDefMods"),
    invLimit: $("#statInvMods"),
  };

  let uid = null;

  let assignedSheetIds = [];
  let activeSheetId = null;

  let sheet = null;
  const sheetCache = new Map(); // sheetId -> sheet data
  const sheetUnsubs = new Map(); // sheetId -> unsubscribe

  let notesLocalEditing = false;
  let hpLocalEditing = false;
  let invLocalEditing = false;

  const sheetNameCache = new Map(); // sheetId -> name

  // local selected passives map: key -> { category, id, name, modMode, modValue, atributoBase }
  const selectedPassives = new Map();

  function renderEmpty(){
    if(charName) charName.textContent = "(sem ficha)";
    if(mentalOut) mentalOut.textContent = "0";
    for(const k of Object.keys(attrSpans)){
      if(attrSpans[k]) attrSpans[k].textContent = "0";
    }
    for(const k of Object.keys(derivedSpans)){
      if(derivedSpans[k]) derivedSpans[k].textContent = "0";
    }
    if(itemsList) itemsList.innerHTML = "";
    if(advantagesList) advantagesList.innerHTML = "";
    if(disadvantagesList) disadvantagesList.innerHTML = "";
    if(rollOut) rollOut.textContent = "";
    if(sharedNotesEl) sharedNotesEl.value = "";
    if(hpCurrentEl) hpCurrentEl.value = "";
    if(invCurrentEl) invCurrentEl.value = "";
  }

  function parseAssignedIds(val){
    const out = [];
    if(val && typeof val === "object" && !Array.isArray(val)){
      if(typeof val.sheetId === "string" && val.sheetId.trim()) out.push(val.sheetId.trim());
      const m = val.sheetIds;
      if(m && typeof m === "object" && !Array.isArray(m)){
        for(const [k, v] of Object.entries(m)){
          if(v === true || v === 1 || v === "true") out.push(k);
        }
      }
    }
    // unique, keep order
    const uniq = [];
    const seen = new Set();
    for(const id of out){
      if(!id) continue;
      if(seen.has(id)) continue;
      seen.add(id);
      uniq.push(id);
    }
    return uniq;
  }

  async function ensureSheetName(id){
    if(sheetNameCache.has(id)) return sheetNameCache.get(id);
    try{
      const snap = await get(ref(db, `rooms/${roomId}/sheets/${id}/name`));
      const name = snap.exists() ? String(snap.val() || "").trim() : "";
      sheetNameCache.set(id, name || id);
    }catch(_){
      sheetNameCache.set(id, id);
    }
    return sheetNameCache.get(id);
  }

  function renderTabs(){
    if(!sheetTabsEl) return;
    if(assignedSheetIds.length <= 1){
      sheetTabsEl.classList.add("hidden");
      sheetTabsEl.innerHTML = "";
      return;
    }
    sheetTabsEl.classList.remove("hidden");
    sheetTabsEl.innerHTML = "";
    assignedSheetIds.forEach((id) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tab" + (id === activeSheetId ? " active" : "");
      btn.textContent = sheetNameCache.get(id) || id;
      btn.addEventListener("click", ()=> setActiveSheet(id));
      sheetTabsEl.appendChild(btn);
    });
  }

  function refreshTabLabels(){
    if(!sheetTabsEl) return;
    const tabs = Array.from(sheetTabsEl.querySelectorAll("button.tab"));
    tabs.forEach((btn, idx) => {
      const id = assignedSheetIds[idx];
      if(!id) return;
      btn.textContent = sheetNameCache.get(id) || id;
    });
  }

  async function hydrateTabLabels(){
    if(assignedSheetIds.length <= 1) return;
    await Promise.all(assignedSheetIds.map((id)=> ensureSheetName(id)));
    refreshTabLabels();
  }

  function stopAllSheetSubs(){
    for(const [, unsub] of sheetUnsubs.entries()){
      try{ unsub(); }catch(_){}
    }
    sheetUnsubs.clear();
    sheetCache.clear();
    notesLocalEditing = false;
  }

  function syncSheetSubs(){
    const want = new Set(assignedSheetIds);

    for(const [id, unsub] of sheetUnsubs.entries()){
      if(!want.has(id)){
        try{ unsub(); }catch(_){}
        sheetUnsubs.delete(id);
        sheetCache.delete(id);
      }
    }

    for(const id of assignedSheetIds){
      if(sheetUnsubs.has(id)) continue;
      const unsub = onValueSafe(ref(db, `rooms/${roomId}/sheets/${id}`), (s2) => {
        if(!s2.exists()){
          sheetCache.delete(id);
          if(id === activeSheetId){
            sheet = null;
            renderEmpty();
            setStatus("Ficha atribuída não existe mais.", "err");
          }
          return;
        }
        const val = s2.val();
        sheetCache.set(id, val);

        const nm = String(val?.name || "").trim();
        if(nm){
          sheetNameCache.set(id, nm);
          refreshTabLabels();
        }

        if(id === activeSheetId){
          sheet = val;
          renderSheet();
          setStatus("OK.", "ok");
        }
      }, `playerSheet_${id}`);

      sheetUnsubs.set(id, unsub);
    }
  }

  function computeDerived(attrs){
    const FOR = asNum(attrs?.FOR, 0);
    const DEX = asNum(attrs?.DEX, 0);
    const VIG = asNum(attrs?.VIG, 0);

    const intentions = 1 + Math.floor((VIG + DEX) / 2);
    const move = DEX + 2;
    const defBase = 6 + DEX;
    const invLimit = (FOR + VIG) * 4;

    const resHead = (VIG + 3) * 3 + 6;
    const resTorso = (VIG + FOR + 3) * 3 + 6;
    const resLimb = (VIG + 3) * 2 + 6;
    const hpTotal = (resHead + resTorso + resLimb) * 2;

    return { intentions, move, defBase, invLimit, resHead, resTorso, resLimb, hpTotal };
  }

  function formatInlineMods(appliedSoma, appliedMult){
    const parts = [];
    for(const a of (appliedSoma || [])){
      const v = Number(a?.value) || 0;
      if(v === 0) continue;
      parts.push(`(${v >= 0 ? "+" : ""}${v}: ${a?.name || "?"})`);
    }
    for(const a of (appliedMult || [])){
      const v = Number(a?.value) || 0;
      if(v === 0) continue;
      parts.push(`(${v >= 0 ? "+" : ""}${v}×: ${a?.name || "?"})`);
    }
    return parts.join(" ");
  }

  function applyPassiveModsToBase(baseValue, key){
    const pass = getSelectedPassiveMods(key);
    const soma = Number(pass?.soma) || 0;
    const mult = Number(pass?.mult) || 0;
    const subtotal = (Number(baseValue) || 0) + soma;
    const hasMult = (mult !== 0);
    const total = hasMult ? Math.floor(subtotal * (1 + mult)) : subtotal;
    return { total, pass };
  }

  function renderSheet(){
    const name = sheet?.name || "(sem nome)";
    const m = asInt(sheet?.mental, 0);
    const attrs = sheet?.attributes || {};
    if(charName) charName.textContent = name;
    if(mentalOut) mentalOut.textContent = String(m);

    if(attrSpans.QI) attrSpans.QI.textContent = String(asNum(attrs.QI, 0));
    if(attrSpans.FOR) attrSpans.FOR.textContent = String(asNum(attrs.FOR, 0));
    if(attrSpans.DEX) attrSpans.DEX.textContent = String(asNum(attrs.DEX, 0));
    if(attrSpans.VIG) attrSpans.VIG.textContent = String(asNum(attrs.VIG, 0));

    const d = computeDerived(attrs);

    const di = applyPassiveModsToBase(d.intentions, "INTENCOES");
    if(derivedSpans.intentions) derivedSpans.intentions.textContent = String(di.total);
    if(derivedModSpans.intentions) derivedModSpans.intentions.textContent = formatInlineMods(di.pass.appliedSoma, di.pass.appliedMult);

    const dm = applyPassiveModsToBase(d.move, "MOV");
    if(derivedSpans.move) derivedSpans.move.textContent = String(dm.total);
    if(derivedModSpans.move) derivedModSpans.move.textContent = formatInlineMods(dm.pass.appliedSoma, dm.pass.appliedMult);

    const dd = applyPassiveModsToBase(d.defBase, "DEF");
    if(derivedSpans.defBase) derivedSpans.defBase.textContent = String(dd.total);
    if(derivedModSpans.defBase) derivedModSpans.defBase.textContent = formatInlineMods(dd.pass.appliedSoma, dd.pass.appliedMult);

    const dinv = applyPassiveModsToBase(d.invLimit, "INV");
    if(derivedSpans.invLimit) derivedSpans.invLimit.textContent = String(dinv.total);
    if(derivedModSpans.invLimit) derivedModSpans.invLimit.textContent = formatInlineMods(dinv.pass.appliedSoma, dinv.pass.appliedMult);

    if(derivedSpans.resHead) derivedSpans.resHead.textContent = String(d.resHead);
    if(derivedSpans.resTorso) derivedSpans.resTorso.textContent = String(d.resTorso);
    if(derivedSpans.resLimb) derivedSpans.resLimb.textContent = String(d.resLimb);
    if(derivedSpans.hpTotal) derivedSpans.hpTotal.textContent = String(d.hpTotal);

    // current values (persistidos no RTDB)
    const hpCur = asInt(sheet?.hpCurrent, d.hpTotal);
    const invCur = asInt(sheet?.invCurrent, 0);
    if(hpCurrentEl && !hpLocalEditing) hpCurrentEl.value = String(hpCur);
    if(invCurrentEl && !invLocalEditing) invCurrentEl.value = String(invCur);

    renderCategory(itemsList, "items", ensureObj(sheet?.items));
    renderCategory(advantagesList, "advantages", ensureObj(sheet?.advantages));
    renderCategory(disadvantagesList, "disadvantages", ensureObj(sheet?.disadvantages));
    if(sharedNotesEl && !notesLocalEditing) sharedNotesEl.value = String(sheet?.sharedNotes || "");
  }

  function renderCategory(container, category, obj){
    if(!container) return;
    container.innerHTML = "";
    const entries = Object.entries(obj || {});
    if(entries.length === 0){
      container.innerHTML = '<div class="muted">(vazio)</div>';
      return;
    }

    entries
      .sort((a,b)=> (a[1]?.name || "").localeCompare(b[1]?.name || ""))
      .forEach(([id, e]) => {
        const type = (e?.type === "ATIVA") ? "ATIVA" : "PASSIVA";
        const attrBase = (["QI","FOR","DEX","VIG"].includes(e?.atributoBase)) ? e.atributoBase : null;
        const modMode = (e?.modMode === "SOMA" || e?.modMode === "MULT" || e?.modMode === "NONE") ? e.modMode : "NONE";
        const modValue = (modMode === "NONE") ? null : (Number.isFinite(Number(e?.modValue)) ? Number(e.modValue) : 0);

        const uses = ((e?.usesCurrent !== null && e?.usesCurrent !== undefined) || (e?.usesMax !== null && e?.usesMax !== undefined))
          ? `<span class="badge">uses ${e?.usesCurrent ?? "?"}/${e?.usesMax ?? "?"}</span>`
          : "";

        const badges = `
          <span class="badge">${type}</span>
          ${attrBase ? `<span class="badge">${escapeHtml(attrBase)}</span>` : `<span class="badge">sem atributo</span>`}
          <span class="badge">${escapeHtml(modMode)}</span>
          ${modMode !== "NONE" ? `<span class="badge">${escapeHtml(String(modValue))}</span>` : ""}
          ${uses}
        `;

        const div = document.createElement("div");
        div.className = "item";

        if(type === "ATIVA"){
          div.innerHTML = `
            <div class="meta">
              <div class="title">${escapeHtml(e?.name || "(sem nome)")}</div>
              <div class="kv">${badges}</div>
            </div>
            <div class="row" style="margin:0">
              <button class="btn small primary" data-roll="1">Rolar</button>
            </div>
          `;
          div.querySelector("[data-roll]")?.addEventListener("click", ()=>{
            rollActive({ category, id, entry: { name: e?.name || "(sem nome)", atributoBase: attrBase, modMode, modValue } });
          });
        }else{
          const key = `${category}:${id}`;
          const checked = selectedPassives.has(key);
          div.innerHTML = `
            <div class="meta">
              <div class="title">${escapeHtml(e?.name || "(sem nome)")}</div>
              <div class="kv">${badges}</div>
            </div>
            <div class="row" style="margin:0">
              <label class="toggle">
                <input type="checkbox" ${checked ? "checked" : ""} />
                <span>Usar como mod</span>
              </label>
            </div>
          `;
          const cb = div.querySelector("input[type=checkbox]");
          cb?.addEventListener("change", ()=>{
            if(cb.checked){
              selectedPassives.set(key, { category, id, name: e?.name || "(sem nome)", modMode, modValue, atributoBase: attrBase });
              setStatus("Mod ativo.", "ok");
            }else{
              selectedPassives.delete(key);
              setStatus("Mod removido.", "ok");
            }
          });
        }

        container.appendChild(div);
      });
  }

  function setActiveSheet(id){
    if(activeSheetId === id) return;

    selectedPassives.clear();
    notesLocalEditing = false;
    hpLocalEditing = false;
    invLocalEditing = false;

    activeSheetId = id || null;
    renderTabs();

    if(!activeSheetId){
      sheet = null;
      renderEmpty();
      return;
    }

    // garante listener da ficha
    syncSheetSubs();

    setStatus("Carregando ficha...", "warn");
    sheet = sheetCache.get(activeSheetId) || null;
    if(sheet){
      renderSheet();
      setStatus("OK.", "ok");
    }else{
      renderEmpty();
    }
  }

  function mentalBonuses(mental){
    let diceBonus = 0;
    if(mental === 4) diceBonus = 5;
    else if(mental === -8 || mental === -9) diceBonus = -5;
    // mental 5 / -10 / -11: sem DT aqui (player não calcula DT)
    return { diceBonus };
  }

  function getSelectedPassiveMods(rollAttrKey){
    let soma = 0;
    let mult = 0;
    const appliedSoma = []; // {name,value}
    const appliedMult = []; // {name,value}
    for(const p of selectedPassives.values()){
      // Regra: PASSIVA só aplica no atributo dela.
      // - Se p.atributoBase == null: aplica APENAS quando a rolagem não tem atributo (rollAttrKey null).
      // - Se p.atributoBase != null: aplica só quando bate com o atributo da rolagem.
      const ok = (p.atributoBase == null) ? true : (p.atributoBase === rollAttrKey);
      if(!ok) continue;

      if(p.modMode === "SOMA"){
        const v = Number(p.modValue) || 0;
        if(v !== 0){
          soma += v;
          appliedSoma.push({ name: p.name, value: v });
        }
      }else if(p.modMode === "MULT"){
        const v = Number(p.modValue) || 0;
        if(v !== 0){
          mult += v;
          appliedMult.push({ name: p.name, value: v });
        }
      }
    }
    return { soma, mult, appliedSoma, appliedMult };
  }

  // Output: somente d12 e modificadores != 0 + total
  function rollCore({ title, rollAttrKey, baseAttrValue, activeMod, activeName }){
    if(!sheet){
      setStatus("Sem ficha carregada.", "err");
      return;
    }

    const mental = asInt(sheet.mental, 0);
    const { diceBonus } = mentalBonuses(mental);

    const d12 = buildDice(12);

    const pass = getSelectedPassiveMods(rollAttrKey);
    const somaPass = pass.soma;
    const multPass = pass.mult;

    let somaAtiva = 0;
    let multAtiva = 0;

    if(activeMod){
      if(activeMod.mode === "SOMA") somaAtiva = Number(activeMod.value) || 0;
      if(activeMod.mode === "MULT") multAtiva = Number(activeMod.value) || 0;
    }

    const subtotal = d12 + diceBonus + baseAttrValue + somaPass + somaAtiva;

    const multValue = multPass + multAtiva;
    const hasMult = (multValue !== 0);
    let totalFinal = hasMult ? Math.floor(subtotal * (1 + multValue)) : subtotal;

    const isCrit = (d12 === 12);
    if(isCrit) totalFinal = Math.floor(totalFinal * 1.5);

    const lines = [];
    lines.push(String(title || "Rolagem"));
    lines.push("");
    lines.push(`d12: ${d12}`);

    // SOMAS com origem
    if(diceBonus !== 0) lines.push(`${diceBonus >= 0 ? "+" : ""}${diceBonus} (mental)`);
    if(baseAttrValue !== 0){
      const label = rollAttrKey ? `atributo ${rollAttrKey}` : "atributo";
      lines.push(`${baseAttrValue >= 0 ? "+" : ""}${baseAttrValue} (${label})`);
    }

    for(const a of pass.appliedSoma){
      lines.push(`${a.value >= 0 ? "+" : ""}${a.value} (passiva: ${a.name})`);
    }

    if(somaAtiva !== 0){
      lines.push(`${somaAtiva >= 0 ? "+" : ""}${somaAtiva} (ativa: ${activeName || "ação"})`);
    }

    // MULT com origem (só mostra se existir)
    if(hasMult){
      // lista mult passivas
      for(const a of pass.appliedMult){
        lines.push(`${a.value >= 0 ? "+" : ""}${a.value} (mult passiva: ${a.name})`);
      }
      if(multAtiva !== 0){
        lines.push(`${multAtiva >= 0 ? "+" : ""}${multAtiva} (mult ativa: ${activeName || "ação"})`);
      }
      lines.push(`mult total: ${multValue}`);
    }

    if(isCrit) lines.push(`crítico: SIM`);

    lines.push("");
    lines.push(`total: ${totalFinal}`);

    rollOut.textContent = lines.join("\n");
  }

  function rollAttribute(attrKey){
    if(!sheet) return;
    const attrs = sheet.attributes || {};
    const attrVal = asNum(attrs[attrKey], 0);
    rollCore({
      title: `Rolagem: ${attrKey}`,
      rollAttrKey: attrKey,
      baseAttrValue: attrVal,
      activeMod: null,
      activeName: null
    });
  }

  function rollActive({ category, id, entry }){
    const attrs = sheet?.attributes || {};
    const baseAttrKey = entry.atributoBase || null;
    const baseAttrValue = baseAttrKey ? asNum(attrs[baseAttrKey], 0) : 0;

    const activeMod = {
      mode: entry.modMode,
      value: entry.modMode === "NONE" ? 0 : (Number(entry.modValue) || 0)
    };

    rollCore({
      title: `Rolagem: ${entry.name}`,
      rollAttrKey: baseAttrKey, // pode ser null
      baseAttrValue,
      activeMod,
      activeName: entry.name
    });
  }

  (async ()=>{
    setStatus("Autenticando...", "warn");
    const user = await ensureAnonAuth();
    uid = user.uid;
    uidOut.textContent = "(carregando...)";

    // Mostrar nome no lugar do UID (UID real continua sendo o auth.uid)
    onValueSafe(ref(db, `rooms/${roomId}/members/${uid}`), (ms) => {
      const m = ms.val();
      uidOut.textContent = m?.displayName || uid;
    }, "memberSelf");

    setStatus("Carregando meta...", "warn");
    const metaSnap = await get(ref(db, `rooms/${roomId}/meta`));
    if(!metaSnap.exists()){
      setStatus("Sala inválida (meta não existe).", "err");
      return;
    }
    const meta = metaSnap.val();
    roomCodeOut.textContent = meta.code || "?";

    // abas / atribuição (suporta legacy sheetId e novo sheetIds)
    setStatus("Carregando atribuição...", "warn");
    onValueSafe(ref(db, `rooms/${roomId}/assignments/${uid}`), (snap) => {
      const val = snap.val();

      assignedSheetIds = parseAssignedIds(val);
      if(!assignedSheetIds.length){
        activeSheetId = null;
        sheet = null;
        stopAllSheetSubs();
        renderTabs();
        renderEmpty();
        setStatus("Sem ficha atribuída. Peça ao GM para atribuir.", "warn");
        return;
      }

      // preferir primarySheetId quando existir
      const preferred = (val && typeof val === "object" && typeof val.primarySheetId === "string") ? val.primarySheetId : null;

      let next = activeSheetId;
      if(preferred && assignedSheetIds.includes(preferred)) next = preferred;
      if(!next || !assignedSheetIds.includes(next)) next = assignedSheetIds[0];

      renderTabs();
      hydrateTabLabels();
      syncSheetSubs();

      setActiveSheet(next);
    }, "assignment");

    $$(".btn.attr").forEach(btn => btn.addEventListener("click", () => rollAttribute(btn.dataset.attr)));

    $$(".btn.die").forEach(btn => {
      btn.addEventListener("click", () => {
        const n = Number(btn.dataset.die);
        if(!Number.isFinite(n) || n <= 1) return;
        const r = buildDice(n);
        diceOut.textContent = `d${n} -> ${r}`;
      });
    });

    if(sharedNotesEl){
      const saveNotes = debounce(async ()=>{
        if(!activeSheetId) return;
        try{
          await set(ref(db, `rooms/${roomId}/sheets/${activeSheetId}/sharedNotes`), String(sharedNotesEl.value || ""));
          setStatus("Anotações salvas.", "ok");
        }catch(e){
          console.error(e);
          setStatus(`Erro ao salvar anotações: ${e?.message || e}`, "err");
        }
      }, 500);

      sharedNotesEl.addEventListener("input", ()=>{
        notesLocalEditing = true;
        saveNotes();
      });
      sharedNotesEl.addEventListener("blur", ()=>{ notesLocalEditing = false; });
    }

    if(hpCurrentEl){
      const saveHp = debounce(async ()=>{
        if(!activeSheetId) return;
        try{
          const v = asInt(hpCurrentEl.value, 0);
          await set(ref(db, `rooms/${roomId}/sheets/${activeSheetId}/hpCurrent`), v);
        }catch(e){
          console.error(e);
          setStatus(`Erro ao salvar HP atual: ${e?.message || e}`, "err");
        }
      }, 350);

      hpCurrentEl.addEventListener("input", ()=>{
        hpLocalEditing = true;
        saveHp();
      });
      hpCurrentEl.addEventListener("blur", ()=>{ hpLocalEditing = false; });
    }

    if(invCurrentEl){
      const saveInv = debounce(async ()=>{
        if(!activeSheetId) return;
        try{
          const v = asInt(invCurrentEl.value, 0);
          await set(ref(db, `rooms/${roomId}/sheets/${activeSheetId}/invCurrent`), v);
        }catch(e){
          console.error(e);
          setStatus(`Erro ao salvar Inventário atual: ${e?.message || e}`, "err");
        }
      }, 350);

      invCurrentEl.addEventListener("input", ()=>{
        invLocalEditing = true;
        saveInv();
      });
      invCurrentEl.addEventListener("blur", ()=>{ invLocalEditing = false; });
    }
  })().catch((e)=>{
    console.error(e);
    setStatus(`Erro: ${e?.message || e}`, "err");
  });
}

