const assert = require("assert");

const listeners = new Map();

function ensureListenerSet(type) {
  if (!listeners.has(type)) {
    listeners.set(type, new Set());
  }
  return listeners.get(type);
}

global.CustomEvent =
  global.CustomEvent ||
  function CustomEvent(type, params = {}) {
    this.type = type;
    this.detail = params.detail || null;
    this.cancelable = Boolean(params.cancelable);
    this.defaultPrevented = false;
    this.preventDefault = () => {
      if (this.cancelable) {
        this.defaultPrevented = true;
      }
    };
  };

global.document = global.document || {};
Object.assign(global.document, {
  createElement(tag) {
    return {
      tagName: String(tag).toUpperCase(),
      style: {},
      className: "",
      innerHTML: "",
      appendChild: () => {},
      remove: () => {},
      querySelector: () => null,
      querySelectorAll: () => [],
      setAttribute: () => {},
      removeAttribute: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  },
  documentElement: {
    style: {
      setProperty: () => {},
      getPropertyValue: () => "",
    },
  },
  body: {
    appendChild: () => {},
    removeChild: () => {},
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener(type, handler) {
    ensureListenerSet(type).add(handler);
  },
  removeEventListener(type, handler) {
    ensureListenerSet(type).delete(handler);
  },
  dispatchEvent(event) {
    const handlers = Array.from(ensureListenerSet(event.type));
    handlers.forEach((handler) => {
      try {
        handler(event);
      } catch (error) {
        console.warn("dispatchEvent handler error", error);
      }
    });
    return !event.defaultPrevented;
  },
});

global.window = global.window || {};
global.window.CSS = global.window.CSS || { escape: (value) => String(value) };
global.window.visualViewport = global.window.visualViewport || null;
global.window.innerHeight = global.window.innerHeight || 900;
global.window.innerWidth = global.window.innerWidth || 1280;
global.window.requestAnimationFrame =
  global.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
global.window.cancelAnimationFrame =
  global.window.cancelAnimationFrame || ((id) => clearTimeout(id));
global.window.Modes = global.window.Modes || {};
global.Modes = global.window.Modes;
global.Schema = global.Schema || {};
global.Schema.firestore = global.Schema.firestore || {};

const ModesModule = require("../modes.js");
const dispatchConsigneMutation =
  ModesModule.__test__ && ModesModule.__test__.dispatchConsigneMutation;

assert.ok(
  typeof dispatchConsigneMutation === "function",
  "dispatchConsigneMutation doit être exposée pour les tests",
);

(function testFallbackWhenNotIntercepted() {
  let fallbackCalls = 0;
  const event = dispatchConsigneMutation({
    mode: "practice",
    action: "create",
    consigneId: "consigne-1",
    consigne: { id: "consigne-1", text: "Nouvelle consigne" },
    fallback: () => {
      fallbackCalls += 1;
    },
  });
  assert.strictEqual(fallbackCalls, 1, "Le fallback doit être appelé si l'évènement n'est pas intercepté");
  assert.strictEqual(event.defaultPrevented, false, "L'évènement ne doit pas être marqué comme preventDefault");
  assert.deepStrictEqual(
    event.detail,
    {
      mode: "practice",
      action: "create",
      consigneId: "consigne-1",
      consigne: { id: "consigne-1", text: "Nouvelle consigne" },
    },
    "Le payload detail doit refléter la mutation transmise",
  );
})();

(function testPreventDefaultStopsFallback() {
  let fallbackCalls = 0;
  let intercepted = 0;

  const handler = (event) => {
    intercepted += 1;
    event.preventDefault();
  };

  document.addEventListener("consigne:mutated", handler);

  const event = dispatchConsigneMutation({
    mode: "daily",
    action: "update",
    consigneId: "consigne-2",
    consigne: { id: "consigne-2", text: "Consigne existante" },
    fallback: () => {
      fallbackCalls += 1;
    },
  });

  document.removeEventListener("consigne:mutated", handler);

  assert.strictEqual(intercepted, 1, "Le listener enregistré doit être invoqué");
  assert.strictEqual(fallbackCalls, 0, "Le fallback ne doit pas être appelé lorsque preventDefault est utilisé");
  assert.strictEqual(event.defaultPrevented, true, "L'évènement doit être marqué comme empêché");
})();

console.log("consigne mutation event tests passed.");

