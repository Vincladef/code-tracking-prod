// goals.js — Objectifs
import { collection, addDoc, updateDoc, doc, query, orderBy, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (sel, root = document) => root.querySelector(sel);

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function modal(html) {
  const wrap = document.createElement("div");
  wrap.className = "fixed inset-0 z-50 grid place-items-center bg-black/60";
  wrap.innerHTML = `<div class="w-[min(640px,92vw)] rounded-2xl bg-[#0f172a] border border-[#1f2a44] p-4 shadow-xl">${html}</div>`;
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) wrap.remove();
  });
  document.body.appendChild(wrap);
  return wrap;
}

function periodLabel(value) {
  return (
    {
      weekly: "Hebdomadaire",
      monthly: "Mensuel",
      yearly: "Annuel"
    }[value] || value || "—"
  );
}

export async function renderGoals(ctx, root) {
  root.innerHTML = `<div class="card p-4 grid gap-4">
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-semibold">Objectifs</h2>
      <button class="px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-500" id="new-goal">+ Nouvel objectif</button>
    </div>
    <div class="grid gap-3" id="goals-list"></div>
  </div>`;

  $("#new-goal", root).onclick = () => openGoalForm(ctx);

  const qy = query(collection(ctx.db, `u/${ctx.user.uid}/goals`), orderBy("createdAt", "desc"));
  const ss = await getDocs(qy);
  const list = $("#goals-list", root);

  if (ss.empty) {
    list.innerHTML = `<div class="rounded-xl border border-white/10 bg-white/5 p-3 text-sm opacity-70">Aucun objectif pour le moment.</div>`;
    return;
  }

  list.innerHTML = "";
  ss.forEach((docSnap) => {
    const goal = { id: docSnap.id, ...docSnap.data() };
    const card = document.createElement("div");
    card.className = "rounded-xl border border-white/10 bg-white/5 p-3 flex flex-col gap-2";
    card.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="font-semibold">${escapeHtml(goal.title)}</div>
          <div class="text-sm opacity-70">${periodLabel(goal.period)}</div>
        </div>
        <button class="text-sm px-2 py-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10" data-action="edit">Modifier</button>
      </div>
    `;
    card.querySelector('[data-action="edit"]').onclick = () => openGoalForm(ctx, goal);
    list.appendChild(card);
  });
}

export async function openGoalForm(ctx, goal = null) {
  const html = `
    <h3 class="text-lg font-semibold mb-2">${goal ? "Modifier" : "Nouvel"} objectif</h3>
    <form class="grid gap-3" id="goal-form">
      <label class="grid gap-1">
        <span class="text-sm">Titre</span>
        <input name="title" required class="rounded-lg bg-white/5 border border-white/10 px-3 py-2" value="${escapeHtml(goal?.title || "")}">
      </label>
      <label class="grid gap-1">
        <span class="text-sm">Périodicité</span>
        <select name="period" class="rounded-lg bg-white/5 border border-white/10 px-3 py-2">
          <option value="weekly" ${goal?.period === "weekly" ? "selected" : ""}>Hebdomadaire</option>
          <option value="monthly" ${goal?.period === "monthly" ? "selected" : ""}>Mensuel</option>
          <option value="yearly" ${goal?.period === "yearly" ? "selected" : ""}>Annuel</option>
        </select>
      </label>
      <div class="flex justify-end gap-2">
        <button type="button" class="px-3 py-2 rounded-lg bg-white/5 border border-white/10" id="cancel">Annuler</button>
        <button type="submit" class="px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-500">Enregistrer</button>
      </div>
    </form>`;
  const m = modal(html);
  $("#cancel", m).onclick = () => m.remove();
  $("#goal-form", m).onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      title: fd.get("title").trim(),
      period: fd.get("period"),
      active: true,
      createdAt: serverTimestamp()
    };
    if (!payload.title) {
      alert("Titre obligatoire");
      return;
    }
    if (goal) {
      await updateDoc(doc(ctx.db, `u/${ctx.user.uid}/goals/${goal.id}`), {
        ...payload,
        updatedAt: serverTimestamp()
      });
    } else {
      await addDoc(collection(ctx.db, `u/${ctx.user.uid}/goals`), {
        ownerUid: ctx.user.uid,
        ...payload
      });
    }
    m.remove();
    renderGoals(ctx, document.getElementById("view-root"));
  };
}
