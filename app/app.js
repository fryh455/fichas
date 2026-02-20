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
  // remove accents
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // spaces -> hyphen
  s = s.replace(/\s+/g, "-");
  // keep [a-z0-9-]
  s = s.replace(/[^a-z0-9-]/g, "");
  // collapse hyphens
  s = s.replace(/-+/g, "-");
  // trim hyphens
  s = s.replace(/^-+/, "").replace(/-+$/, "");
  return s;
}

function linkifyRole(role){
  return role === "GM" ? "GM" : "PLAYER";
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

  displayNameEl.value = localStorage.getItem("fo_displayName") || "";
  roomCodeEl.value = localStorage.getItem("fo_roomCode") || "";
  displayNameEl.addEventListener("input", ()=> localStorage.setItem("fo_displayName", displayNameEl.value));
  roomCodeEl.addEventListener("input", ()=> localStorage.setItem("fo_roomCode", roomCodeEl.value));

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
}

/** --------------------------
 * GM
 * -------------------------- */
function initGM(){
  const roomId = mustRoomId();
  $("#roomIdOut").textContent = roomId;

  $("#btnSignOut").addEventListener("click", async () => {
    await signOut(auth);
    location.href = "../index.html";
  });

  // UI refs
  const roomCodeOut = $("#roomCodeOut");
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
  const btnDeleteSheet = $("#btnDeleteSheet");

  const assignPlayer = $("#assignPlayer");
  const assignSheet = $("#assignSheet");
  const btnAssign = $("#btnAssign");

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

  // In-memory state
  let userUid = null;
  let meta = null;
  let members = {};
  let sheets = {};
  let currentSheetId = null; // slug
  let currentSheetDraft = null; // object with items/advantages/disadvantages as objects

  // --- helpers for entries ---
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

  function ensureObj(x){ return (x && typeof x === "object" && !Array.isArray(x)) ? x : {}; }

  function normalizeEntryPayload(e){
    const out = {};
    out.name = String(e?.name || "").trim().slice(0,80);
    out.type = (e?.type === "ATIVA") ? "ATIVA" : "PASSIVA";
    out.atributoBase = (["QI","FOR","DEX","VIG"].includes(e?.atributoBase)) ? e.atributoBase : null;

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

  function renderEntryLists(){
    renderEntryList(itemsCrudList, "items");
    renderEntryList(advantagesCrudList, "advantages");
    renderEntryList(disadvantagesCrudList, "disadvantages");
  }

  function renderEntryList(container, category){
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

        const uses = (e?.usesCurrent !== null && e?.usesCurrent !== undefined) || (e?.usesMax !== null && e?.usesMax !== undefined)
          ? `<span class="badge">uses ${e?.usesCurrent ?? "?"}/${e?.usesMax ?? "?"}</span>`
          : "";

        div.innerHTML = `
          <div class="meta">
            <div class="title">${escapeHtml(e?.name || "(sem nome)")}</div>
            <div class="sub"></div>
<div class="kv">${badges} ${uses}</div>
          </div>
          <div class="row" style="margin:0">
            <button class="btn small" data-edit="${id}">Editar</button>
          </div>
        `;
        div.querySelector("[data-edit]").addEventListener("click", () => selectEntry(category, id));
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

  function clearEntryEditor(){
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

  function createNewEntry(category){
    if(!currentSheetDraft){
      setStatus("Selecione/crie uma ficha primeiro.", "err");
      return;
    }
    const id = push(ref(db, `rooms/${roomId}/tmp`)).key; // local id generator
    currentSheetDraft[category] = ensureObj(currentSheetDraft[category]);
    currentSheetDraft[category][id] = emptyEntry();
    renderEntryLists();
    selectEntry(category, id);
    setStatus("Novo registro criado (não salvo ainda).", "ok");
  }

  btnAddItem.addEventListener("click", ()=> createNewEntry("items"));
  btnAddAdv.addEventListener("click", ()=> createNewEntry("advantages"));
  btnAddDis.addEventListener("click", ()=> createNewEntry("disadvantages"));

  btnSaveEntry.addEventListener("click", ()=>{
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

  btnDeleteEntry.addEventListener("click", ()=>{
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

  btnClearEntry.addEventListener("click", ()=>{
    clearEntryEditor();
    setStatus("Seleção limpa.", "ok");
  });

  // --- Auth gate + verify GM ---
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
    roomCodeOut.textContent = meta.code || "?";

    if(meta.gmUid !== userUid){
      setStatus("Acesso negado: você não é o GM desta sala.", "err");
      return;
    }

    setStatus("OK. Sincronizando...", "ok");

    onValue(ref(db, `rooms/${roomId}/members`), (snap) => {
      members = snap.val() || {};
      renderMembers();
      renderAssignPlayers();
    });

    onValue(ref(db, `rooms/${roomId}/sheets`), (snap) => {
      sheets = snap.val() || {};
      renderSheets();
      renderAssignSheets();
    });
  })().catch((e)=>{
    console.error(e);
    setStatus(`Erro: ${e?.message || e}`, "err");
  });

  function renderMembers(){
    membersList.innerHTML = "";
    const entries = Object.entries(members);
    if(entries.length === 0){
      membersList.innerHTML = '<div class="muted">Nenhum membro.</div>';
      return;
    }
    entries
      .sort((a,b)=>{
        const ra = a[1]?.role === "GM" ? 0 : 1;
        const rb = b[1]?.role === "GM" ? 0 : 1;
        return ra - rb;
      })
      .forEach(([uid, m]) => {
        const div = document.createElement("div");
        div.className = "item";
        div.innerHTML = `
          <div class="meta">
            <div class="title">${escapeHtml(m?.displayName || "(sem nome)")}</div>
            <div class="sub">${escapeHtml(linkifyRole(m?.role))} • <code>${uid}</code></div>
          </div>
        `;
        membersList.appendChild(div);
      });
  }

  function renderSheets(){
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
            <button class="btn small" data-edit="${id}">Editar</button>
          </div>
        `;
        div.querySelector("[data-edit]").addEventListener("click", () => loadSheetIntoForm(id, true));
        sheetsList.appendChild(div);
      });
  }

  function renderAssignPlayers(){
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
      players.forEach(p=>{
        const opt = document.createElement("option");
        opt.value = p.uid;
        opt.textContent = `${p.name} (${p.uid.slice(0,6)}…)`;
        assignPlayer.appendChild(opt);
      });
    }
  }

  function renderAssignSheets(){
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
      list.forEach(s=>{
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = `${s.name} (${s.id})`;
        assignSheet.appendChild(opt);
      });
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
    $("#sheetFormTitle").textContent = "Criar";
    currentSheetId = null;
    currentSheetDraft = {
      items: {},
      advantages: {},
      disadvantages: {}
    };
    renderEntryLists();
    clearEntryEditor();
  }

  async function nextAvailableSlug(baseSlug){
    for(let i=2;i<200;i++){
      const candidate = `${baseSlug}-${i}`;
      const snap = await get(ref(db, `rooms/${roomId}/sheets/${candidate}`));
      if(!snap.exists()) return candidate;
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
    if(mode === "MERGE"){
      return baseSlug;
    }
    // CREATE_ONLY
    if(!existingSet.has(baseSlug)) return baseSlug;
    for(let i=2;i<200;i++){
      const candidate = `${baseSlug}-${i}`;
      if(!existingSet.has(candidate)) return candidate;
    }
    throw new Error("Não foi possível gerar sufixo disponível (import).");
  }

  function loadSheetIntoForm(id, userAction){
    const s = sheets[id];
    if(!s) return;
    currentSheetId = id;
    sheetIdEl.value = id;
    sheetNameEl.value = s.name || "";
    attrQI.value = numOr0(s?.attributes?.QI);
    attrFOR.value = numOr0(s?.attributes?.FOR);
    attrDEX.value = numOr0(s?.attributes?.DEX);
    attrVIG.value = numOr0(s?.attributes?.VIG);
    mentalEl.value = intOr0(s?.mental);

    currentSheetDraft = {
      items: ensureObj(s?.items),
      advantages: ensureObj(s?.advantages),
      disadvantages: ensureObj(s?.disadvantages)
    };

    $("#sheetFormTitle").textContent = `Editar: ${s.name || id}`;
    renderEntryLists();
    if(userAction){
      clearEntryEditor();
      setStatus("Ficha carregada.", "ok");
    }
  }

  btnNewSheet.addEventListener("click", () => {
    clearForm();
    setStatus("Nova ficha (draft).", "ok");
  });

  sheetForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try{
      if(!meta || meta.gmUid !== userUid) return setStatus("Sem permissão.", "err");

      const name = String(sheetNameEl.value || "").trim();
      if(!name) return setStatus("Nome é obrigatório.", "err");

      const desiredSlug = slugify(name);
      if(!desiredSlug) return setStatus("Nome inválido para gerar slug.", "err");

      const oldId = sheetIdEl.value || "";
      let finalId = desiredSlug;

      // If creating new OR renaming to different slug, resolve conflict
      if(!oldId){
        setStatus("Resolvendo slug...", "warn");
        finalId = await resolveSlugForCreate(desiredSlug);
      }else if(oldId !== desiredSlug){
        setStatus("Renomeando (slug mudou)...", "warn");
        // check if desired exists and isn't old
        const existsSnap = await get(ref(db, `rooms/${roomId}/sheets/${desiredSlug}`));
        if(existsSnap.exists()){
          const overwrite = confirm(`Já existe uma ficha com ID "${desiredSlug}".\n\nOK = sobrescrever (MERGE)\nCancelar = criar com sufixo (-2, -3...)`);
          if(overwrite) finalId = desiredSlug;
          else finalId = await nextAvailableSlug(desiredSlug);
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
        items: ensureObj(currentSheetDraft?.items),
        advantages: ensureObj(currentSheetDraft?.advantages),
        disadvantages: ensureObj(currentSheetDraft?.disadvantages),
        createdAt: oldId && sheets[oldId]?.createdAt ? (sheets[oldId].createdAt) : ts,
        updatedAt: ts,
      };

      // Multi-path update to handle rename (move)
      const updates = {};
      updates[`rooms/${roomId}/sheets/${finalId}`] = payload;

      // If oldId exists and changed, delete old and also update assignments pointing to oldId
      if(oldId && oldId !== finalId){
        updates[`rooms/${roomId}/sheets/${oldId}`] = null;

        // update assignments that reference oldId -> newId (best effort)
        const asSnap = await get(ref(db, `rooms/${roomId}/assignments`));
        const asObj = asSnap.val() || {};
        for(const [uid, a] of Object.entries(asObj)){
          if(a?.sheetId === oldId){
            updates[`rooms/${roomId}/assignments/${uid}/sheetId`] = finalId;
          }
        }
      }

      await update(ref(db), updates);

      sheetIdEl.value = finalId;
      currentSheetId = finalId;
      setStatus(`Ficha salva: ${finalId}`, "ok");
    }catch(e){
      console.error(e);
      setStatus(`Erro ao salvar: ${e?.message || e}`, "err");
    }
  });

  btnDeleteSheet.addEventListener("click", async () => {
    try{
      const id = sheetIdEl.value;
      if(!id) return setStatus("Nenhuma ficha selecionada.", "warn");
      if(!sheets[id]) return setStatus("Ficha já não existe.", "warn");

      // also clear assignments pointing to it (best effort)
      const asSnap = await get(ref(db, `rooms/${roomId}/assignments`));
      const asObj = asSnap.val() || {};

      const updates = {};
      updates[`rooms/${roomId}/sheets/${id}`] = null;
      for(const [uid, a] of Object.entries(asObj)){
        if(a?.sheetId === id){
          updates[`rooms/${roomId}/assignments/${uid}`] = null;
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

  btnAssign.addEventListener("click", async () => {
    try{
      const playerUid = assignPlayer.value;
      const sheetId = assignSheet.value;
      if(!playerUid) return setStatus("Selecione um player.", "err");
      if(!sheetId) return setStatus("Selecione uma ficha.", "err");
      await set(ref(db, `rooms/${roomId}/assignments/${playerUid}`), { sheetId });
      setStatus("Atribuição salva.", "ok");
    }catch(e){
      console.error(e);
      setStatus(`Erro ao atribuir: ${e?.message || e}`, "err");
    }
  });

  importFile.addEventListener("change", async () => {
    const f = importFile.files?.[0];
    if(!f) return;
    const text = await f.text();
    importText.value = text;
    setStatus("Arquivo carregado no textarea.", "ok");
  });

  btnValidateImport.addEventListener("click", async () => {
    const report = await validateImport();
    importReport.textContent = JSON.stringify(report, null, 2);
    if(report.ok) setStatus("Validação OK.", "ok");
    else setStatus("Validação com erros.", "err");
  });

  btnDoImport.addEventListener("click", async () => {
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

        const itemsObj = arrayToObject(entry.items, "items");
        const advObj = arrayToObject(entry.advantages, "advantages");
        const disObj = arrayToObject(entry.disadvantages, "disadvantages");

        const prev = existing[finalSlug] || null;
        const createdAt = prev?.createdAt || ts;

        const payload = {
          name: entry.name,
          attributes: entry.attributes,
          mental: entry.mental,
          items: itemsObj,
          advantages: advObj,
          disadvantages: disObj,
          createdAt,
          updatedAt: ts
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

  function arrayToObject(arr, category){
    const a = Array.isArray(arr) ? arr : [];
    const out = {};
    for(const raw of a){
      const id = push(ref(db, `rooms/${roomId}/sheets/_tmp/${category}`)).key;
      const payload = normalizeEntryPayload(raw);
      if(!payload.name) continue;
      // For items, ignores uses* if empty
      out[id] = payload;
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

      // validate entries minimally (types coerced later)
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

  function numOr0(v){
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  function intOr0(v){
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }

  // init form empty
  clearForm();
}

/** --------------------------
 * Player
 * -------------------------- */
function initPlayer(){
  const roomId = mustRoomId();

  const roomCodeOut = $("#roomCodeOut");
  const uidOut = $("#uidOut");
  $("#btnSignOut").addEventListener("click", async () => {
    await signOut(auth);
    location.href = "../index.html";
  });

  const charName = $("#charName");
  const mentalOut = $("#mentalOut");
  const rollOut = $("#rollOut");
  const diceOut = $("#diceOut");


  const itemsList = $("#itemsList");
  const advantagesList = $("#advantagesList");
  const disadvantagesList = $("#disadvantagesList");

  const attrSpans = {
    QI: $("#aQI"),
    FOR: $("#aFOR"),
    DEX: $("#aDEX"),
    VIG: $("#aVIG"),
  };

  let uid = null;
  let assignedSheetId = null; // slug
  let sheet = null;
  let meta = null;

  // local selected passives map: key -> { category, id, name, modMode, modValue, atributoBase }
  const selectedPassives = new Map();

  (async ()=>{
    setStatus("Autenticando...", "warn");
    const user = await ensureAnonAuth();
    uid = user.uid;
    uidOut.textContent = uid;

    setStatus("Carregando meta...", "warn");
    const metaSnap = await get(ref(db, `rooms/${roomId}/meta`));
    if(!metaSnap.exists()){
      setStatus("Sala inválida (meta não existe).", "err");
      return;
    }
    meta = metaSnap.val();
    roomCodeOut.textContent = meta.code || "?";

    setStatus("Carregando atribuição...", "warn");
    onValue(ref(db, `rooms/${roomId}/assignments/${uid}`), (snap) => {
      const val = snap.val();
      assignedSheetId = val?.sheetId || null;

      selectedPassives.clear();

      if(!assignedSheetId){
        sheet = null;
        renderEmpty();
        setStatus("Sem ficha atribuída. Peça ao GM para atribuir.", "warn");
        return;
      }

      setStatus("Carregando ficha...", "warn");
      onValue(ref(db, `rooms/${roomId}/sheets/${assignedSheetId}`), (s2) => {
        if(!s2.exists()){
          sheet = null;
          renderEmpty();
          setStatus("Ficha atribuída não existe mais.", "err");
          return;
        }
        sheet = s2.val();
        renderSheet();
        setStatus("OK.", "ok");
      });
    });

    $$(".btn.attr").forEach(btn => btn.addEventListener("click", () => rollAttribute(btn.dataset.attr)));

    $$(".btn.die").forEach(btn => {
      btn.addEventListener("click", () => {
        const n = Number(btn.dataset.die);
        if(!Number.isFinite(n) || n <= 1) return;
        const r = buildDice(n);
        diceOut.textContent = `d${n} -> ${r}`;
      });
    });

  })().catch((e)=>{
    console.error(e);
    setStatus(`Erro: ${e?.message || e}`, "err");
  });

  function ensureObj(x){ return (x && typeof x === "object" && !Array.isArray(x)) ? x : {}; }

  function renderEmpty(){
    charName.textContent = "(sem ficha)";
    mentalOut.textContent = "0";
    for(const k of Object.keys(attrSpans)) attrSpans[k].textContent = "0";
    itemsList.innerHTML = "";
    advantagesList.innerHTML = "";
    disadvantagesList.innerHTML = "";
    rollOut.textContent = "";
  }

  function renderSheet(){
    const name = sheet?.name || "(sem nome)";
    const m = asInt(sheet?.mental, 0);
    const attrs = sheet?.attributes || {};
    charName.textContent = name;
    mentalOut.textContent = String(m);

    attrSpans.QI.textContent = String(asNum(attrs.QI, 0));
    attrSpans.FOR.textContent = String(asNum(attrs.FOR, 0));
    attrSpans.DEX.textContent = String(asNum(attrs.DEX, 0));
    attrSpans.VIG.textContent = String(asNum(attrs.VIG, 0));

    renderCategory(itemsList, "items", ensureObj(sheet?.items));
    renderCategory(advantagesList, "advantages", ensureObj(sheet?.advantages));
    renderCategory(disadvantagesList, "disadvantages", ensureObj(sheet?.disadvantages));

  }
    for(const [key, p] of selectedPassives.entries()){
      const div = document.createElement("div");
      div.className = "item";
      const mv = (p.modMode === "NONE" || p.modValue === null || p.modValue === undefined) ? "0" : String(p.modValue);
      div.innerHTML = `
        <div class="meta">
          <div class="title">${escapeHtml(p.name)}</div>
          <div class="sub">${escapeHtml(p.category)} • <code>${escapeHtml(p.id)}</code></div>
          <div class="kv">
            <span class="badge">PASSIVA</span>
            ${p.atributoBase ? `<span class="badge">${escapeHtml(p.atributoBase)}</span>` : `<span class="badge">sem atributo</span>`}
            <span class="badge">${escapeHtml(p.modMode)}</span>
            ${p.modMode !== "NONE" ? `<span class="badge">${escapeHtml(mv)}</span>` : ""}
          </div>
        </div>
        <div class="row" style="margin:0">
          <button class="btn small danger" data-rm="1">Remover</button>
        </div>
      `;
      div.querySelector("[data-rm]").addEventListener("click", ()=>{
        selectedPassives.delete(key);
          setStatus("Mod removido.", "ok");
      });
      modsActive.appendChild(div);
    }
  }

  function renderCategory(container, category, obj){
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

        const uses = (e?.usesCurrent !== null && e?.usesCurrent !== undefined) || (e?.usesMax !== null && e?.usesMax !== undefined)
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
              <div class="sub"><code>${escapeHtml(id)}</code></div>
              <div class="kv">${badges}</div>
            </div>
            <div class="row" style="margin:0">
              <button class="btn small primary" data-roll="1">Rolar</button>
            </div>
          `;
          div.querySelector("[data-roll]").addEventListener("click", ()=>{
            rollActive({ category, id, entry: { name: e?.name || "(sem nome)", atributoBase: attrBase, modMode, modValue } });
          });
        }else{
          const key = `${category}:${id}`;
          const checked = selectedPassives.has(key);
          div.innerHTML = `
            <div class="meta">
              <div class="title">${escapeHtml(e?.name || "(sem nome)")}</div>
              <div class="sub"><code>${escapeHtml(id)}</code></div>
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
          cb.addEventListener("change", ()=>{
            if(cb.checked){
              selectedPassives.set(key, {
                category,
                id,
                name: e?.name || "(sem nome)",
                modMode,
                modValue,
                atributoBase: attrBase
              });
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

  function mentalBonuses(mental){
    let diceBonus = 0;
    let dtBonus = 0;
    if(mental === 4) diceBonus = 5;
    else if(mental === 5) dtBonus = -3;
    else if(mental === -8 || mental === -9) diceBonus = -5;
    else if(mental === -10 || mental === -11){
      // sem efeito no MVP
    }
    return { diceBonus, dtBonus };
  }

  function getSelectedPassiveMods(){
    let soma = 0;
    let mult = 0;
    const applied = [];
    for(const p of selectedPassives.values()){
      if(p.modMode === "SOMA"){
        const v = Number(p.modValue) || 0;
        if(v !== 0){
          soma += v;
          applied.push({ name: p.name, mode:"SOMA", value:v });
        }
      }else if(p.modMode === "MULT"){
        const v = Number(p.modValue) || 0;
        if(v !== 0){
          mult += v;
          applied.push({ name: p.name, mode:"MULT", value:v });
        }
      }
    }
    return { soma, mult, applied };
  }

  function rollCore({ title, baseAttrKey, baseAttrValue, activeMod, activeLabel }){
    if(!sheet){
      setStatus("Sem ficha carregada.", "err");
      return;
    }
    const mental = asInt(sheet.mental, 0);
    const { diceBonus } = mentalBonuses(mental);

    const d12 = buildDice(12);

    const pass = getSelectedPassiveMods();
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
    lines.push(`${title}`);
    lines.push("");
    lines.push(`d12: ${d12}`);

    if(diceBonus !== 0) lines.push(`diceBonus: ${diceBonus}`);
    if(baseAttrValue !== 0) lines.push(`atributo: ${baseAttrValue}`);
    if(somaPass !== 0) lines.push(`passivas(SOMA): ${somaPass}`);
    if(somaAtiva !== 0) lines.push(`ativa(SOMA): ${somaAtiva}`);
    if(hasMult) lines.push(`mult: ${multValue}`);
    if(isCrit) lines.push(`crítico: SIM`);

    lines.push(`total: ${totalFinal}`);

    rollOut.textContent = lines.join("
");
  }

  function rollAttribute(attrKey){
    if(!sheet) return;
    const attrs = sheet.attributes || {};
    const attrVal = asNum(attrs[attrKey], 0);
    rollCore({
      title: `Rolagem de Atributo: ${attrKey}`,
      baseAttrKey: attrKey,
      baseAttrValue: attrVal,
      activeMod: null,
      activeLabel: ""
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
      title: `Rolagem ATIVA: ${entry.name}`,
      baseAttrKey,
      baseAttrValue,
      activeMod,
      activeLabel: `${category}/${id}`
    });
  }
}
