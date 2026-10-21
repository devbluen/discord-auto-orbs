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
        classList: { toggle() {} },
        style: {},
        dataset: {},
        append() {},
        addEventListener() {},
        replaceChildren() {},
        remove() { removed.push(tag); }
    });
    const window = {};
    const context = {
        window,
        document: {
            createElement: element,
            head: { append() {} },
            body: { append() {} }
        },
        location: { pathname: "/channels/@me" },
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
