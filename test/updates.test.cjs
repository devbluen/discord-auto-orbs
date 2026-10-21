const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { isNewer, currentVersion } = require("../src/updates.cjs");

test("compares release tags numerically", () => {
    assert.equal(isNewer("1.0.1", "1.0.0"), true);
    assert.equal(isNewer("v1.10.0", "1.9.9"), true);
    assert.equal(isNewer("1.0.0", "1.0.0"), false);
    assert.equal(isNewer("1.0.0", "1.2.0"), false);
    assert.equal(isNewer("2.0", "1.9.9"), true);
});

test("reads the version from package.json when running from source", () => {
    const pkg = require("../package.json");
    assert.equal(currentVersion(path.join(__dirname, "..", "src")), pkg.version);
});
