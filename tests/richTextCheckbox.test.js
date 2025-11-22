const assert = require("assert");

// Mock DOM environment (simplified for this test)
global.document = {
    createElement: (tag) => {
        const el = {
            tagName: tag.toUpperCase(),
            style: {},
            classList: {
                add: () => { },
                remove: () => { },
                toggle: () => { },
                contains: () => false,
            },
            getAttribute: (name) => el.attributes?.[name] || null,
            setAttribute: (name, val) => { el.attributes = el.attributes || {}; el.attributes[name] = val; },
            removeAttribute: (name) => { if (el.attributes) delete el.attributes[name]; },
            appendChild: (child) => { el.children = el.children || []; el.children.push(child); child.parentNode = el; },
            insertBefore: () => { },
            addEventListener: (type, handler) => {
                el.listeners = el.listeners || {};
                el.listeners[type] = el.listeners[type] || [];
                el.listeners[type].push(handler);
            },
            removeEventListener: () => { },
            querySelector: (sel) => {
                if (sel === '[data-rich-text-content]') return el.children?.find(c => c.tagName === 'DIV'); // simplistic
                if (sel === 'input[type="checkbox"]') return el.children?.find(c => c.tagName === 'INPUT'); // simplistic
                return null;
            },
            querySelectorAll: (sel) => {
                if (sel === 'input[type="checkbox"]') {
                    // simplistic recursive search
                    const findInputs = (node) => {
                        let res = [];
                        if (node.tagName === 'INPUT') res.push(node);
                        if (node.children) node.children.forEach(c => res = res.concat(findInputs(c)));
                        return res;
                    };
                    return findInputs(el);
                }
                return [];
            },
            closest: () => null,
            contains: () => false,
            dispatchEvent: (event) => {
                if (el.listeners?.[event.type]) {
                    el.listeners[event.type].forEach(h => h(event));
                }
            }
        };
        return el;
    },
    createRange: () => ({
        setStart: () => { },
        setEnd: () => { },
        collapse: () => { },
        selectNodeContents: () => { },
        cloneRange: () => ({}),
    }),
    getSelection: () => ({
        rangeCount: 0,
        getRangeAt: () => null,
        removeAllRanges: () => { },
        addRange: () => { },
    }),
    execCommand: () => { },
    queryCommandState: () => false,
};

global.window = {
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Modes: {
        richText: {}
    }
};

global.Node = {
    ELEMENT_NODE: 1,
    TEXT_NODE: 3,
};

async function testCheckboxUpdate() {
    console.log("Starting checkbox test...");

    const root = document.createElement("div");
    const content = document.createElement("div");
    content.tagName = "DIV"; // Ensure tagName is set
    content.setAttribute("data-rich-text-content", "true");
    content.innerHTML = "<p>Text</p>";

    const hidden = document.createElement("input");
    hidden.tagName = "INPUT";
    hidden.setAttribute("data-rich-text-input", "true");
    hidden.value = JSON.stringify({ html: "<p>Text</p>", text: "Text", checkboxes: [] });

    const toolbar = document.createElement("div");

    root.appendChild(toolbar);
    root.appendChild(content);
    root.appendChild(hidden);

    // Mock sync function
    const sync = () => {
        const boxes = content.querySelectorAll('input[type="checkbox"]');
        const boxStates = boxes.map(b => b.checked);

        hidden.value = JSON.stringify({
            html: content.innerHTML,
            text: "Text", // Simplified
            checkboxes: boxStates
        });
        console.log("Sync called. Checkboxes:", boxStates);
    };

    const raf = (cb) => setTimeout(cb, 10);
    let pending = null;
    const schedule = () => {
        if (pending) clearTimeout(pending);
        pending = raf(() => {
            pending = null;
            sync();
        });
    };

    // Current listeners (from previous fix)
    content.addEventListener("input", schedule);
    // MISSING: content.addEventListener("change", schedule);

    // Simulate adding a checkbox (this triggers input usually, but let's say it's done via command)
    console.log("Adding checkbox...");
    const checkbox = document.createElement("input");
    checkbox.tagName = "INPUT";
    checkbox.setAttribute("type", "checkbox");
    content.appendChild(checkbox);

    // If added via innerHTML or command, 'input' might fire. 
    // But toggling it fires 'change'.

    console.log("Toggling checkbox...");
    checkbox.checked = true;

    // Dispatch 'change' event (which happens when user clicks)
    const changeEvent = { type: "change", target: checkbox, bubbles: true };

    // Simulate bubbling: if content has listener, it fires.
    if (content.listeners?.["change"]) {
        content.listeners["change"].forEach(h => h(changeEvent));
    } else {
        console.log("No 'change' listener on content!");
    }

    // Wait
    await new Promise(resolve => setTimeout(resolve, 50));

    const newValue = JSON.parse(hidden.value);
    if (newValue.checkboxes && newValue.checkboxes[0] === true) {
        console.log("SUCCESS: Checkbox state saved.");
    } else {
        console.error("FAILURE: Checkbox state NOT saved.");
    }

    // Now apply fix
    console.log("Applying fix: adding 'change' listener...");
    content.addEventListener("change", schedule);

    // Toggle again
    checkbox.checked = false;
    if (content.listeners?.["change"]) {
        content.listeners["change"].forEach(h => h(changeEvent));
    }

    await new Promise(resolve => setTimeout(resolve, 50));

    const fixedValue = JSON.parse(hidden.value);
    if (fixedValue.checkboxes && fixedValue.checkboxes[0] === false) {
        console.log("SUCCESS: Checkbox state saved after fix.");
    } else {
        console.error("FAILURE: Checkbox state NOT saved even after fix.");
    }
}

testCheckboxUpdate();
