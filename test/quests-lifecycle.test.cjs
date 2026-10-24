const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "quests.js"), "utf8");

test("renderer script can stop while modules are loading", async () => {
    const pending = [];
    const removed = [];
    const element = tag => ({
        tag,
        classList: { toggle() {}, add() {}, remove() {} },
        style: {},
        dataset: {},
        append() {},
        setAttribute() {},
        addEventListener() {},
        replaceChildren() {},
        remove() { removed.push(tag); }
    });
    const window = { addEventListener() {}, removeEventListener() {} };
    const context = {
        window,
        document: {
            createElement: element,
            createElementNS: (_, tag) => element(tag),
            head: { append() {} },
            body: { append() {} }
        },
        location: { pathname: "/channels/@me" },
        innerWidth: 1280,
        innerHeight: 720,
        navigator: { userAgent: "Linux" },
        console,
        setInterval: () => 1,
        clearInterval() {},
        setTimeout: fn => { pending.push(fn); return pending.length; },
        clearTimeout() {}
    };
    const task = vm.runInNewContext(source, context);
    assert.equal(typeof window.orbs.destroy, "function");
    window.orbs.destroy();
    assert.equal(window.orbs, undefined);
    assert.deepEqual(removed, ["div", "style"]);
    pending.shift()();
    await task;
    assert.equal(window.orbs, undefined);
});
