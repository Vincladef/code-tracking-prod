import { addDoc, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import * as Schema from "./schema.js";

export async function renderGoals(ctx, root) {
  const uid = ctx.user.uid;
  const q = query(Schema.col(ctx.db, uid, "goals"), orderBy("createdAt","desc"));
  const ss = await getDocs(q);
  const items = ss.docs.map(d => ({ id:d.id, ...d.data() }));

  root.innerHTML = `
    <div class="grid gap-3">
      <div class="flex justify-between items-center">
        <h2 class="text-lg font-semibold">Objectifs</h2>
        <button id="btn-new-goal" class="px-3 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white">+ Nouvel objectif</button>
      </div>
      <div class="grid gap-2">
        ${items.map(g => `
          <div class="p-3 rounded-xl border border-gray-700 bg-gray-900">
            <div class="flex justify-between">
              <div>
                <div class="font-medium">${Schema.now() && (g.title || "(Sans titre)")}</div>
                <div class="text-sm text-gray-400">${g.scope || "hebdomadaire"} · créé le ${new Date(g.createdAt).toLocaleDateString()}</div>
              </div>
              <div class="text-sm text-gray-300">${g.progress || 0}/${g.target || 1}</div>
            </div>
          </div>
        `).join("") || `<div class="text-gray-400">Aucun objectif.</div>`}
      </div>
    </div>
  `;

  document.getElementById("btn-new-goal").onclick = () => openGoalForm(ctx);
}

export function openGoalForm(ctx) {
  const dlg = document.createElement("dialog");
  dlg.className = "rounded-2xl bg-gray-900 border border-gray-700 p-0 text-gray-100";
  dlg.innerHTML = `
    <form method="dialog" class="grid gap-3 p-4 w-[min(92vw,460px)]">
      <h3 class="text-lg font-semibold">Nouvel objectif</h3>

      <label class="grid gap-1">
        <span class="text-sm text-gray-400">Titre</span>
        <input name="title" class="w-full" placeholder="Ex. 3 séances de piano" required>
      </label>

      <label class="grid gap-1">
        <span class="text-sm text-gray-400">Périodicité</span>
        <select name="scope" class="w-full">
          <option value="weekly">Hebdomadaire</option>
          <option value="monthly">Mensuel</option>
          <option value="yearly">Annuel</option>
        </select>
      </label>

      <label class="grid gap-1">
        <span class="text-sm text-gray-400">Cible (quantité)</span>
        <input type="number" name="target" min="1" step="1" value="1" class="w-full">
      </label>

      <div class="flex gap-2 justify-end mt-2">
        <button value="close" class="px-3 py-1 rounded-lg bg-gray-800 border border-gray-600 hover:bg-gray-700">Annuler</button>
        <button id="go-save" class="px-3 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white">Créer</button>
      </div>
    </form>
  `;
  document.body.appendChild(dlg);
  dlg.showModal();

  dlg.querySelector("#go-save").addEventListener("click", async (e) => {
    e.preventDefault();
    const f = dlg.querySelector("form");
    const payload = {
      title: f.title.value.trim(),
      scope: f.scope.value,
      target: Number(f.target.value)||1,
      progress: 0,
      createdAt: Schema.now()
    };
    if (!payload.title) return;
    await addDoc(Schema.col(ctx.db, ctx.user.uid, "goals"), payload);
    dlg.close();
    renderGoals(ctx, document.getElementById("view-root"));
  });

  dlg.addEventListener("close", ()=> dlg.remove());
}
