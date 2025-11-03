<!-- c2fb82d2-2ce6-4652-b025-55b42b56c095 6d7d6cab-bc47-42f5-80fd-4ab7d87e5d81 -->
# Plan Stabiliser affichage historique

1. **Tracer le flux complet**  

- Ajouter/valider des logs ciblant `dispatchHistoryUpdateEvent`, `daily.row.apply`, `HistoryStore.getEntry`.  
- Vérifier que chaque journal transporte `historyId` et `value` non vides.

2. **Sécuriser les écritures HistoryStore**  

- Auditer `historyStoreUpsert` et les appels correspondants pour garantir `value` structurée (checklists incluses).  
- Uniformiser les `dayKey/historyId` avant upsert.

3. **Forcer la lecture post-save**  

- S’assurer que `historyStoreEnsureEntries(...,{force:true})` est appelé juste après chaque sauvegarde/clear et avant `renderDaily`.  
- Ajouter un fallback `reloadConsigneHistory` lors de la navigation si l’entrée est manquante.

4. **Nettoyer les chemins résiduels**  

- Remplacer les derniers `setConsigneRowValue`/`updateConsigneStatusUI` directs par `applyHistoryEntryToRow`.  
- Supprimer tout fallback `dailyResponses` ou lecture DOM qui écraserait l’état.

5. **Valider end-to-end**  

- Tester : edit via pastille, via texte, navigation vers un autre jour → retour sur le jour initial.  
- Vérifier pastille, titre, timeline, logs pour chaque étape.  
- Documenter la séquence attendue et les checks automatisables.

### To-dos

- [x] 