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


async function fileToDataUrl(file){
  const buf = await file.arrayBuffer();
  const blob = new Blob([buf], { type: file.type || "application/octet-stream" });
  return await new Promise((resolve, reject)=>{
    const fr = new FileReader();
    fr.onload = ()=> resolve(String(fr.result || ""));
    fr.onerror = ()=> reject(fr.error || new Error("FileReader error"));
    fr.readAsDataURL(blob);
  });
}

// Redimensiona para quadrado (ex: 256x256) e retorna dataURL JPEG
async function resizeImageDataUrl(dataUrl, size=256, quality=0.82){
  return await new Promise((resolve, reject)=>{
    const img = new Image();
    img.onload = ()=>{
      try{
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        // crop central para preencher quadrado
        const iw = img.naturalWidth || img.width;
        const ih = img.naturalHeight || img.height;
        const s = Math.min(iw, ih);
        const sx = Math.floor((iw - s) / 2);
        const sy = Math.floor((ih - s) / 2);
        ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
        const out = canvas.toDataURL("image/jpeg", quality);
        resolve(out);
      }catch(e){ reject(e); }
    };
    img.onerror = ()=> reject(new Error("Imagem inválida"));
    img.src = dataUrl;
  });
}

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
  const roomIdOut = $("#roomIdOut");
  if(roomIdOut) roomIdOut.textContent = roomId;

  $("#btnSignOut")?.addEventListener("click", async () => {
    await signOut(auth);
    location.href = "../index.html";
  });

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
  const sharedNotesEl = $("#sharedNotes");
  const sheetSelectEl = $("#sheetSelect");
  const avatarFileEl = $("#sheetAvatarFile");
  const avatarPreviewEl = $("#sheetAvatarPreview");
  const btnClearAvatar = $("#btnClearAvatar");
  const btnCancelSheet = $("#btnCancelSheet");
  const btnDeleteSheet = $("#btnDeleteSheet");

  const assignPlayer = $("#assignPlayer");
  const assignSheet = $("#assignSheet");
  const btnAssign = $("#btnAssign");
  const playerAssignmentsList = $("#playerAssignmentsList");

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
  let assignmentsByPlayer = {};
  let currentSheetId = null; // slug
  let currentAvatarDataUrl = "";
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

  if(avatarFileEl){
    avatarFileEl.addEventListener("change", async ()=>{
      const f = avatarFileEl.files?.[0];
      if(!f) return;
      try{
        setStatus("Processando imagem...", "warn");
        const dataUrl = await fileToDataUrl(f);
        const resized = await resizeImageDataUrl(dataUrl, 256, 0.82);
        currentAvatarDataUrl = resized;
        if(avatarPreviewEl) avatarPreviewEl.src = currentAvatarDataUrl;
        setStatus("Imagem pronta. Salve a ficha para persistir.", "ok");
      }catch(e){
        console.error(e);
        setStatus(`Erro na imagem: ${e?.message || e}`, "err");
      }
    });
  }
  if(btnClearAvatar){
    btnClearAvatar.addEventListener("click", ()=>{
      currentAvatarDataUrl = "";
      if(avatarPreviewEl) avatarPreviewEl.src = "";
      if(avatarFileEl) avatarFileEl.value = "";
      setStatus("Imagem removida do draft. Salve a ficha para persistir.", "ok");
    });
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

  assignPlayer?.addEventListener("change", ()=>{
    const pu = assignPlayer.value;
    if(pu) renderPlayerAssignments(pu);
  });

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

  function renderPlayerAssignments(playerUid){
    if(!playerAssignmentsList) return;
    playerAssignmentsList.innerHTML = "";
    if(!playerUid){
      playerAssignmentsList.innerHTML = '<div class="muted">(selecione um player)</div>';
      return;
    }
    const map = (assignmentsByPlayer && assignmentsByPlayer[playerUid] && typeof assignmentsByPlayer[playerUid] === "object") ? assignmentsByPlayer[playerUid] : {};
    const sheetIds = Object.keys(map).filter(k=> map[k]);
    if(sheetIds.length === 0){
      playerAssignmentsList.innerHTML = '<div class="muted">(sem fichas vinculadas)</div>';
      return;
    }
    sheetIds
      .map(id=> ({ id, name: sheets?.[id]?.name || id }))
      .sort((a,b)=> a.name.localeCompare(b.name))
      .forEach(s=>{
        const div = document.createElement("div");
        div.className = "item";
        div.innerHTML = `
          <div class="meta">
            <div class="title">${escapeHtml(s.name)}</div>
            <div class="sub"><code>${escapeHtml(s.id)}</code></div>
          </div>
          <div class="row" style="margin:0">
            <button class="btn small danger" data-rm="1">Remover</button>
          </div>
        `;
        div.querySelector("[data-rm]").addEventListener("click", async ()=>{
          try{
            const updates = {};
            updates[`rooms/${roomId}/assignmentsByPlayer/${playerUid}/${s.id}`] = null;
            updates[`rooms/${roomId}/playersBySheet/${s.id}/${playerUid}`] = null;
            await update(ref(db), updates);
            setStatus("Vínculo removido.", "ok");
          }catch(e){
            console.error(e);
            setStatus(`Erro ao remover vínculo: ${e?.message || e}`, "err");
          }
        });
        playerAssignmentsList.appendChild(div);
      });
  }

  function clearForm(){
    if(sheetEditorEmpty) sheetEditorEmpty.classList.add("hidden");
    if(sheetEditorPane) sheetEditorPane.classList.remove("hidden");
    if(sheetEditorEmpty) sheetEditorEmpty.classList.add("hidden");
    if(sheetEditorPane) sheetEditorPane.classList.remove("hidden");
    sheetIdEl.value = "";
    sheetNameEl.value = "";
    attrQI.value = 0;
    attrFOR.value = 0;
    attrDEX.value = 0;
    attrVIG.value = 0;
    mentalEl.value = 0;
    if(sharedNotesEl) sharedNotesEl.value = "";
    if(avatarPreviewEl) avatarPreviewEl.src = "";
    currentAvatarDataUrl = "";
    if(avatarPreviewEl) avatarPreviewEl.src = "";
    if(avatarFileEl) avatarFileEl.value = "";
    if(gmNotesUnsub){ try{ gmNotesUnsub(); }catch(_){} gmNotesUnsub = null; }
    $("#sheetFormTitle") && ($("#sheetFormTitle").textContent = "Criar");
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
      currentAvatarDataUrl = String(s?.profileImage || "");
      if(avatarPreviewEl) avatarPreviewEl.src = currentAvatarDataUrl;
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
        profileImage: String(currentAvatarDataUrl || ""),
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
          if(a?.sheetId === oldId){
            updates[`rooms/${roomId}/assignments/${uid}/sheetId`] = finalId;
          }
        }
      }

      await update(ref(db), updates);
      sheetIdEl.value = finalId;
      currentSheetId = finalId;
      setStatus(`Ficha salva: ${payload.name}`, "ok");
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

  btnAssign?.addEventListener("click", async () => {
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
          sharedNotes: String(entry.sharedNotes || ""),
          profileImage: String(entry.profileImage || ""),
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

    if(meta.gmUid !== userUid){
      setStatus("Acesso negado: você não é o GM desta sala.", "err");
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

    btnCancelSheet?.addEventListener("click", ()=>{ closeEditor(); setStatus("Edição cancelada.", "ok"); });
// init
  closeEditor();
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

  const charName = $("#charName");
  const mentalOut = $("#mentalOut");
  const rollOut = $("#rollOut");
  const diceOut = $("#diceOut");

  // Status + HP/Inventário
  const statIntentionsEl = $("#statIntentions");
  const statMoveEl = $("#statMove");
  const statDefEl = $("#statDef");
  const statInvMaxEl = $("#statInvMax");
  const hpTotalOutEl = $("#hpTotalOut");
  const hpCurrentInEl = $("#hpCurrentIn");
  const hpMinusBtn = $("#hpMinus");
  const hpPlusBtn = $("#hpPlus");
  const hpSaveBtn = $("#hpSave");
  const invCurrentInEl = $("#invCurrentIn");
  const invMinusBtn = $("#invMinus");
  const invPlusBtn = $("#invPlus");
  const invSaveBtn = $("#invSave");
  const resHeadEl = $("#resHead");
  const resTorsoEl = $("#resTorso");
  const resArmEl = $("#resArm");
  const resLegEl = $("#resLeg");
  const avatarViewEl = $("#sheetAvatarView");

  const itemsList = $("#itemsList");
  const advantagesList = $("#advantagesList");
  const disadvantagesList = $("#disadvantagesList");
  const sharedNotesEl = $("#sharedNotes");
  const sheetSelectEl = $("#sheetSelect");

  const attrSpans = {
    QI: $("#aQI"),
    FOR: $("#aFOR"),
    DEX: $("#aDEX"),
    VIG: $("#aVIG"),
  };

  let uid = null;
  let selectedSheetIds = [];
  let selectedSheetId = null;
  let sheet = null;
  let plNotesUnsub = null;
  let plNotesLocalEditing = false;

  // local selected passives map: key -> { category, id, name, modMode, modValue, atributoBase }
  const selectedPassives = new Map();


  function loadSelectedSheet(){
    if(!selectedSheetId){
      sheet = null;
      renderEmpty();
      return;
    }
    setStatus("Carregando ficha...", "warn");

    // Shared notes live-sync
    if(sharedNotesEl){
      if(plNotesUnsub){ try{ plNotesUnsub(); }catch(_){} plNotesUnsub = null; }
      plNotesUnsub = onValueSafe(ref(db, `rooms/${roomId}/sheets/${selectedSheetId}/sharedNotes`), (ns)=>{
        if(plNotesLocalEditing) return;
        sharedNotesEl.value = String(ns.val() || "");
      }, "playerSharedNotes");
    }

    onValueSafe(ref(db, `rooms/${roomId}/sheets/${selectedSheetId}`), (s2) => {
      if(!s2.exists()){
        sheet = null;
        renderEmpty();
        setStatus("Ficha selecionada não existe mais.", "err");
        return;
      }
      sheet = s2.val();
      renderSheet();
      setStatus("OK.", "ok");
    }, "sheet");
  }

  function computeDerivedStats(attrs){
    const FOR = asNum(attrs?.FOR, 0);
    const DEX = asNum(attrs?.DEX, 0);
    const VIG = asNum(attrs?.VIG, 0);

    const intentions = 1 + Math.floor((VIG + DEX) / 2);
    const movePerInt = DEX + 2;
    const defBase = 6 + DEX;
    const invMax = (FOR + VIG) * 4;

    const resHead = (VIG + 3) * 4 + 6;
    const resTorso = (VIG + FOR + 3) * 4 + 6;
    const resLimb = (VIG + 3) * 3 + 6;
    const hpTotal = (resHead + resTorso + (resLimb * 4)) * 2;

    return { intentions, movePerInt, defBase, invMax, resHead, resTorso, resArm: resLimb, resLeg: resLimb, hpTotal };
  }

  function renderEmpty(){
    if(charName) charName.textContent = "(sem ficha)";
    if(mentalOut) mentalOut.textContent = "0";
    for(const k of Object.keys(attrSpans)){
      if(attrSpans[k]) attrSpans[k].textContent = "0";
    }
    if(itemsList) itemsList.innerHTML = "";
    if(advantagesList) advantagesList.innerHTML = "";
    if(disadvantagesList) disadvantagesList.innerHTML = "";
    if(rollOut) rollOut.textContent = "";
    if(sharedNotesEl) sharedNotesEl.value = "";
    if(avatarViewEl) avatarViewEl.src = "";
    currentAvatarDataUrl = "";
    if(avatarPreviewEl) avatarPreviewEl.src = "";
    if(avatarFileEl) avatarFileEl.value = "";
  }

  function renderSheet(){
    const name = sheet?.name || "(sem nome)";
    const m = asInt(sheet?.mental, 0);
    const attrs = sheet?.attributes || {};
    if(charName) charName.textContent = name;
    if(avatarViewEl) avatarViewEl.src = String(sheet?.profileImage || "");
    if(mentalOut) mentalOut.textContent = String(m);

    if(attrSpans.QI) attrSpans.QI.textContent = String(asNum(attrs.QI, 0));
    if(attrSpans.FOR) attrSpans.FOR.textContent = String(asNum(attrs.FOR, 0));
    if(attrSpans.DEX) attrSpans.DEX.textContent = String(asNum(attrs.DEX, 0));
    if(attrSpans.VIG) attrSpans.VIG.textContent = String(asNum(attrs.VIG, 0));

    renderCategory(itemsList, "items", ensureObj(sheet?.items));
    renderCategory(advantagesList, "advantages", ensureObj(sheet?.advantages));
    renderCategory(disadvantagesList, "disadvantages", ensureObj(sheet?.disadvantages));
    if(sharedNotesEl && !plNotesLocalEditing) sharedNotesEl.value = String(sheet?.sharedNotes || "");
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

    setStatus("Carregando atribuição...", "warn");
    onValueSafe(ref(db, `rooms/${roomId}/assignments/${uid}`), (snap) => {
      const val = snap.val();
      selectedSheetId = val?.sheetId || null;

      selectedPassives.clear();
      if(plNotesUnsub){ try{ plNotesUnsub(); }catch(_){} plNotesUnsub = null; }
      plNotesLocalEditing = false;

      if(!selectedSheetId){
        sheet = null;
        renderEmpty();
        setStatus("Sem ficha atribuída. Peça ao GM para atribuir.", "warn");
        return;
      }

      setStatus("Carregando ficha...", "warn");
      // Shared notes live-sync
      if(sharedNotesEl){
        plNotesUnsub = onValueSafe(ref(db, `rooms/${roomId}/sheets/${selectedSheetId}/sharedNotes`), (ns)=>{
          if(plNotesLocalEditing) return;
          sharedNotesEl.value = String(ns.val() || "");
        }, "playerSharedNotes");
      }
      onValueSafe(ref(db, `rooms/${roomId}/sheets/${selectedSheetId}`), (s2) => {
        if(!s2.exists()){
          sheet = null;
          renderEmpty();
          setStatus("Ficha atribuída não existe mais.", "err");
          return;
        }
        sheet = s2.val();
        renderSheet();
        setStatus("OK.", "ok");
    }, "assignment");
    }, "sheet");

    $$(".btn.attr").forEach(btn => btn.addEventListener("click", () => rollAttribute(btn.dataset.attr)));

    sheetSelectEl?.addEventListener("change", ()=>{
      selectedSheetId = sheetSelectEl.value || null;
      selectedPassives.clear();
      loadSelectedSheet();
    });

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
        if(!selectedSheetId) return;
        try{
          await set(ref(db, `rooms/${roomId}/sheets/${selectedSheetId}/sharedNotes`), String(sharedNotesEl.value || ""));
          setStatus("Anotações salvas.", "ok");
        }catch(e){
          console.error(e);
          setStatus(`Erro ao salvar anotações: ${e?.message || e}`, "err");
        }
      }, 500);

      sharedNotesEl.addEventListener("input", ()=>{
        plNotesLocalEditing = true;
        saveNotes();
      });
      sharedNotesEl.addEventListener("blur", ()=>{ plNotesLocalEditing = false; });
    }
  

    // HP & Inventário quick edit (salva no RTDB)
    const clampInt = (x)=>{ const n = Number(x); return Number.isFinite(n) ? Math.trunc(n) : 0; };
    const clampNum = (x)=>{ const n = Number(x); return Number.isFinite(n) ? n : 0; };

    hpMinusBtn?.addEventListener("click", ()=>{ if(!hpCurrentInEl) return; hpCurrentInEl.value = String(clampInt(hpCurrentInEl.value) - 1); });
    hpPlusBtn?.addEventListener("click", ()=>{ if(!hpCurrentInEl) return; hpCurrentInEl.value = String(clampInt(hpCurrentInEl.value) + 1); });
    hpSaveBtn?.addEventListener("click", async ()=>{
      try{
        if(!selectedSheetId) return;
        const v = clampInt(hpCurrentInEl?.value);
        await set(ref(db, `rooms/${roomId}/sheets/${selectedSheetId}/hpCurrent`), v);
        setStatus("HP atual salvo.", "ok");
      }catch(e){
        console.error(e);
        setStatus(`Erro ao salvar HP: ${e?.message || e}`, "err");
      }
    });

    invMinusBtn?.addEventListener("click", ()=>{ if(!invCurrentInEl) return; invCurrentInEl.value = String(clampNum(invCurrentInEl.value) - 0.5); });
    invPlusBtn?.addEventListener("click", ()=>{ if(!invCurrentInEl) return; invCurrentInEl.value = String(clampNum(invCurrentInEl.value) + 0.5); });
    invSaveBtn?.addEventListener("click", async ()=>{
      try{
        if(!selectedSheetId) return;
        const v = clampNum(invCurrentInEl?.value);
        await set(ref(db, `rooms/${roomId}/sheets/${selectedSheetId}/invCurrent`), v);
        setStatus("Inventário atual salvo.", "ok");
      }catch(e){
        console.error(e);
        setStatus(`Erro ao salvar inventário: ${e?.message || e}`, "err");
      }
    });
})().catch((e)=>{
    console.error(e);
    setStatus(`Erro: ${e?.message || e}`, "err");
  });
}
