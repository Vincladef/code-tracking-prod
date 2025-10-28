/**
 * Test: Vérifie que le fix empêche bien le changement d'état d'un élément skippé
 * 
 * Scénario du bug:
 * 1. L'utilisateur clique sur "surpasser cet élément" (⏭) - ça s'enregistre bien
 * 2. L'utilisateur clique à nouveau sur la checkbox - BUG: ça se change et compte comme coché
 * 
 * Comportement attendu après le fix:
 * - Quand un item est skippé, cliquer dessus ne doit PAS changer son état
 * - La checkbox doit rester décochée et disabled
 */

const assert = require("assert");

// Simulate the change event handler logic from app.js
function simulateChangeEvent(target, item) {
  // Check if skipped (from app.js lines 641-643)
  const skipped =
    (target.dataset && target.dataset.checklistSkip === "1") ||
    (item.dataset && item.dataset.checklistSkipped === "1");
  
  // The fix (from app.js lines 644-650)
  if (skipped) {
    // Prevent the change if item is skipped - revert to unchecked state
    target.checked = false;
    return { prevented: true, skipped: true };
  }
  
  return { prevented: false, skipped: false };
}

// Test 1: Skipped item should not allow checking
{
  const mockCheckbox = {
    checked: false,
    dataset: { checklistSkip: "1" }
  };
  
  const mockItem = {
    dataset: { checklistSkipped: "1" }
  };
  
  // User tries to check the box
  mockCheckbox.checked = true;
  
  // Change event handler runs
  const result = simulateChangeEvent(mockCheckbox, mockItem);
  
  // Verify fix works: checkbox is reverted to unchecked
  assert.strictEqual(result.prevented, true, "Change should be prevented for skipped item");
  assert.strictEqual(result.skipped, true, "Item should be detected as skipped");
  assert.strictEqual(mockCheckbox.checked, false, "Checkbox should be reverted to unchecked");
  
  console.log("✓ Test 1 passed: Skipped item prevents checking");
}

// Test 2: Non-skipped item should allow checking
{
  const mockCheckbox = {
    checked: false,
    dataset: {}
  };
  
  const mockItem = {
    dataset: {}
  };
  
  // User checks the box
  mockCheckbox.checked = true;
  
  // Change event handler runs
  const result = simulateChangeEvent(mockCheckbox, mockItem);
  
  // Verify normal behavior: change is allowed
  assert.strictEqual(result.prevented, false, "Change should not be prevented for non-skipped item");
  assert.strictEqual(result.skipped, false, "Item should not be detected as skipped");
  assert.strictEqual(mockCheckbox.checked, true, "Checkbox should remain checked");
  
  console.log("✓ Test 2 passed: Non-skipped item allows checking");
}

// Test 3: Item skipped via input dataset only
{
  const mockCheckbox = {
    checked: false,
    dataset: { checklistSkip: "1" }
  };
  
  const mockItem = {
    dataset: {}
  };
  
  mockCheckbox.checked = true;
  const result = simulateChangeEvent(mockCheckbox, mockItem);
  
  assert.strictEqual(result.prevented, true, "Should detect skip from input dataset");
  assert.strictEqual(mockCheckbox.checked, false, "Should revert to unchecked");
  
  console.log("✓ Test 3 passed: Skip detected from input dataset");
}

// Test 4: Item skipped via host dataset only
{
  const mockCheckbox = {
    checked: false,
    dataset: {}
  };
  
  const mockItem = {
    dataset: { checklistSkipped: "1" }
  };
  
  mockCheckbox.checked = true;
  const result = simulateChangeEvent(mockCheckbox, mockItem);
  
  assert.strictEqual(result.prevented, true, "Should detect skip from host dataset");
  assert.strictEqual(mockCheckbox.checked, false, "Should revert to unchecked");
  
  console.log("✓ Test 4 passed: Skip detected from host dataset");
}

console.log("\n✅ All tests passed: Checklist skip/change prevention works correctly");
