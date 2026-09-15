// TikTok favourites remover: rewritten for resilience to TikTok UI changes.
// If it stops working again, update the selector lists in SELECTORS below.

(async () => {
  // ---- Selectors: try each in order. Put the one that works FIRST. ----
  const SELECTORS = {
    profileNav: ['[data-e2e="nav-profile"]', 'a[href^="/@"][data-e2e*="profile"]'],
    favoritesTab: ['[data-e2e="favorites-tab"]', '[class*="PFavorite"]'],
    favoritesTabText: ["favourites", "favorites"], // text fallback for the tab
    firstVideo: [
      '[data-e2e="favorites-item"] a',
      '[data-e2e="user-post-item"] a',
      '[class*="DivPlayerContainer"]',
      'a[href*="/video/"]',
    ],
    favoriteButton: [
      '[data-e2e="favorite-icon"]',
      '[data-e2e="collect-icon"]',
      'button[aria-label*="avorite" i]',
      'button[aria-label*="avourite" i]',
    ],
    nextButton: ['[data-e2e="arrow-right"]', 'button[aria-label*="next" i]'],
    closeButton: ['[data-e2e="browse-close"]', 'button[aria-label*="close" i]'],
  };

  const STEP_DELAY = 2500; // raise this if TikTok rate-limits you
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const find = (list) => {
    for (const sel of list) {
      const el = document.querySelector(sel);
      if (el) return { el, sel };
    }
    return null;
  };

  const waitFor = async (list, timeout = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const hit = find(list);
      if (hit) return hit;
      await sleep(250);
    }
    return null;
  };

  // Show status on the page; DON'T reload, so console logs survive for debugging
  const banner = document.createElement("div");
  banner.style.cssText =
    "position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:999999;" +
    "background:#111;color:#fff;padding:10px 16px;border-radius:8px;font:14px sans-serif";
  document.body.appendChild(banner);
  const status = (msg) => { banner.textContent = `Favourites remover: ${msg}`; console.log("[FavRemover]", msg); };
  const fail = (msg) => { banner.style.background = "#b00020"; status(`STOPPED: ${msg} (see console)`); };

  // 1. Go to profile
  if (!/\/@[^/]+\/?$/.test(location.pathname)) {
    const nav = await waitFor(SELECTORS.profileNav);
    if (!nav) return fail("profile button not found. Are you logged in?");
    status(`clicking profile (${nav.sel})`);
    nav.el.click();
    await sleep(5000);
  }

  // 2. Open Favourites tab
  let tab = await waitFor(SELECTORS.favoritesTab, 8000);
  if (!tab) {
    const el = [...document.querySelectorAll('[role="tab"], p, span, div')]
      .find((n) => n.children.length === 0 &&
        SELECTORS.favoritesTabText.includes(n.textContent.trim().toLowerCase()));
    if (el) tab = { el, sel: "text match" };
  }
  if (!tab) return fail("Favourites tab not found");
  status(`opening Favourites (${tab.sel})`);
  tab.el.click();
  await sleep(5000);

  // 3. Open first favourite video
  const video = await waitFor(SELECTORS.firstVideo);
  if (!video) return fail("no favourite videos found");
  status(`opening first video (${video.sel})`);
  video.el.click();
  await sleep(4000);

  // 4. Unfavourite -> move to next video, one at a time.
  // TikTok now shows videos in a scrolling feed with several loaded at once,
  // so we act on the favourite button of the video nearest the screen centre.
  const icons = () => [...document.querySelectorAll(SELECTORS.favoriteButton.join(","))]
    .filter((el) => el.offsetParent !== null);

  const currentIcon = () => {
    const mid = window.innerHeight / 2;
    return icons().sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return Math.abs((ra.top + ra.bottom) / 2 - mid) - Math.abs((rb.top + rb.bottom) / 2 - mid);
    })[0];
  };

  // Read the favourite count next to the icon, e.g. "1861". Returns null for "1.2K" etc.
  const countOf = (icon) => {
    const box = icon.closest("button, div")?.parentElement ?? icon.parentElement;
    const txt = (box?.querySelector('[data-e2e="favorite-count"]')?.textContent ?? icon.textContent).trim();
    return /^\d+$/.test(txt) ? parseInt(txt, 10) : null;
  };

  let removed = 0;
  let seen = new Set();
  while (true) {
    let icon = currentIcon();
    if (!icon) { await sleep(3000); icon = currentIcon(); }
    if (!icon) return fail(`favourite button not found after ${removed} removed`);
    if (seen.has(icon)) break; // didn't move to a new video: end of list
    seen.add(icon);

    const before = countOf(icon);
    icon.click();
    await sleep(STEP_DELAY);
    const after = countOf(icon);

    if (before !== null && after !== null && after > before) {
      // Count went UP, so this video wasn't favourited and we just added it. Undo.
      icon.click();
      status(`video wasn't favourited, undid click`);
      await sleep(STEP_DELAY);
    } else {
      removed++;
      status(`removed ${removed}`);
    }

    // Move to next video: arrow button if present, otherwise scroll to the next one
    const next = find(SELECTORS.nextButton);
    if (next && !next.el.disabled) {
      next.el.click();
    } else {
      const all = icons();
      const nextIcon = all[all.indexOf(icon) + 1];
      if (nextIcon) {
        nextIcon.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true }));
        window.scrollBy({ top: window.innerHeight, behavior: "smooth" });
      }
    }
    await sleep(STEP_DELAY);
  }

  find(SELECTORS.closeButton)?.el.click();
  banner.style.background = "#1b7f3b";
  status(`done: ${removed} removed. Refresh Favourites to check; run again if any remain.`);
})();
