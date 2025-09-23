// Ce fichier peut être généré automatiquement par le workflow GitHub Actions
// « Generate Admin Hash ». Il définit la valeur du hash administrateur au
// runtime via la variable globale `window.__HP_ADMIN_HASH__`.
//
// En local, vous pouvez ajuster la valeur manuellement ou laisser le workflow
// la remplacer lors du déploiement.
(function applyAdminHash() {
  if (typeof window === "undefined") {
    return;
  }
  const current = window.__HP_ADMIN_HASH__;
  if (typeof current === "string" && current && current !== "__ADMIN_HASH_PLACEHOLDER__") {
    return;
  }
  window.__HP_ADMIN_HASH__ = "__ADMIN_HASH_PLACEHOLDER__";
})();
