// Ce module expose la valeur du hash administrateur.
//
// Par défaut, il se replie sur la valeur placeholder. Lors du déploiement, le
// workflow « Generate Admin Hash » génère `admin-config.js` qui définit la
// variable globale `window.__HP_ADMIN_HASH__`. Ce module récupère la valeur à
// chaque lecture afin de s'adapter même si le script de configuration est
// chargé après coup.

const PLACEHOLDER_VALUE = "__ADMIN_HASH_PLACEHOLDER__";

function isMeaningful(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return trimmed !== PLACEHOLDER_VALUE;
}

function readFromWindow() {
  if (typeof window === "undefined") return null;
  const value = window.__HP_ADMIN_HASH__;
  return isMeaningful(value) ? value.trim() : null;
}

function readFromMeta() {
  if (typeof document === "undefined") return null;
  const meta = document.querySelector('meta[name="hp:admin-hash"]');
  if (!meta) return null;
  return isMeaningful(meta.content) ? meta.content.trim() : null;
}

export function resolveAdminHash() {
  return readFromWindow() ?? readFromMeta() ?? PLACEHOLDER_VALUE;
}

export function isAdminHashPlaceholder(value = resolveAdminHash()) {
  return !value || value === PLACEHOLDER_VALUE;
}

export const ADMIN_HASH_PLACEHOLDER = PLACEHOLDER_VALUE;

// Valeur actuelle (lecture à l'import, conservée pour rétro-compatibilité).
export const ADMIN_HASH = resolveAdminHash();
