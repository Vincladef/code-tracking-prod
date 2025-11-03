<!-- c2fb82d2-2ce6-4652-b025-55b42b56c095 6d7d6cab-bc47-42f5-80fd-4ab7d87e5d81 -->
# Plan Unifier Hydratation Historique

1. **Introduire utilitaire central**  

- Ajouter `applyHistoryEntryToRow(consigne, dayKey, entry, { silent })` dans `modes.js`.  
- Gérer: normalisation valeur (`entry?.value ?? null`), appel `setConsigneRowValue`, `updateConsigneStatusUI`, mise à jour attributs (`data-status`, `data-history-id`, etc.), logs éventuels.

2. **Brancher le quotidien sur l’utilitaire**  

- Dans `renderItemCard` et `renderGroup`, remplacer l’appel direct à `setConsigneRowValue`/`updateConsigneStatusUI` par `applyHistoryEntryToRow` avec l’entrée récupérée depuis `HistoryStore` ou `latestHistoryBuffer`.

3. **Refondre la synchronisation historique**  

- Dans `syncDailyRowFromHistory`, remplacer la logique actuelle (double appel) par `applyHistoryEntryToRow`.  
- Dans l’écouteur `HISTORY_EVENT_NAME`, utiliser uniquement `applyHistoryEntryToRow` pour rafraîchir la ligne et supprimer l’appel redondant à `updateConsigneStatusUI`.

4. **Assainir les flux parallèles**  

- Adapter ou court-circuiter `bindConsigneRowValue` pour les consignes historisées : soit ne plus relier les handlers, soit faire relire `HistoryStore` avant `updateConsigneStatusUI`.  
- Vérifier que `refreshConsigneTimelineWithRows` et la timeline utilisent exclusivement les entrées `HistoryStore.getEntries`.

5. **Nettoyer les appels superflus**  

- Supprimer l’appel final `updateConsigneStatusUI(dailyRow, consigne, record || value)` et tout code devenu inutile après centralisation.  
- Confirmer que les checklists vides (structure complète sans cases cochées) conservent `ko-strong` via `applyHistoryEntryToRow`.

### To-dos

- [ ] Cartographier la génération et la conservation des IDs checklist/sous-consigne dans modes.js, schema.js, utils/checklist-state.js
- [ ] Implémenter la conservation des IDs checklist & sous-consigne et limiter la régénération
- [ ] Adapter les fonctions d’hydratation checklist pour s’appuyer sur les IDs stabilisés
- [ ] Sécuriser les soft deletes et l’accès aux réponses historiques
- [ ] Mettre à jour/ajouter des tests checklist et valider manuellement
- [ ] Créer applyHistoryEntryToRow dans modes.js et couvrir normalisation + status
- [ ] Brancher renderItemCard/renderGroup sur l’utilitaire central
- [ ] Refactoriser syncDailyRowFromHistory et HISTORY_EVENT listener pour utiliser l’utilitaire
- [ ] Neutraliser bindConsigneRowValue et garantir timeline via HistoryStore uniquement
- [ ] Retirer appels redondants et valider comportement checklist 0 case