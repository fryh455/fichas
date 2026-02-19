import { db, ref, onValue, off, query, limitToLast } from "./firebase.js";
import { state, ensureRoomReady } from "./state.js";

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of children) n.appendChild(c);
  return n;
}

function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleString("pt-BR");
  } catch {
    return String(ts || "");
  }
}

export async function mountLogsTab(root) {
  ensureRoomReady();

  root.appendChild(el("div", {}, [
    el("strong", { text: "Logs" }),
    el("div", { class: "muted small", text: "Feed em /rolls (limitToLast=100) • append-only" })
  ]));

  const list = el("div", { class: "list" });
  root.appendChild(el("div", { class: "hr" }));
  root.appendChild(list);

  const r = query(ref(db, `rooms/${state.roomId}/rolls`), limitToLast(100));

  const cb = (snap) => {
    const obj = snap.val() || {};
    const items = Object.entries(obj).map(([id, v]) => ({ id, ...(v || {}) }));
    items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    list.innerHTML = "";
    if (!items.length) {
      list.appendChild(el("p", { class: "muted", text: "Sem rolagens ainda." }));
      return;
    }

    for (const it of items) {
      const comps = it.components || [];
      const compLines = el("div", { class: "small muted" });
      if (comps.length) {
        compLines.appendChild(el("div", { class: "badge", text: "components:" }));
        for (const c of comps) {
          compLines.appendChild(el("div", { class: "mono", text: `- ${c.label}: ${c.value}` }));
        }
      } else {
        compLines.appendChild(el("div", { class: "muted small", text: "components: (vazio)" }));
      }

      const totalText = (it.totalFinal === null || typeof it.totalFinal === "undefined")
        ? `manual${(it.playerEnteredTotal === null || typeof it.playerEnteredTotal === "undefined") ? "" : `=${it.playerEnteredTotal}`}`
        : String(it.totalFinal);

      const card = el("div", { class: "item" }, [
        el("div", { class: "row space wrap" }, [
          el("div", {}, [
            el("strong", { text: `${it.displayName || "?"} — ${it.sourceName || "?"}` }),
            el("div", { class: "muted small", text: `${it.role || "?"} • charId=${it.charId || "?"} • ${fmtTime(it.timestamp)}` })
          ]),
          el("span", { class: "pill", text: `d12=${(it.diceRolled && it.diceRolled[0]) || "?"} • total=${totalText}` })
        ]),
        el("div", { class: "hr" }),
        compLines
      ]);

      list.appendChild(card);
    }
  };

  onValue(r, cb);
  state.unsub.push(() => off(r, "value", cb));
}
