# Manuel de vérification — mise en forme riche

Ce scénario couvre la régression observée lors de l’application successive de mises en forme
(gras puis italique) suivie de l’insertion d’une case à cocher.

1. Ouvrir l’interface contenant un champ riche généré par `renderRichTextInput`.
2. Saisir une phrase simple (« Test mise en forme »).
3. Sélectionner le texte, cliquer sur l’icône **Gras** puis, sans modifier la sélection,
   cliquer sur l’icône *Italique*.
4. Confirmer que le texte reste sélectionné et qu’il est rendu en `<strong><em>…</em></strong>`
   (inspecter le DOM si nécessaire).
5. Placer le curseur à la fin du paragraphe et insérer une case à cocher via le bouton dédié.
6. Vérifier que la case à cocher apparaît juste après le texte stylé et qu’il est possible de
   continuer à saisir du contenu sans perte de sélection ni erreur console.
7. Soumettre/valider le formulaire pour confirmer que la valeur sérialisée contient
   `checkboxes` et la hiérarchie HTML attendue.

Ce test garantit que les captures/restaurations de sélection continuent de fonctionner après la
normalisation du DOM (`sanitizeElement`).
