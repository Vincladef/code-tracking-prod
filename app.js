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
  auth: null,
  user: null,        // Firebase user (anon)
  profile: null,     // profile doc
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
  const link = `${location.origin}${location.pathname}#/u/${ctx.profile.slug}`;
  box.innerHTML = `
    <div><strong>${ctx.profile.displayName || "Invité"}</strong></div>
    <div class="muted">UID: <code>${ctx.user.uid}</code></div>
    <div class="muted">Lien direct : <a class="link" href="${link}">${link}</a></div>
    <div class="muted" style="margin-top:6px;">⚠️ En V1, l’accès multi‑appareil nécessite l’export/import de données (Settings → bientôt).</div>
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

export async function initApp({ app, db, auth }){
  ctx.app = app; ctx.db = db; ctx.auth = auth;
  ctx.user = auth.currentUser;
  ctx.profile = await ensureProfile();
  await loadCategories();
  bindNav();
  // Initial route
  const h = location.hash || "#/dashboard";
  ctx.route = h;
  window.addEventListener("hashchange", () => {
    ctx.route = location.hash || "#/dashboard";
    render();
  });
  render();
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
    case "u":
      // Pretty user URLs — informational in V1
      root.innerHTML = \`<div class="grid">
        <h2>Profil public</h2>
        <div class="card">Ce lien est décoratif en V1 (sécurité via UID). Slug demandé : <strong>\${arg1}</strong>.</div>
        <div><button class="btn" onclick="location.hash='#/dashboard'">Retour</button></div>
      </div>\`;
      return;
    default:
      root.innerHTML = "<div class='card'>Page inconnue.</div>";
  }
}
