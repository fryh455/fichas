import { db, ref, onValue, off, set } from "./firebase.js";
import { state, ensureRoomReady } from "./state.js";
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

export async function mountMentalTab(root) {
  ensureRoomReady();

  const title = el("div", {}, [
    el("strong", { text: "Mental" }),
    el("div", { class: "muted small", text: "Salvo em /rooms/{roomId}/mental/{uid}" })
  ]);

  const valueInput = el("input", { type: "number", step: "1", value: "0" });
  const btnSave = el("button", { class: "btn tiny primary", text: "Salvar" });
  const help = el("p", { class: "help", text: "Sugestão: use qualquer escala numérica que você quiser. O app só armazena value + updatedAt." });

  const box = el("div", { class: "item" });
  box.appendChild(title);
  box.appendChild(el("div", { class: "hr" }));
  box.appendChild(el("label", { class: "field" }, [el("span", { class: "muted small", text: "value" }), valueInput]));
  box.appendChild(el("div", { class: "row gap" }, [btnSave]));
  box.appendChild(help);

  root.appendChild(box);

  const path = `rooms/${state.roomId}/mental/${state.uid}`;
  const r = ref(db, path);

  const cb = (snap) => {
    const v = snap.val();
    if (v && typeof v.value !== "undefined") valueInput.value = String(v.value);
  };

  onValue(r, cb);

  btnSave.addEventListener("click", async () => {
    try {
      const v = Number(valueInput.value);
      if (!Number.isFinite(v)) return setGlobalStatus("value inválido.", "err");
      await set(ref(db, path), { value: v, updatedAt: Date.now() });
      setGlobalStatus("Mental salvo.", "ok");
    } catch (e) {
      console.error(e);
      setGlobalStatus(e?.message || "Erro ao salvar mental.", "err");
    }
  });

  // cleanup
  state.unsub.push(() => off(r, "value", cb));
}
