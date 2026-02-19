import { db, ref, onValue, off, get, set, update, push } from "./firebase.js";
import { state, ensureRoomReady, isGM } from "./state.js";
import { setGlobalStatus } from "./ui.js";

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
function safeNum(v,f=null){ const n=Number(v); return Number.isFinite(n)?n:f; }

export async function mountGMTab(root){
  ensureRoomReady();
  if(!isGM()){
    root.appendChild(el("p",{class:"muted",text:"Acesso restrito ao GM."}));
    return;
  }

  root.appendChild(el("div",{},[
    el("strong",{text:"Mesa (GM) — versão mínima"}),
    el("div",{class:"muted small",text:"Lista players + fichas • controla image.width/height/fit • delete"}
  ]));
  root.appendChild(el("div",{class:"hr"}));

  const list=el("div",{class:"list"});
  root.appendChild(list);

  async function render(){
    list.innerHTML="";
    const members = state.members || {};
    const uids = Object.keys(members);
    if(!uids.length){
      list.appendChild(el("p",{class:"muted",text:"Sem membros."}));
      return;
    }
    for(const uid of uids){
      const m=members[uid]||{};
      const card=el("div",{class:"item"});
      card.appendChild(el("div",{class:"row space wrap"},[
        el("strong",{text:`${m.displayName||uid} (${m.role||"?"})`}),
        el("span",{class:"badge",text:uid})
      ]));

      const chars = state.charactersByOwner?.[uid] || {};
      const entries = Object.entries(chars);
      if(!entries.length){
        card.appendChild(el("p",{class:"muted small",text:"Nenhuma ficha."}));
      } else {
        for(const [charId,c] of entries){
          const row=el("div",{class:"item"});
          row.appendChild(el("div",{class:"row space wrap"},[
            el("strong",{text:c?.name||charId}),
            el("span",{class:"badge",text:`charId=${charId}`})
          ]));

          const wIn=el("input",{type:"number",step:"1",value:String(c?.image?.width ?? 220)});
          const hIn=el("input",{type:"number",step:"1",value:String(c?.image?.height ?? 220)});
          const fit=el("select",{});
          fit.appendChild(el("option",{value:"cover",text:"cover"}));
          fit.appendChild(el("option",{value:"contain",text:"contain"}));
          fit.value=(c?.image?.fit==="contain")?"contain":"cover";

          const btnSave=el("button",{class:"btn tiny",text:"Salvar tamanho"});
          btnSave.addEventListener("click", async ()=>{
            try{
              await update(ref(db, `rooms/${state.roomId}/characters/${uid}/${charId}/image`),{
                width:safeNum(wIn.value,220),
                height:safeNum(hIn.value,220),
                fit:fit.value
              });
              setGlobalStatus("Tamanho da imagem salvo.","ok");
            }catch(e){ console.error(e); setGlobalStatus(e?.message||"Erro ao salvar.","err"); }
          });

          const btnDel=el("button",{class:"btn tiny danger",text:"Deletar"});
          btnDel.addEventListener("click", async ()=>{
            try{
              if(!confirm("Deletar esta ficha?")) return;
              await set(ref(db, `rooms/${state.roomId}/characters/${uid}/${charId}`), null);
              setGlobalStatus("Ficha deletada.","ok");
            }catch(e){ console.error(e); setGlobalStatus(e?.message||"Erro ao deletar.","err"); }
          });

          row.appendChild(el("div",{class:"row gap wrap"},[
            el("div",{class:"field",style:"min-width:140px"},[el("span",{class:"muted small",text:"width"}), wIn]),
            el("div",{class:"field",style:"min-width:140px"},[el("span",{class:"muted small",text:"height"}), hIn]),
            el("div",{class:"field",style:"min-width:140px"},[el("span",{class:"muted small",text:"fit"}), fit]),
            btnSave, btnDel
          ]));

          card.appendChild(row);
        }
      }
      list.appendChild(card);
    }
  }

  const membersRef=ref(db, `rooms/${state.roomId}/members`);
  const membersCb = async (snap)=>{
    state.members = snap.val() || {};
    // pull chars for each uid (simple, small tables)
    const all = {};
    for(const uid of Object.keys(state.members)){
      const s = await get(ref(db, `rooms/${state.roomId}/characters/${uid}`));
      all[uid]=s.val()||{};
    }
    state.charactersByOwner = all;
    render();
  };

  onValue(membersRef, membersCb);
  state.unsub.push(()=>off(membersRef,"value",membersCb));
}
