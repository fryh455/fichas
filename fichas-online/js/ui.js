import { state, isGM } from "./state.js";
import { mountSheetTab } from "./sheet.js";
import { mountMentalTab } from "./mental.js";
import { mountLogsTab } from "./logs.js";
import { mountGMTab } from "./gm.js";

const $ = (id) => document.getElementById(id);

export function setGlobalStatus(msg, kind="") {
  const el = $("globalStatus");
  el.textContent = msg || "";
  el.className = "status " + (kind || "");
}

export function openModal({ title, bodyNode, actions = [] }) {
  const modal = $("modal");
  $("modalTitle").textContent = title || "";
  const body = $("modalBody");
  const actionsEl = $("modalActions");

  body.innerHTML = "";
  actionsEl.innerHTML = "";

  if (bodyNode) body.appendChild(bodyNode);

  for (const a of actions) {
    actionsEl.appendChild(a);
  }

  modal.setAttribute("aria-hidden", "false");
}

export function closeModal() {
  $("modal").setAttribute("aria-hidden", "true");
  $("modalBody").innerHTML = "";
  $("modalActions").innerHTML = "";
}

export function initUI() {
  $("modalClose").addEventListener("click", closeModal);
  $("modal").addEventListener("click", (e) => {
    if (e.target === $("modal")) closeModal();
  });

  const tabs = $("tabs");
  const pageBody = $("pageBody");

  const render = async (tab) => {
    pageBody.innerHTML = "";
    setGlobalStatus("");

    if (tab === "sheet") return mountSheetTab(pageBody);
    if (tab === "mental") return mountMentalTab(pageBody);
    if (tab === "logs") return mountLogsTab(pageBody);
    if (tab === "gm") {
      if (!isGM()) {
        pageBody.innerHTML = `<p class="muted">Acesso restrito ao GM.</p>`;
        return;
      }
      return mountGMTab(pageBody);
    }
  };

  const setActive = (tab) => {
    for (const b of tabs.querySelectorAll(".tab")) {
      b.classList.toggle("active", b.dataset.tab === tab);
    }
  };

  tabs.addEventListener("click", async (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    const tab = btn.dataset.tab;
    if (!tab) return;
    if (tab === "gm" && !isGM()) return;

    setActive(tab);
    await render(tab);
  });

  // initial
  setActive("sheet");
  render("sheet");
}
