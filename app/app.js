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

function nowMs(){ return Date.now(); }

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

function linkifyRole(role){
  return role === "GM" ? "GM" : "PLAYER";
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

  // UX: persist last inputs (localStorage only - not RTDB)
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
 * gm.html
 * -------------------------- */
function initGM(){
  const roomId = mustRoomId();
  $("#roomIdOut").textContent = roomId;

  const btnSignOut = $("#btnSignOut");
  btnSignOut.addEventListener("click", async () => {
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

  // in-memory caches
  let userUid = null;
  let meta = null;
  let members = {};
  let sheets = {};

  // Auth gate + verify GM via meta.gmUid
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

    // Members realtime
    onValue(ref(db, `rooms/${roomId}/members`), (snap) => {
      members = snap.val() || {};
      renderMembers();
      renderAssignPlayers();
    });

    // Sheets realtime
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
        div.querySelector("[data-edit]").addEventListener("click", () => loadSheetIntoForm(id));
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
        opt.textContent = `${s.name} (${s.id.slice(0,6)}…)`;
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
  }

  function loadSheetIntoForm(id){
    const s = sheets[id];
    if(!s) return;
    sheetIdEl.value = id;
    sheetNameEl.value = s.name || "";
    attrQI.value = numOr0(s?.attributes?.QI);
    attrFOR.value = numOr0(s?.attributes?.FOR);
    attrDEX.value = numOr0(s?.attributes?.DEX);
    attrVIG.value = numOr0(s?.attributes?.VIG);
    mentalEl.value = intOr0(s?.mental);
    $("#sheetFormTitle").textContent = `Editar: ${s.name || id}`;
  }

  btnNewSheet.addEventListener("click", () => {
    clearForm();
    setStatus("Criando nova ficha (form limpo).", "ok");
  });

  sheetForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try{
      if(!meta || meta.gmUid !== userUid) return setStatus("Sem permissão.", "err");

      const id = sheetIdEl.value || push(ref(db, `rooms/${roomId}/sheets`)).key;
      const exists = Boolean(sheets[id]);

      const name = String(sheetNameEl.value || "").trim();
      if(!name) return setStatus("Nome é obrigatório.", "err");

      const payload = {
        name,
        attributes: {
          QI: asNum(attrQI.value, 0),
          FOR: asNum(attrFOR.value, 0),
          DEX: asNum(attrDEX.value, 0),
          VIG: asNum(attrVIG.value, 0),
        },
        mental: asInt(mentalEl.value, 0),
        // keep arrays for compatibility with player view (even if empty)
        items: exists ? (sheets[id]?.items || []) : [],
        advantages: exists ? (sheets[id]?.advantages || []) : [],
        disadvantages: exists ? (sheets[id]?.disadvantages || []) : [],
        createdAt: exists ? (sheets[id]?.createdAt || serverTimestamp()) : serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await set(ref(db, `rooms/${roomId}/sheets/${id}`), payload);
      sheetIdEl.value = id;
      setStatus("Ficha salva.", "ok");
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

      await set(ref(db, `rooms/${roomId}/sheets/${id}`), null);
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

  // Import JSON handling
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

      setStatus("Carregando estado atual...", "warn");
      const sheetsSnap = await get(ref(db, `rooms/${roomId}/sheets`));
      const existing = sheetsSnap.val() || {};
      const existingIds = new Set(Object.keys(existing));

      const mode = importMode.value === "CREATE_ONLY" ? "CREATE_ONLY" : "MERGE";
      const ts = serverTimestamp();

      const updates = {};
      for(const entry of report.normalizedSheets){
        let id = entry.sheetId || push(ref(db, `rooms/${roomId}/sheets`)).key;

        if(mode === "CREATE_ONLY"){
          // if sheetId existed in input or generated collides, always create new
          if(entry.sheetId && existingIds.has(entry.sheetId)){
            id = push(ref(db, `rooms/${roomId}/sheets`)).key;
          }else if(existingIds.has(id)){
            id = push(ref(db, `rooms/${roomId}/sheets`)).key;
          }
        }else{
          // MERGE
          if(!id) id = push(ref(db, `rooms/${roomId}/sheets`)).key;
        }

        const prev = existing[id] || null;
        const createdAt = prev?.createdAt || ts;

        const payload = {
          name: entry.name,
          attributes: entry.attributes,
          mental: entry.mental,
          items: entry.items,
          advantages: entry.advantages,
          disadvantages: entry.disadvantages,
          createdAt,
          updatedAt: ts
        };

        updates[`rooms/${roomId}/sheets/${id}`] = payload;
      }

      if(Object.keys(updates).length === 0){
        setStatus("Nada para importar.", "warn");
        return;
      }

      setStatus(`Importando ${Object.keys(updates).length} fichas...`, "warn");
      await update(ref(db), updates);
      setStatus("Import concluído.", "ok");
    }catch(e){
      console.error(e);
      setStatus(`Erro no import: ${e?.message || e}`, "err");
    }
  });

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

      const sheetId = typeof s.sheetId === "string" ? s.sheetId.trim() : "";
      const name = typeof s.name === "string" ? s.name.trim() : "";
      if(!name) errors.push(`sheets[${idx}].name obrigatório (string).`);

      const a = s.attributes;
      const attrs = { QI:0, FOR:0, DEX:0, VIG:0 };
      if(a && typeof a === "object"){
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
      if(mental === undefined){
        // ok default 0
      }else{
        if(typeof mental !== "number" || !Number.isFinite(mental) || Math.trunc(mental) !== mental){
          errors.push(`sheets[${idx}].mental deve ser int.`);
        }
      }

      const items = Array.isArray(s.items) ? s.items : [];
      const advantages = Array.isArray(s.advantages) ? s.advantages : [];
      const disadvantages = Array.isArray(s.disadvantages) ? s.disadvantages : [];

      // ignore unknown fields by only taking known ones
      normalizedSheets.push({
        sheetId: sheetId || "",
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
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }
}

/** --------------------------
 * player.html
 * -------------------------- */
function initPlayer(){
  const roomId = mustRoomId();

  const roomCodeOut = $("#roomCodeOut");
  const uidOut = $("#uidOut");
  const btnSignOut = $("#btnSignOut");
  btnSignOut.addEventListener("click", async () => {
    await signOut(auth);
    location.href = "../index.html";
  });

  const charName = $("#charName");
  const mentalOut = $("#mentalOut");
  const gradeSelect = $("#gradeSelect");
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

  const DT_BY_GRADE = { G0:6, G1:9, G2:12, G3:15, G4:21, G5:27, G6:33 };

  let uid = null;
  let assignedSheetId = null;
  let sheet = null;
  let meta = null;

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

    // Assignment for current user
    setStatus("Carregando atribuição...", "warn");
    onValue(ref(db, `rooms/${roomId}/assignments/${uid}`), async (snap) => {
      const val = snap.val();
      assignedSheetId = val?.sheetId || null;

      if(!assignedSheetId){
        sheet = null;
        charName.textContent = "(sem ficha atribuída)";
        mentalOut.textContent = "0";
        for(const k of Object.keys(attrSpans)) attrSpans[k].textContent = "0";
        itemsList.innerHTML = "";
        advantagesList.innerHTML = "";
        disadvantagesList.innerHTML = "";
        setStatus("Sem ficha atribuída. Peça ao GM para atribuir.", "warn");
        return;
      }

      setStatus("Carregando ficha...", "warn");
      onValue(ref(db, `rooms/${roomId}/sheets/${assignedSheetId}`), (s2) => {
        if(!s2.exists()){
          sheet = null;
          setStatus("Ficha atribuída não existe mais.", "err");
          return;
        }
        sheet = s2.val();
        renderSheet();
        setStatus("OK.", "ok");
      });
    });

    // Bind attr buttons
    $$(".btn.attr").forEach(btn => {
      btn.addEventListener("click", () => rollAttribute(btn.dataset.attr));
    });

    // Bind dice buttons
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

    renderList(itemsList, sheet?.items);
    renderList(advantagesList, sheet?.advantages);
    renderList(disadvantagesList, sheet?.disadvantages);
  }

  function renderList(ul, arr){
    ul.innerHTML = "";
    const a = Array.isArray(arr) ? arr : [];
    if(a.length === 0){
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "(vazio)";
      ul.appendChild(li);
      return;
    }
    a.forEach((x)=>{
      const li = document.createElement("li");
      li.textContent = typeof x === "string" ? x : JSON.stringify(x);
      ul.appendChild(li);
    });
  }

  function mentalBonuses(mental){
    // Only these cases in MVP
    let diceBonus = 0;
    let dtBonus = 0;
    if(mental === 4) diceBonus = 5;
    else if(mental === 5) dtBonus = -3;
    else if(mental === -8 || mental === -9) diceBonus = -5;
    else if(mental === -10 || mental === -11){
      // no effect in MVP
    }
    return { diceBonus, dtBonus };
  }

  function rollAttribute(attrKey){
    if(!sheet){
      setStatus("Sem ficha carregada.", "err");
      return;
    }

    const attrs = sheet.attributes || {};
    const attrVal = asNum(attrs[attrKey], 0);
    const mental = asInt(sheet.mental, 0);

    const grade = gradeSelect.value || "G0";
    const DT = DT_BY_GRADE[grade] ?? 6;

    const d12 = buildDice(12);
    const { diceBonus, dtBonus } = mentalBonuses(mental);

    const subtotal = d12 + diceBonus + attrVal + 0;
    const isCrit = (d12 === 12);
    const totalFinal = isCrit ? Math.floor(subtotal * 1.5) : subtotal;
    const success = totalFinal >= (DT + dtBonus);

    rollOut.textContent =
`Atributo: ${attrKey}
Grau: ${grade}  (DT ${DT})
Mental: ${mental}

d12: ${d12}
atributo: ${attrVal}
diceBonus: ${diceBonus}
dtBonus: ${dtBonus}

subtotal: ${subtotal}
crítico?: ${isCrit ? "SIM (d12=12)" : "NÃO"}
totalFinal: ${totalFinal}

sucesso?: ${success ? "SIM" : "NÃO"}  (meta: >= ${DT + dtBonus})`;
  }
}
