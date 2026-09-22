const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const original = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
const source = original.replace(
  /\}\)\(\);\s*$/,
  "globalThis.__test = { parseKeywords, matchesKeywords, openFavoritesTab, extractFavoriteItemsFromDom, getExpectedFavoriteCount, updatePanel, collectAllFavoriteItems, buildReport, sanitizeCsvCell }; })();"
);

function load(documentImpl, windowImpl = {}) {
  const window = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    scrollTo() {},
    scrollY: 0,
    ...windowImpl,
  };
  const context = vm.createContext({
    chrome: { runtime: { sendMessage() {}, onMessage: { addListener() {} }, getManifest() { return { version: "test" }; } } },
    URLSearchParams,
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    window,
    console,
    setTimeout,
    clearTimeout,
    Promise,
    document: documentImpl || {
      querySelector() { return null; },
      querySelectorAll() { return []; },
      documentElement: { scrollHeight: 0 },
      body: { scrollHeight: 0 },
    },
  });
  vm.runInContext(source, context, { filename: "script.js" });
  return { api: context.__test, window };
}

async function testFavoritesTabSelection() {
  let selected = false;
  let clicks = 0;
  const tab = {
    getAttribute(name) { return name === "aria-selected" ? String(selected) : null; },
    click() { clicks += 1; selected = true; },
  };
  const { api } = load({
    querySelector(selector) { return selector === '[role="tab"][class*="PFavorite"]' ? tab : null; },
    querySelectorAll() { return []; },
    documentElement: { scrollHeight: 0 },
    body: { scrollHeight: 0 },
  });
  const result = await api.openFavoritesTab(1000);
  assert.deepEqual({ found: result.found, selected: result.selected }, { found: true, selected: true });
  assert.equal(clicks, 1);
}

async function testFinishedPanelHidesRunControls() {
  const { api } = load();
  const elements = {
    "#tfr-status": { textContent: "" },
    "#tfr-stats": { textContent: "" },
    "#tfr-pause-btn": { textContent: "", disabled: false, hidden: false, classList: { toggle() {} } },
    "#tfr-confirm-btn": { textContent: "", disabled: false, hidden: true },
    "#tfr-stop-btn": { textContent: "", disabled: false, hidden: false },
    "#tfr-download-btn": { textContent: "", disabled: true },
  };
  const panel = { querySelector(selector) { return elements[selector] || null; } };
  api.updatePanel(panel, { status: "Done", pages: 1, failed: 0, totalListed: 8, matched: 8, paused: false, finished: true, cancelled: false, reportReady: true }, {});
  assert.equal(elements["#tfr-pause-btn"].hidden, true);
  assert.equal(elements["#tfr-stop-btn"].hidden, true);
  assert.equal(elements["#tfr-download-btn"].disabled, false);
}

function makeLink(id, description) {
  return {
    href: `https://www.tiktok.com/@creator/video/${id}?lang=en`,
    getAttribute(name) { return name === "href" ? this.href : null; },
    querySelector(selector) {
      return selector === "img" ? { getAttribute(name) { return name === "alt" ? description : null; } } : null;
    },
  };
}

async function testCompleteProgressiveGridCollection() {
  let stage = 0;
  const events = [];
  const pages = [
    [makeLink("1", "one"), makeLink("2", "two")],
    [makeLink("1", "one"), makeLink("2", "two"), makeLink("3", "three")],
  ];
  const documentImpl = {
    querySelector(selector) {
      if (selector === "#posts") return { get textContent() { return stage === 0 ? "Posts 0" : "Posts 3"; }, getAttribute() { return "true"; }, click() {} };
      return null;
    },
    querySelectorAll(selector) {
      assert.match(selector, /favorites-item/);
      return pages[stage];
    },
    documentElement: { get scrollHeight() { return 1000 + stage * 1000; } },
    body: { get scrollHeight() { return 1000 + stage * 1000; } },
  };
  const windowImpl = {
    scrollY: 120,
    scrollTo(x, y) { events.push(`scroll:${y}`); if (y >= 1000) stage = 1; },
  };
  const { api } = load(documentImpl, windowImpl);
  const result = await api.collectAllFavoriteItems("sec-test", {
    pagePauseMs: 0,
    diagnostics: [],
    async onPage({ page }) { events.push(`process:${page}`); },
  });
  assert.deepEqual(Array.from(result.items, (item) => item.id), ["1", "2", "3"]);
  assert.equal(result.pages, 2);
  assert.equal(result.items[0].authorName, "@creator");
  assert.ok(events.indexOf("process:1") < events.indexOf("scroll:1000"));
}

function testFavoriteCountFormats() {
  let countText = "Posts 1,234";
  const { api } = load({
    querySelector(selector) { return selector === "#posts" ? { get textContent() { return countText; } } : null; },
    querySelectorAll() { return []; },
    documentElement: { scrollHeight: 0 },
    body: { scrollHeight: 0 },
  });
  assert.equal(api.getExpectedFavoriteCount(), 1234);
  countText = "Posts 1.2K";
  assert.equal(api.getExpectedFavoriteCount(), 1150);
  countText = "Posts 2M";
  assert.equal(api.getExpectedFavoriteCount(), 1500000);
}

async function testIncompleteGridCannotBeVerified() {
  const documentImpl = {
    querySelector(selector) {
      return selector === "#posts" ? { textContent: "Posts 8", getAttribute() { return "true"; } } : null;
    },
    querySelectorAll() { return [makeLink("1", "one")]; },
    documentElement: { scrollHeight: 1000 },
    body: { scrollHeight: 1000 },
  };
  const { api } = load(documentImpl);
  await assert.rejects(api.collectAllFavoriteItems("sec-test"), (error) => {
    assert.equal(error.code, "INCOMPLETE_GRID");
    assert.equal(error.loaded, 1);
    assert.equal(error.expected, 8);
    return true;
  });
}

async function testCsvFormulaProtectionAndSingleStatus() {
  const { api } = load();
  const item = { id: "1", authorName: "@a", desc: "=SUM(A1:A2)", url: "https://example.test/1" };
  const csv = api.buildReport({
    reportScannedItems: [item], reportItems: [item], reportFailedItems: [], reportVerifiedItems: [item], reportStillPresentItems: [], diagnostics: {}, totalListed: 1,
  }, { dryRun: false }, "csv");
  assert.match(csv, /"'=SUM\(A1:A2\)"/);
  assert.equal((csv.match(/verified_removed/g) || []).length, 1);
}

(async () => {
  await testFavoritesTabSelection();
  await testFinishedPanelHidesRunControls();
  await testCompleteProgressiveGridCollection();
  testFavoriteCountFormats();
  await testIncompleteGridCannotBeVerified();
  await testCsvFormulaProtectionAndSingleStatus();
  console.log("script tests: ok");
})().catch((error) => { console.error(error); process.exitCode = 1; });
