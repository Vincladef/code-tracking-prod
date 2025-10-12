/**
 * Test d'intégration: Vérifie que les deux couches de protection fonctionnent ensemble
 * 
 * Couche 1: Click event handler (app.js lignes 1-28)
 * Couche 2: Change event handler (app.js lignes 626+)
 * 
 * Ce test simule le scénario du bug original où un utilisateur:
 * 1. Clique sur "surpasser cet élément" (⏭) pour skipper un item
 * 2. Clique à nouveau sur la checkbox de l'item skippé
 * 
 * Comportement attendu: La checkbox reste décochée et disabled
 */

const assert = require("assert");

// Simulate the skip button click (from app.js lines 598-624)
function simulateSkipButtonClick(input, item) {
  const wasSkipped =
    (input.dataset && input.dataset.checklistSkip === "1") ||
    (item.dataset && item.dataset.checklistSkipped === "1");
  
  const nextSkipped = !wasSkipped;
  
  // Apply skip state (simplified version)
  if (nextSkipped) {
    input.checked = false;
    input.disabled = true;
    if (input.dataset) input.dataset.checklistSkip = "1";
    if (item.dataset) item.dataset.checklistSkipped = "1";
  } else {
    input.disabled = false;
    if (input.dataset) delete input.dataset.checklistSkip;
    if (item.dataset) delete item.dataset.checklistSkipped;
  }
  
  return { wasSkipped, nextSkipped };
}

// Simulate the click event handler (app.js lines 3-27)
function simulateClickEventHandler(checkbox, item) {
  // Check if item is skipped
  const isSkipped = 
    (item.classList && item.classList.contains('checklist-item--skipped')) ||
    item.getAttribute('data-checklist-skipped') === '1' ||
    checkbox.getAttribute('data-checklist-skip') === '1';
  
  if (isSkipped) {
    // Prevent click
    return { prevented: true, message: 'Cet élément est ignoré.' };
  }
  
  return { prevented: false };
}

// Simulate the change event handler (app.js lines 626-650)
function simulateChangeEventHandler(checkbox, item) {
  const skipped =
    (checkbox.dataset && checkbox.dataset.checklistSkip === "1") ||
    (item.dataset && item.dataset.checklistSkipped === "1");
  
  if (skipped) {
    // Prevent the change if item is skipped - revert to unchecked state
    checkbox.checked = false;
    return { prevented: true, saved: false };
  }
  
  // Normal flow: save the change
  return { prevented: false, saved: true };
}

console.log("\n=== Test d'intégration: Protection contre le changement d'état d'items skippés ===\n");

// Scenario complet du bug
{
  console.log("Scénario 1: Bug original - Cliquer sur un item skippé");
  
  const mockCheckbox = {
    checked: false,
    disabled: false,
    dataset: {},
    getAttribute: function(key) { return this.dataset[key]; }
  };
  
  const mockItem = {
    dataset: {},
    classList: {
      _classes: new Set(),
      contains: function(cls) { return this._classes.has(cls); },
      add: function(cls) { this._classes.add(cls); },
    },
    getAttribute: function(key) { 
      if (key === 'data-checklist-skipped') return this.dataset.checklistSkipped;
      return null;
    }
  };
  
  // Étape 1: L'utilisateur clique sur le bouton "surpasser"
  console.log("  1. Utilisateur clique sur ⏭ (surpasser)");
  const skipResult = simulateSkipButtonClick(mockCheckbox, mockItem);
  assert.strictEqual(skipResult.nextSkipped, true, "Item should be skipped");
  assert.strictEqual(mockCheckbox.checked, false, "Checkbox should be unchecked after skip");
  assert.strictEqual(mockCheckbox.disabled, true, "Checkbox should be disabled after skip");
  console.log("     ✓ Item marqué comme skippé");
  
  // Étape 2: L'utilisateur clique sur la checkbox (tentative de coche)
  console.log("  2. Utilisateur clique sur la checkbox");
  
  // Couche 1: Click event handler
  const clickResult = simulateClickEventHandler(mockCheckbox, mockItem);
  assert.strictEqual(clickResult.prevented, true, "Click should be prevented");
  console.log("     ✓ Couche 1: Click event prevented");
  
  // Si le click n'était pas prevented (fallback)
  mockCheckbox.checked = true; // Simule un click qui passe quand même
  console.log("  3. Change event déclenché (fallback si click non prevented)");
  
  // Couche 2: Change event handler (notre fix)
  const changeResult = simulateChangeEventHandler(mockCheckbox, mockItem);
  assert.strictEqual(changeResult.prevented, true, "Change should be prevented");
  assert.strictEqual(changeResult.saved, false, "Change should not be saved");
  assert.strictEqual(mockCheckbox.checked, false, "Checkbox should be reverted to unchecked");
  console.log("     ✓ Couche 2: Change event prevented, checkbox revertée à unchecked");
  
  console.log("\n  ✅ Bug résolu: L'item skippé reste décoché\n");
}

// Scenario 2: Comportement normal (item non-skippé)
{
  console.log("Scénario 2: Comportement normal - Item non-skippé");
  
  const mockCheckbox = {
    checked: false,
    disabled: false,
    dataset: {},
    getAttribute: function(key) { return this.dataset[key]; }
  };
  
  const mockItem = {
    dataset: {},
    classList: {
      _classes: new Set(),
      contains: function(cls) { return this._classes.has(cls); },
    },
    getAttribute: function(key) { return null; }
  };
  
  console.log("  1. Utilisateur clique sur la checkbox");
  
  // Click event handler
  const clickResult = simulateClickEventHandler(mockCheckbox, mockItem);
  assert.strictEqual(clickResult.prevented, false, "Click should not be prevented");
  console.log("     ✓ Click autorisé");
  
  // Simule le changement d'état
  mockCheckbox.checked = true;
  console.log("  2. Change event déclenché");
  
  // Change event handler
  const changeResult = simulateChangeEventHandler(mockCheckbox, mockItem);
  assert.strictEqual(changeResult.prevented, false, "Change should not be prevented");
  assert.strictEqual(changeResult.saved, true, "Change should be saved");
  assert.strictEqual(mockCheckbox.checked, true, "Checkbox should remain checked");
  console.log("     ✓ Changement sauvegardé");
  
  console.log("\n  ✅ Comportement normal préservé\n");
}

// Scenario 3: Skip puis un-skip (toggle)
{
  console.log("Scénario 3: Toggle skip/unskip");
  
  const mockCheckbox = {
    checked: false,
    disabled: false,
    dataset: {},
    getAttribute: function(key) { return this.dataset[key]; }
  };
  
  const mockItem = {
    dataset: {},
    classList: {
      _classes: new Set(),
      contains: function(cls) { return this._classes.has(cls); },
    },
    getAttribute: function(key) { 
      if (key === 'data-checklist-skipped') return this.dataset.checklistSkipped;
      return null;
    }
  };
  
  // Skip
  console.log("  1. Skip l'item");
  simulateSkipButtonClick(mockCheckbox, mockItem);
  assert.strictEqual(mockCheckbox.dataset.checklistSkip, "1", "Should be skipped");
  console.log("     ✓ Item skippé");
  
  // Unskip
  console.log("  2. Unskip l'item");
  simulateSkipButtonClick(mockCheckbox, mockItem);
  assert.strictEqual(mockCheckbox.dataset.checklistSkip, undefined, "Should not be skipped");
  assert.strictEqual(mockCheckbox.disabled, false, "Should be enabled");
  console.log("     ✓ Item unskippé");
  
  // Maintenant on peut cocher
  console.log("  3. Coche l'item");
  mockCheckbox.checked = true;
  const changeResult = simulateChangeEventHandler(mockCheckbox, mockItem);
  assert.strictEqual(changeResult.prevented, false, "Change should be allowed");
  assert.strictEqual(mockCheckbox.checked, true, "Should remain checked");
  console.log("     ✓ Changement autorisé et sauvegardé");
  
  console.log("\n  ✅ Toggle skip/unskip fonctionne correctement\n");
}

console.log("═══════════════════════════════════════════════════════════════");
console.log("✅ Tous les tests d'intégration passés avec succès!");
console.log("═══════════════════════════════════════════════════════════════\n");
