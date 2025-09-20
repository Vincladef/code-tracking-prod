// app.js — bootstrapping, routing, context, nav
import {
  getFirestore, doc, setDoc, getDoc, collection, query, where, orderBy, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import * as Schema from "./schema.js";
import * as Modes from "./modes.js";
import * as Goals from "./goals.js";

export const ctx = {
  app: null,
  db: null,
  user: null,        // { uid } passé par index.html
  profile: null,     // profile doc
  categories: [],
  route: "#/dashboard",
};

function $(sel){ return document.querySelector(sel); }
function $$ (sel){ return Array.from(document.querySelectorAll(sel)); }

function routeTo(hash){
  if (!hash) hash = "#/dashboard";
  ctx.route = hash;
  window.location.hash = hash;
  render();
}

async function ensureProfile(){
  const uid = ctx.user.uid;
  const ref = doc(ctx.db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()){
    // Create a minimal profile + slug
    const slug = await Schema.generateSlug(ctx.db);
    const profile = {
      ownerUid: uid,
      displayName: "Invité",
      slug, createdAt: Schema.now(),
      email: "",
    };
    await setDoc(ref, profile, { merge: true });
    return profile;
  } else {
    return snap.data();
  }
}

async function loadCategories(){
  // Categories are per user, default fallback if empty
  const uid = ctx.user.uid;
  const cats = await Schema.fetchCategories(ctx.db, uid);
  ctx.categories = cats;
  renderSidebar();
}

function renderSidebar(){
  const box = $("#profile-box");
  if (!box) return;
  const link = `${location.origin}${location.pathname}#/u/${ctx.user.uid}`;
  box.innerHTML = `
    <div><strong>${ctx.profile.displayName || "Utilisateur"}</strong></div>
    <div class="muted">UID : <code>${ctx.user.uid}</code></div>
    <div class="muted">Lien direct : <a class="link" href="${link}">${link}</a></div>
  `;
  const catBox = $("#category-box");
  if (!catBox) return;
  if (!ctx.categories.length){
    catBox.innerHTML = '<span class="muted">Aucune catégorie. Elles seront créées automatiquement lors de l’ajout d’une consigne.</span>';
  } else {
    catBox.innerHTML = ctx.categories.map(c => `<div class="flex"><span>${c.name}</span><span class="pill">${c.mode}</span></div>`).join("");
  }
}

function bindNav(){
  $$("button[data-route]").forEach(btn => {
    btn.onclick = () => routeTo(btn.getAttribute("data-route"));
  });
  $("#btn-new-session").onclick = () => routeTo("#/practice?new=1");
  $("#btn-add-consigne").onclick = () => Modes.openConsigneForm(ctx);
  $("#btn-add-goal").onclick = () => Goals.openGoalForm(ctx);
}

export async function initApp({ app, db, user }){
  ctx.app = app;
  ctx.db = db;
  ctx.user = user;                // vient de l’URL maintenant
  ctx.profile = await ensureProfile();
  await loadCategories();
  bindNav();

  // Si l’URL est juste "#/u/<uid>", on bascule sur le dashboard
  if (/^#\/u\//.test(location.hash)) {
    window.location.hash = "#/dashboard";
  }

  ctx.route = location.hash || "#/dashboard";
  window.addEventListener("hashchange", () => {
    ctx.route = location.hash || "#/dashboard";
    render();
  });
  render();
}

function newUid(){
  // UID simple, lisible, unique
  return "u-" + Math.random().toString(36).slice(2, 10);
}

export function renderAdmin(ctx, root){
  root.innerHTML = `
    <div class="grid">
      <div class="section-title">
        <h2>Admin — Créer un utilisateur</h2>
      </div>

      <div class="grid cols-2">
        <div class="field">
          <label>Nom/Pseudo</label>
          <input id="adm-name" placeholder="Ex. Alice" />
        </div>
        <div class="field">
          <label>&nbsp;</label>
          <button class="btn primary" id="adm-create">Créer</button>
        </div>
      </div>

      <div id="adm-out" class="card muted" style="margin-top:8px;">Aucun lien généré pour l’instant.</div>
    </div>
  `;

  const out = document.getElementById("adm-out");
  document.getElementById("adm-create").onclick = async () => {
    const name = (document.getElementById("adm-name").value || "").trim() || "Utilisateur";
    const uid = newUid();

    await setDoc(doc(ctx.db, "users", uid), {
      displayName: name,
      createdAt: new Date().toISOString()
    });

    const link = `${location.origin}${location.pathname}#/u/${uid}`;
    out.innerHTML = `Utilisateur <strong>${name}</strong> créé.<br>
      Lien : <a class="link" href="${link}">${link}</a><br>
      Donne-lui ce lien.`;
  };
}

function render(){
  const root = document.getElementById("view-root");
  if (!root) return;
  const [path, arg1] = ctx.route.replace(/^#\//,"").split("/");
  const searchParams = new URLSearchParams(ctx.route.split("?")[1] || "");
  switch(path){
    case "dashboard":
      return Modes.renderDashboard(ctx, root);
    case "daily":
      return Modes.renderDaily(ctx, root);
    case "practice":
      return Modes.renderPractice(ctx, root, { newSession: searchParams.get("new")==="1" });
    case "history":
      return Modes.renderHistory(ctx, root);
    case "goals":
      return Goals.renderGoals(ctx, root);
    case "admin":
      return renderAdmin(ctx, root);
    case "u":
      window.location.hash = "#/dashboard";
      return;
    default:
      root.innerHTML = "<div class='card'>Page inconnue.</div>";
  }
}