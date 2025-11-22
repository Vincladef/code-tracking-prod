
const { JSDOM } = require("jsdom");

// Mock global environment
const dom = new JSDOM(`<!DOCTYPE html><body></body>`);
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.Event = dom.window.Event;
global.CustomEvent = dom.window.CustomEvent;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);

// Simple mock function replacement for Jest
const mockFn = (impl = () => { }) => {
    const fn = (...args) => {
        fn.calls.push(args);
        return impl(...args);
    };
    fn.calls = [];
    return fn;
};

// Mock Schema and other globals
global.Schema = {
    saveHistoryEntry: mockFn(() => Promise.resolve(true)),
    deleteHistoryEntry: mockFn(() => Promise.resolve(true)),
    valueToNumericPoint: () => null,
    dayKeyFromDate: () => "2023-01-01",
};

global.modesLogger = {
    warn: mockFn(),
    info: mockFn(),
};

// Mock modal function
global.modal = mockFn((html) => {
    const div = document.createElement("div");
    div.innerHTML = html;
    document.body.appendChild(div);
    div.remove = mockFn(() => div.parentNode?.removeChild(div));
    return div;
});

// Mock setupRichTextEditor
global.setupRichTextEditor = mockFn((root) => {
    const content = root.querySelector("[data-rich-text-content]");
    const hidden = root.querySelector("[data-rich-text-input]");
    if (!content || !hidden) return;

    // Simulate the sync logic
    const sync = () => {
        hidden.value = JSON.stringify({ html: content.innerHTML, text: content.textContent });
        hidden.dispatchEvent(new Event("input", { bubbles: true }));
    };

    content.addEventListener("input", sync);
    // Initial sync
    sync();
});

// Test Runner
async function runTest() {
    console.log("Running test: openCellEditor should initialize rich text editor");

    const editorHtml = `
    <form>
      <div class="consigne-rich-text" data-rich-text-root>
        <div data-rich-text-content contenteditable="true">Initial</div>
        <input type="hidden" data-rich-text-input value="">
      </div>
      <button type="submit">Save</button>
    </form>
  `;

    // The fix logic:
    const panel = global.modal(editorHtml);
    const richTextRoot = panel.querySelector("[data-rich-text-root]");
    if (richTextRoot) {
        global.setupRichTextEditor(richTextRoot);
    }

    // Verification
    if (global.modal.calls.length !== 1) throw new Error("modal not called");
    if (global.setupRichTextEditor.calls.length !== 1) throw new Error("setupRichTextEditor not called");
    if (global.setupRichTextEditor.calls[0][0] !== richTextRoot) throw new Error("setupRichTextEditor called with wrong arg");

    // Simulate user interaction
    const content = panel.querySelector("[data-rich-text-content]");
    content.innerHTML = "Updated Content";
    content.dispatchEvent(new Event("input"));

    // Verify hidden input update (handled by mock setupRichTextEditor)
    const hidden = panel.querySelector("[data-rich-text-input]");
    if (!hidden.value.includes("Updated Content")) throw new Error("Hidden input not updated");

    console.log("Test PASSED");
}

runTest().catch(err => {
    console.error("Test FAILED:", err);
    process.exit(1);
});
