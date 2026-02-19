import { db, ref, onValue, off, set, update, push, get } from "./firebase.js";
import { state, ensureRoomReady, isGM, getSelectedChar } from "./state.js";
import { openModal, closeModal, setGlobalStatus } from "./ui.js";
import { resolveRoll } from "./engine.js";

const ATTR_KEYS = ["QI","FOR","DEX","VIG"];

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children) n.appendChild(c);
  return n;
}
function kv(label, node){
  return el("div",{class:"kv"},[el("div",{class:"muted small",text:label}),node]);
}
function num(v){ const i=el("input",{type:"number",step:"1",value:String(v??0)}); return i; }
function safeNum(v,f=0){ const n=Number(v); return Number.isFinite(n)?n:f; }

function defaultChar(){
  return {
    name:"Novo Personagem",
    notes:"",
    image:{ dataBase64:null, width:null, height:null, fit:null },
    uiPrefs:{ autoSum:true },
    attributes:{ QI:1, FOR:1, DEX:1, VIG:1 },
    advantages:{}, disadvantages:{}, items:{}
  };
}

async function pushRoll(rollEvent){
  const r = push(ref(db, `rooms/${state.roomId}/rolls`));
  await set(r, rollEvent);
}

async function compressToDataUrl(file, maxDim=512, quality=0.75){
  const url = URL.createObjectURL(file);
  try{
    const img = await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=url; });
    const iw=img.naturalWidth||img.width, ih=img.naturalHeight||img.height;
    const s=Math.min(1, maxDim/Math.max(iw,ih));
    const w=Math.max(1, Math.round(iw*s)), h=Math.max(1, Math.round(ih*s));
    const c=document.createElement("canvas"); c.width=w; c.height=h;
    c.getContext("2d").drawImage(img,0,0,w,h);
    let out=c.toDataURL("image/webp",quality);
    if(!out.startsWith("data:image/webp")) out=c.toDataURL("image/jpeg",quality);
    return out;
  } finally { URL.revokeObjectURL(url); }
}

function rollModal(title, uiResult, rollEvent){
  const body = el("div",{class:"list"});
  body.appendChild(el("div",{class:"item"},[
    el("div",{class:"row space"},[
      el("strong",{text:"d12"}),
      el("span",{class:"pill",text:String(uiResult.d12)})
    ])
  ]));
  const compBox=el("div",{class:"item"});
  compBox.appendChild(el("strong",{text:"Components"}));
  compBox.appendChild(el("div",{class:"hr"}));
  for(const c of (uiResult.components||[])){
    compBox.appendChild(el("div",{class:"row space"},[
      el("span",{text:c.label||""}),
      el("span",{class:"mono",text:String(c.value??0)})
    ]));
  }
  if(!(uiResult.components||[]).length) compBox.appendChild(el("p",{class:"muted small",text:"Nenhum componente."}));
  body.appendChild(compBox);

  const totalBox=el("div",{class:"item"});
  totalBox.appendChild(el("strong",{text:"Total"}));
  totalBox.appendChild(el("div",{class:"hr"}));
  let manual=null;
  if(uiResult.autoSum){
    totalBox.appendChild(el("p",{class:"mono",text:`totalFinal = ${uiResult.totalFinal}`}));
  } else {
    totalBox.appendChild(el("p",{class:"muted small",text:"autoSum=false → totalFinal=null (manual)"}));
    manual=num(""); manual.placeholder="Total (você) — opcional";
    totalBox.appendChild(manual);
  }
  body.appendChild(totalBox);

  const btnSave=el("button",{class:"btn primary",text:"Salvar no log"});
  const btnCancel=el("button",{class:"btn",text:"Cancelar",onclick:closeModal});
  btnSave.addEventListener("click", async ()=>{
    btnSave.disabled=true;
    try{
      if(!uiResult.autoSum && manual){
        const v=(manual.value||"").trim();
        rollEvent.playerEnteredTotal = v===""?null:safeNum(v,null);
      }
      await pushRoll(rollEvent);
      setGlobalStatus("Rolagem salva no log.","ok");
      closeModal();
    } catch(e){
      console.error(e);
      setGlobalStatus(e?.message||"Erro ao salvar rolagem.","err");
    } finally { btnSave.disabled=false; }
  });

  openModal({title, bodyNode:body, actions:[btnSave, btnCancel]});
}

export async function mountSheetTab(root){
  ensureRoomReady();

  const header = el("div",{class:"row space wrap gap"},[
    el("div",{},[
      el("strong",{text:"Ficha(s)"}),
      el("div",{class:"muted small",text:"Multi-ficha por player • d12 + componentes • Logs append-only"})
    ])
  ]);

  const ownerSelect = el("select",{});
  const ownerLine = kv("Dono (ownerUid)", ownerSelect);
  ownerLine.style.display = isGM() ? "" : "none";

  const charSelect = el("select",{});
  const btnNew = el("button",{class:"btn tiny",text:"Nova ficha"});
  const btnDel = el("button",{class:"btn tiny danger",text:"Deletar ficha"});

  root.appendChild(header);
  if(isGM()) root.appendChild(ownerLine);
  root.appendChild(el("div",{class:"row gap wrap"},[kv("Personagem",charSelect), btnNew, btnDel]));
  root.appendChild(el("div",{class:"hr"}));

  const editor = el("div",{class:"list"});
  root.appendChild(editor);

  let unsubMembers=null, unsubChars=null;

  function curOwner(){ return state.selectedOwnerUid || state.uid; }
  function charPath(ownerUid,charId){ return `rooms/${state.roomId}/characters/${ownerUid}/${charId}`; }

  function render(){
    editor.innerHTML="";
    const ownerUid=curOwner();
    const charId=state.selectedCharId;
    const char=getSelectedChar(ownerUid,charId);
    if(!charId || !char){
      editor.appendChild(el("p",{class:"muted",text:"Crie ou selecione uma ficha."}));
      return;
    }

    // Imagem
    const imgCard=el("div",{class:"item"});
    imgCard.appendChild(el("strong",{text:"Imagem"}));
    imgCard.appendChild(el("div",{class:"hr"}));
    const imgbox=el("div",{class:"imgbox"});
    const img=el("img",{alt:"Imagem da ficha"});
    const dataUrl=char?.image?.dataBase64||null;
    img.src = dataUrl || ("data:image/svg+xml;charset=utf-8,"+encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="350">
        <rect width="100%" height="100%" fill="#0f1318"/>
        <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#98a2b3" font-size="22" font-family="monospace">
          Sem imagem (dataBase64=null)
        </text>
      </svg>`
    ));
    imgbox.appendChild(img);
    imgCard.appendChild(imgbox);
    imgCard.appendChild(el("p",{class:"help",text:"PLAYER: envia arquivo (resize/compress) ou cola data URL base64. GM controla width/height/fit na aba Mesa."}));

    const fIn=el("input",{type:"file",accept:"image/*"});
    const tIn=el("textarea",{placeholder:"Cole aqui um data URL (data:image/...)"});
    const bFile=el("button",{class:"btn tiny primary",text:"Processar arquivo → salvar"});
    const bPaste=el("button",{class:"btn tiny primary",text:"Salvar base64 colado"});
    const bClear=el("button",{class:"btn tiny danger",text:"Remover imagem"});

    async function saveImg(v){
      if(!isGM() && ownerUid!==state.uid) throw new Error("PLAYER só pode alterar a própria imagem.");
      await update(ref(db, charPath(ownerUid,charId)+"/image"), { dataBase64: v });
    }

    bFile.addEventListener("click", async ()=>{
      try{
        const f=fIn.files?.[0];
        if(!f) return setGlobalStatus("Selecione um arquivo.","warn");
        setGlobalStatus("Processando imagem…");
        const out=await compressToDataUrl(f,512,0.75);
        await saveImg(out);
        setGlobalStatus("Imagem salva.","ok");
      }catch(e){ console.error(e); setGlobalStatus(e?.message||"Erro ao salvar imagem.","err"); }
    });
    bPaste.addEventListener("click", async ()=>{
      try{
        const v=(tIn.value||"").trim();
        if(!v.startsWith("data:image/")) return setGlobalStatus("Cole um data URL válido.","err");
        await saveImg(v);
        setGlobalStatus("Imagem salva.","ok");
      }catch(e){ console.error(e); setGlobalStatus(e?.message||"Erro ao salvar imagem.","err"); }
    });
    bClear.addEventListener("click", async ()=>{
      try{ await saveImg(null); setGlobalStatus("Imagem removida.","ok"); }
      catch(e){ console.error(e); setGlobalStatus(e?.message||"Erro ao remover imagem.","err"); }
    });

    imgCard.appendChild(kv("Arquivo",fIn));
    imgCard.appendChild(kv("Base64 (data URL)",tIn));
    imgCard.appendChild(el("div",{class:"row gap wrap"},[bFile,bPaste,bClear]));
    editor.appendChild(imgCard);

    // Dados
    const basics=el("div",{class:"item"});
    basics.appendChild(el("strong",{text:"Dados"}));
    basics.appendChild(el("div",{class:"hr"}));
    const name=el("input",{value:char.name||""});
    const notes=el("textarea",{}); notes.value=char.notes||"";
    const auto=el("input",{type:"checkbox"}); auto.checked=!!char?.uiPrefs?.autoSum;
    const bSave=el("button",{class:"btn tiny primary",text:"Salvar"});
    bSave.addEventListener("click", async ()=>{
      try{
        await update(ref(db, charPath(ownerUid,charId)), {
          name:(name.value||"").trim(),
          notes:notes.value||"",
          uiPrefs:{ autoSum: !!auto.checked }
        });
        setGlobalStatus("Dados salvos.","ok");
      }catch(e){ console.error(e); setGlobalStatus(e?.message||"Erro ao salvar.","err"); }
    });
    basics.appendChild(kv("Nome",name));
    basics.appendChild(kv("Notas",notes));
    basics.appendChild(el("div",{class:"row gap"},[
      el("label",{class:"row gap"},[auto, el("span",{text:"autoSum"})]),
      bSave
    ]));
    editor.appendChild(basics);

    // Atributos + rolar
    const attrsCard=el("div",{class:"item"});
    attrsCard.appendChild(el("strong",{text:"Atributos (clique em Rolar)"}));
    attrsCard.appendChild(el("div",{class:"hr"}));
    const inputs={};
    for(const k of ATTR_KEYS){
      const i=num(char?.attributes?.[k] ?? 0);
      inputs[k]=i;
      const b=el("button",{class:"btn tiny primary",text:"Rolar"});
      b.addEventListener("click", async ()=>{
        try{
          const fresh=(await get(ref(db, charPath(ownerUid,charId)))).val() || char;
          const { uiResult, rollEvent } = resolveRoll({
            sourceType:"ATTRIBUTE",
            sourceId:k,
            sourceName:`Atributo ${k}`,
            characterState:fresh,
            autoSum:!!(fresh?.uiPrefs?.autoSum),
            actor:{ uid:state.uid, displayName:state.displayName, role:state.role, charId }
          });
          rollModal(`Rolagem — Atributo ${k}`, uiResult, rollEvent);
        }catch(e){ console.error(e); setGlobalStatus(e?.message||"Erro ao rolar.","err"); }
      });
      attrsCard.appendChild(el("div",{class:"row gap wrap"},[kv(k,i), b]));
    }
    const bSaveAttrs=el("button",{class:"btn tiny primary",text:"Salvar atributos"});
    bSaveAttrs.addEventListener("click", async ()=>{
      try{
        const patch={ attributes:{} };
        for(const k of ATTR_KEYS) patch.attributes[k]=safeNum(inputs[k].value,0);
        await update(ref(db, charPath(ownerUid,charId)), patch);
        setGlobalStatus("Atributos salvos.","ok");
      }catch(e){ console.error(e); setGlobalStatus(e?.message||"Erro ao salvar atributos.","err"); }
    });
    attrsCard.appendChild(el("div",{class:"row gap"},[bSaveAttrs]));
    editor.appendChild(attrsCard);

    editor.appendChild(el("p",{class:"help",text:"Vantagens/Desvantagens/Itens/Import/Grupos ficam na aba Mesa (GM) nesta versão mínima."}));
  }

  async function createChar(){
    const owner=curOwner();
    const charId = push(ref(db, `rooms/${state.roomId}/characters/${owner}`)).key;
    await set(ref(db, charPath(owner,charId)), defaultChar());
    state.selectedCharId=charId;
    setGlobalStatus("Ficha criada.","ok");
  }
  async function deleteChar(){
    const owner=curOwner();
    const charId=state.selectedCharId;
    if(!charId) return;
    if(!confirm("Deletar esta ficha?")) return;
    await set(ref(db, charPath(owner,charId)), null);
    state.selectedCharId=null;
    setGlobalStatus("Ficha deletada.","ok");
  }

  function subMembers(){
    const r=ref(db, `rooms/${state.roomId}/members`);
    const cb=(snap)=>{
      state.members=snap.val()||{};
      ownerSelect.innerHTML="";
      for(const [uid,m] of Object.entries(state.members)){
        ownerSelect.appendChild(el("option",{value:uid,text:`${m.displayName||uid} (${m.role||"?"})`}));
      }
      if(!state.selectedOwnerUid || !state.members[state.selectedOwnerUid]) state.selectedOwnerUid=state.uid;
      ownerSelect.value=state.selectedOwnerUid;
      subChars();
    };
    onValue(r,cb);
    unsubMembers=()=>off(r,"value",cb);
  }
  function subChars(){
    if(unsubChars) unsubChars();
    const owner=curOwner();
    const r=ref(db, `rooms/${state.roomId}/characters/${owner}`);
    const cb=(snap)=>{
      state.charactersByOwner[owner]=snap.val()||{};
      const m=state.charactersByOwner[owner]||{};
      charSelect.innerHTML="";
      const ids=Object.keys(m);
      if(!ids.length){
        charSelect.appendChild(el("option",{value:"",text:"— Sem fichas —"}));
        state.selectedCharId=null;
        render();
        return;
      }
      for(const id of ids) charSelect.appendChild(el("option",{value:id,text:m[id]?.name||id}));
      if(!state.selectedCharId || !m[state.selectedCharId]) state.selectedCharId=ids[0];
      charSelect.value=state.selectedCharId;
      render();
    };
    onValue(r,cb);
    unsubChars=()=>off(r,"value",cb);
  }

  ownerSelect.addEventListener("change", ()=>{ state.selectedOwnerUid=ownerSelect.value; state.selectedCharId=null; subChars(); });
  charSelect.addEventListener("change", ()=>{ state.selectedCharId=charSelect.value||null; render(); });
  btnNew.addEventListener("click", ()=>createChar().catch(e=>setGlobalStatus(e?.message||"Erro.","err")));
  btnDel.addEventListener("click", ()=>deleteChar().catch(e=>setGlobalStatus(e?.message||"Erro.","err")));

  subMembers();
  if(!isGM()) subChars();

  state.unsub.push(()=>{ if(unsubMembers) unsubMembers(); });
  state.unsub.push(()=>{ if(unsubChars) unsubChars(); });
}
