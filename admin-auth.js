import { isAdminHashPlaceholder, resolveAdminHash } from "./admin-hash.js";

const ADMIN_ACCESS_KEY = "hp::admin::authorized";
const STATUS_ELEMENT_ID = "admin-login-status";
const MAX_ATTEMPTS = 3;
const ADMIN_HASH_TIMEOUT_MS = 2000;
const ADMIN_HASH_POLL_INTERVAL_MS = 50;

function updateStatus(message) {
  const el = document.getElementById(STATUS_ELEMENT_ID);
  if (el) {
    el.textContent = message;
  }
}

function getSessionStorage() {
  try {
    return window.sessionStorage;
  } catch (error) {
    console.warn("[admin-auth] sessionStorage inaccessible", error);
    return null;
  }
}

function storeAdminAccess(isAllowed) {
  const storage = getSessionStorage();
  if (!storage) return;
  if (isAllowed) {
    storage.setItem(ADMIN_ACCESS_KEY, "true");
  } else {
    storage.removeItem(ADMIN_ACCESS_KEY);
  }
}

function redirectToIndex(hash = "") {
  const target = new URL("index.html", window.location.href);
  target.hash = hash;
  window.location.replace(target.toString());
}

function redirectToAdmin() {
  redirectToIndex("#/admin");
}

function redirectToHome() {
  redirectToIndex("");
}

async function sha256Hex(value) {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function promptForPassword(expectedHash) {
  if (typeof crypto === "undefined" || !crypto?.subtle) {
    updateStatus("Impossible de vérifier le mot de passe sur ce navigateur.");
    alert("Votre navigateur ne supporte pas SHA-256. Accès refusé.");
    redirectToHome();
    return;
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const input = window.prompt("Mot de passe administrateur", "");
    if (input === null) {
      updateStatus("Vérification annulée.");
      redirectToHome();
      return;
    }
    const hash = await sha256Hex(input);
    if (hash === expectedHash) {
      storeAdminAccess(true);
      updateStatus("Accès accordé. Redirection…");
      redirectToAdmin();
      return;
    }
    alert("Mot de passe incorrect.");
  }

  storeAdminAccess(false);
  updateStatus("Accès refusé.");
  redirectToHome();
}

function sleep(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

async function waitForAdminHash(timeoutMs = ADMIN_HASH_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let value = resolveAdminHash();
  while (isAdminHashPlaceholder(value) && Date.now() < deadline) {
    await sleep(ADMIN_HASH_POLL_INTERVAL_MS);
    value = resolveAdminHash();
  }
  return value;
}

(async function start() {
  const adminHash = await waitForAdminHash();
  if (isAdminHashPlaceholder(adminHash)) {
    updateStatus("Hash administrateur non configuré.");
    alert("Le hash administrateur n'est pas configuré. Exécutez le workflow pour le générer.");
    redirectToHome();
    return;
  }

  const storage = getSessionStorage();
  const alreadyAllowed = storage?.getItem(ADMIN_ACCESS_KEY) === "true";
  if (alreadyAllowed) {
    updateStatus("Session admin active. Redirection…");
    redirectToAdmin();
    return;
  }

  storeAdminAccess(false);
  updateStatus("Vérification du mot de passe…");
  promptForPassword(adminHash).catch((error) => {
    console.error("[admin-auth] Erreur lors de la vérification", error);
    alert("Erreur lors de la vérification du mot de passe.");
    storeAdminAccess(false);
    redirectToHome();
  });
})();
