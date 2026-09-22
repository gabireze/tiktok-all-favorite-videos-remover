(function () {
  "use strict";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function openFavoritesTab(timeoutMs = 6000) {
    const deadline = Date.now() + timeoutMs;
    const selectors = [
      '[data-e2e="favorite-tab"]',
      '[data-e2e="favorites-tab"]',
      '[role="tab"][data-e2e*="favorite" i]',
      '[role="tab"][class*="PFavorite"]',
      '[class*="PFavorite"]',
    ];
    let found = false;
    while (Date.now() < deadline) {
      const tab = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
      if (tab) {
        found = true;
        if (tab.getAttribute("aria-selected") !== "true") tab.click();
        for (let attempt = 0; attempt < 10; attempt++) {
          const current = selectors.map((selector) => document.querySelector(selector)).find(Boolean) || tab;
          const gridVisible = !!document.querySelector('[data-e2e="favorites-item-list"], [data-e2e="favorites-item"], #posts');
          if (current.getAttribute("aria-selected") === "true" || gridVisible) return { found: true, selected: true };
          await sleep(200);
        }
      }
      await sleep(400);
    }
    return { found, selected: false };
  }

  function getFavoriteContextAsync() {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage({ action: "getFavoriteContext" }, function (response) {
        resolve(response || {});
      });
    });
  }

  function extractFavoriteItemsFromDom() {
    const links = document.querySelectorAll('[data-e2e="favorites-item"] a[href*="/video/"], [data-e2e="favorites-item"] a[href*="/photo/"]');
    return Array.from(links).map((link) => {
      const href = link.href || link.getAttribute("href") || "";
      const match = href.match(/\/@([^/]+)\/(?:video|photo)\/(\d+)/i);
      if (!match) return null;
      const image = link.querySelector("img");
      return {
        id: match[2],
        authorName: `@${decodeURIComponent(match[1])}`,
        desc: (image && image.getAttribute("alt")) || link.getAttribute("aria-label") || "",
        url: href.split("?")[0],
      };
    }).filter(Boolean);
  }

  function getExpectedFavoriteCount() {
    const postsButton = document.querySelector("#posts");
    const match = postsButton && (postsButton.textContent || "").match(/(\d[\d.,]*)/);
    return match ? Number(match[1].replace(/[^\d]/g, "")) : null;
  }

  async function refreshFavoritesGrid() {
    window.scrollTo(0, 0);
    const videosTab = document.querySelector('[data-e2e="videos-tab"]');
    if (videosTab) {
      videosTab.click();
      await cancellableSleep(700);
    }
    const result = await openFavoritesTab(5000);
    const postsButton = document.querySelector("#posts");
    if (postsButton && postsButton.getAttribute("aria-selected") !== "true") postsButton.click();
    await cancellableSleep(900);
    return result;
  }

  let pageRemoveScriptInjected = false;
  function ensurePageRemoveScript() {
    if (pageRemoveScriptInjected) return Promise.resolve();
    pageRemoveScriptInjected = true;
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage({ action: "injectPageRemoveListener" }, function (response) {
        if (response && response.ok) resolve();
        else {
          pageRemoveScriptInjected = false;
          reject(new Error((response && response.error) || "inject failed"));
        }
      });
    });
  }

  function removeFavoriteItemInPage(itemId) {
    return ensurePageRemoveScript().then(function () {
      return new Promise(function (resolve, reject) {
        const timeoutId = setTimeout(function () {
          window.removeEventListener("tfr-remove-favorite-result", handler);
          const error = new Error("Removal request timed out after 30 seconds");
          error.code = "TIMEOUT";
          reject(error);
        }, 30000);
        const handler = function (event) {
          if (!event.detail || event.detail.itemId !== itemId) return;
          clearTimeout(timeoutId);
          window.removeEventListener("tfr-remove-favorite-result", handler);
          if (event.detail.success) {
            resolve({ success: true, httpStatus: event.detail.httpStatus || null });
          } else {
            const error = new Error(event.detail.error || "Remove failed");
            error.code = event.detail.errorCode || "REMOVE_FAILED";
            error.httpStatus = event.detail.httpStatus || null;
            reject(error);
          }
        };
        window.addEventListener("tfr-remove-favorite-result", handler);
        window.dispatchEvent(new CustomEvent("tfr-remove-favorite", { detail: { itemId } }));
      });
    });
  }

  function cancelActiveRemoval() {
    window.dispatchEvent(new CustomEvent("tfr-cancel-remove"));
  }

  async function waitUntilRunnable() {
    while (panelState.paused && !panelState.cancelled) await sleep(150);
    return !panelState.cancelled;
  }

  async function cancellableSleep(ms) {
    const deadline = Date.now() + Math.max(0, ms);
    while (Date.now() < deadline) {
      if (!(await waitUntilRunnable())) return false;
      await sleep(Math.min(150, Math.max(0, deadline - Date.now())));
    }
    return !panelState.cancelled;
  }

  function isRetryableRemovalError(error) {
    if (!error) return false;
    if (error.code === "NETWORK_ERROR" || error.code === "TIMEOUT") return true;
    return error.code === "HTTP_ERROR" && Number(error.httpStatus) >= 500;
  }

  async function removeFavoriteWithRetry(item, maxAttempts = 3) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (!(await waitUntilRunnable())) {
        const cancelled = new Error("Cancelled");
        cancelled.code = "CANCELLED";
        throw cancelled;
      }
      try {
        const result = await removeFavoriteItemInPage(item.id);
        return { ...result, attempts: attempt };
      } catch (error) {
        lastError = error;
        if (error.code === "CANCELLED" || !isRetryableRemovalError(error) || attempt === maxAttempts) throw error;
        const backoffMs = 1000 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 500);
        if (!(await cancellableSleep(backoffMs))) {
          const cancelled = new Error("Cancelled");
          cancelled.code = "CANCELLED";
          throw cancelled;
        }
      }
    }
    throw lastError;
  }

  async function collectAllFavoriteItems(secUid, options = {}) {
    if (!secUid) {
      const error = new Error("Missing account identifier");
      error.code = "MISSING_ACCOUNT_ID";
      throw error;
    }
    const diagnostics = options.diagnostics || [];
    const loadPauseMs = Math.max(600, Math.min(Number(options.pagePauseMs) || 800, 2000));
    const originalScrollY = window.scrollY || 0;
    const itemsById = new Map();
    let stableCycles = 0;
    let previousCount = -1;
    let previousHeight = -1;
    let page = 0;

    if (options.refresh) await refreshFavoritesGrid();
    const postsButton = document.querySelector("#posts");
    if (postsButton && postsButton.getAttribute("aria-selected") !== "true") {
      postsButton.click();
      if (!(await cancellableSleep(700))) {
        const error = new Error("Cancelled");
        error.code = "CANCELLED";
        throw error;
      }
    }

    for (let cycle = 1; cycle <= 300; cycle++) {
      if (!(await waitUntilRunnable())) {
        const cancelled = new Error("Cancelled");
        cancelled.code = "CANCELLED";
        throw cancelled;
      }

      page = cycle;
      const currentItems = extractFavoriteItemsFromDom();
      const uniqueItems = [];
      currentItems.forEach((item) => {
        if (!item.id || itemsById.has(item.id)) return;
        itemsById.set(item.id, item);
        uniqueItems.push(item);
      });
      const expectedCount = getExpectedFavoriteCount();
      const scrollHeight = Math.max(document.documentElement.scrollHeight || 0, document.body ? document.body.scrollHeight || 0 : 0);
      diagnostics.push({ page: cycle, itemCount: itemsById.size, expectedCount, scrollHeight });
      if (options.onPage) {
        await options.onPage({ page: cycle, uniqueItems, total: itemsById.size, result: { expectedCount } });
      }

      // TikTok briefly renders "Posts 0" while the Favorites grid is still loading.
      // Treat only a positive count as authoritative; a genuinely empty grid is
      // confirmed by the stability check below after several loading cycles.
      if (!options.ignoreExpectedCount && expectedCount !== null && expectedCount > 0 && itemsById.size >= expectedCount) break;
      if (itemsById.size === previousCount && scrollHeight === previousHeight) stableCycles++;
      else stableCycles = 0;
      if (stableCycles >= 4) break;
      previousCount = itemsById.size;
      previousHeight = scrollHeight;

      window.scrollTo(0, scrollHeight);
      if (!(await cancellableSleep(loadPauseMs))) {
        const cancelled = new Error("Cancelled");
        cancelled.code = "CANCELLED";
        throw cancelled;
      }
    }
    window.scrollTo(0, originalScrollY);
    return { items: Array.from(itemsById.values()), pages: page, diagnostics };
  }

  function parseKeywords(str) {
    if (!str || !String(str).trim()) return [];
    return String(str)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.toLowerCase());
  }

  function matchesKeywords(desc, keywordList) {
    if (keywordList.length === 0) return true;
    const text = (desc || "").toLowerCase();
    return keywordList.some((k) => text.includes(k));
  }

  function randomDelayMs(config) {
    if (config.requestIntervalMode === "set") {
      const arr = config.requestIntervalSet || [1, 3, 5];
      const v = arr[Math.floor(Math.random() * arr.length)] ?? 1;
      return Math.max(0, v) * 1000;
    }
    const { min = 1, max = 3 } = config.requestIntervalRange || {};
    const a = Math.max(0, min);
    const b = Math.max(a, max);
    const sec = a + Math.random() * (b - a);
    return sec * 1000;
  }

  function createInPagePanel(i18n) {
    const t = i18n || {};
    const id = "tiktok-favorites-remover-panel";
    if (document.getElementById(id)) return document.getElementById(id);

    const panel = document.createElement("div");
    panel.id = id;
    panel.innerHTML = `
      <div class="tfr-header">
        <span class="tfr-title">${t.panelTitle || "TikTok Favorites Remover"}</span>
        <button type="button" class="tfr-close" aria-label="${t.panelClose || "Close"}">×</button>
      </div>
      <div class="tfr-status" id="tfr-status">${t.statusPreparing || "Preparing…"}</div>
      <div class="tfr-stats" id="tfr-stats"></div>
      <div class="tfr-actions">
        <button type="button" class="tfr-btn tfr-confirm" id="tfr-confirm-btn" hidden>${t.btnConfirmRemoval || "Confirm removal"}</button>
        <button type="button" class="tfr-btn tfr-pause" id="tfr-pause-btn">${t.btnPause || "Pause"}</button>
        <button type="button" class="tfr-btn tfr-stop" id="tfr-stop-btn">${t.btnStop || "Stop"}</button>
        <button type="button" class="tfr-btn tfr-download" id="tfr-download-btn" disabled>${t.btnDownloadReport || "Download report"}</button>
      </div>
    `;

    Object.assign(panel.style, {
      position: "fixed",
      top: "16px",
      right: "16px",
      width: "320px",
      maxWidth: "calc(100vw - 32px)",
      background: "#0d0d0d",
      border: "1px solid #2a2a2a",
      borderRadius: "12px",
      boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
      zIndex: "2147483647",
      fontFamily: "system-ui, -apple-system, sans-serif",
      fontSize: "13px",
      color: "#f2f2f2",
      overflow: "hidden",
      animation: "tfr-slideIn 0.35s ease-out",
    });

    const sheet = document.createElement("style");
    sheet.textContent = `
      @keyframes tfr-slideIn {
        from { opacity: 0; transform: translateX(24px); }
        to { opacity: 1; transform: translateX(0); }
      }
      #tiktok-favorites-remover-panel {
        border-left: 3px solid #00f2ea;
      }
      .tfr-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; background: #161616; border-bottom: 1px solid #2a2a2a; cursor: move; user-select: none; -webkit-user-select: none; }
      .tfr-title { font-weight: 600; font-size: 13px; color: #00f2ea; letter-spacing: -0.02em; }
      .tfr-close { background: none; border: none; color: #888; cursor: pointer; font-size: 20px; line-height: 1; padding: 0 2px; flex-shrink: 0; transition: color 0.2s; }
      .tfr-close:hover { color: #fff; }
      .tfr-status { padding: 12px 14px; min-height: 20px; font-size: 13px; line-height: 1.4; color: #e0e0e0; }
      .tfr-stats { padding: 0 14px 10px; color: #888; font-size: 12px; }
      .tfr-actions { display: flex; gap: 8px; padding: 12px 14px; border-top: 1px solid #2a2a2a; }
      .tfr-btn { padding: 9px 14px; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 500; transition: opacity 0.2s, background 0.2s; }
      .tfr-pause { background: #ff0050; color: #fff; }
      .tfr-pause:hover { background: #ff1a5c; }
      .tfr-pause.resumed { background: #00f2ea; color: #0d0d0d; }
      .tfr-pause.resumed:hover { background: #33f5ed; }
      .tfr-confirm { background: #ff0050; color: #fff; flex: 1; }
      .tfr-confirm:hover:not(:disabled) { background: #ff1a5c; }
      .tfr-stop { background: #3a1f28; color: #ff9bb8; border: 1px solid #673142; }
      .tfr-stop:hover:not(:disabled) { background: #4a2532; }
      .tfr-download { background: #1c1c1c; color: #f2f2f2; border: 1px solid #2a2a2a; }
      .tfr-download:hover:not(:disabled) { background: #252525; }
      .tfr-download:disabled { opacity: 0.5; cursor: not-allowed; }
    `;
    (document.head || document.documentElement).appendChild(sheet);

    // Anexa ao <html> para o React do TikTok não remover o painel ao re-renderizar o body
    var root = document.documentElement;
    if (!root && document.body) {
      root = document.body;
    }
    if (root) {
      root.appendChild(panel);
    }

    const drag = (el) => {
      const header = el.querySelector(".tfr-header");
      if (!header) return;

      let startX = 0;
      let startY = 0;
      let startTop = 0;
      let startLeft = 0;

      header.onmousedown = (e) => {
        e.preventDefault();

        const rect = el.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        startTop = rect.top + window.scrollY;
        startLeft = rect.left + window.scrollX;

        // Fixar em top/left a partir do primeiro arraste
        el.style.top = startTop + "px";
        el.style.left = startLeft + "px";
        el.style.right = "auto";

        const onMouseMove = (ev) => {
          ev.preventDefault();
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          const nextTop = Math.max(0, startTop + dy);
          const nextLeft = Math.max(0, startLeft + dx);
          el.style.top = nextTop + "px";
          el.style.left = nextLeft + "px";
        };

        const onMouseUp = () => {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      };
    };
    drag(panel);

    return panel;
  }

  function substitutePlaceholders(str, vals) {
    if (!str || !vals) return str || "";
    let s = str;
      vals.forEach((v, i) => { s = s.replace(new RegExp("\\$" + (i + 1) + "\\$", "g"), String(v)); });
    return s;
  }

  function updatePanel(panel, state, i18n) {
    const t = i18n || {};
    const statusEl = panel.querySelector("#tfr-status");
    const statsEl = panel.querySelector("#tfr-stats");
    const pauseBtn = panel.querySelector("#tfr-pause-btn");
    const confirmBtn = panel.querySelector("#tfr-confirm-btn");
    const stopBtn = panel.querySelector("#tfr-stop-btn");
    const downloadBtn = panel.querySelector("#tfr-download-btn");

    if (statusEl) statusEl.textContent = state.status || "—";
    if (statsEl) {
      const parts = [];
      if (state.pages != null) parts.push(`${t.statsPages || "Pages"}: ${state.pages}`);
      if (state.processed != null && state.processed > 0) parts.push(`${t.statsProcessed || "Processed"}: ${state.processed}`);
      if (state.failed != null && state.failed > 0) parts.push(`${t.statsFailed || "Failed"}: ${state.failed}`);
      if (state.totalListed != null) parts.push(`${t.statsListed || "Listed"}: ${state.totalListed}`);
      if (state.matched != null) parts.push(`${t.statsMatched || "Matched"}: ${state.matched}`);
      if (state.verifiedRemoved != null) parts.push(`${t.statsVerified || "Verified"}: ${state.verifiedRemoved}`);
      if (state.stillPresent != null && state.stillPresent > 0) parts.push(`${t.statsRemaining || "Remaining"}: ${state.stillPresent}`);
      statsEl.textContent = parts.length ? parts.join(" · ") : "";
    }
    if (pauseBtn) {
      pauseBtn.textContent = state.paused ? (t.btnResume || "Resume") : (t.btnPause || "Pause");
      pauseBtn.classList.toggle("resumed", !!state.paused);
      pauseBtn.disabled = !!state.disablePause;
      pauseBtn.hidden = !!state.finished || !!state.cancelled || !!state.awaitingConfirmation;
    }
    if (confirmBtn) {
      confirmBtn.hidden = !state.awaitingConfirmation || !!state.finished || !!state.cancelled;
      confirmBtn.disabled = !state.awaitingConfirmation;
      confirmBtn.textContent = state.pageByPageMode
        ? (t.btnConfirmPageByPage || "Start page-by-page removal")
        : (substitutePlaceholders(t.btnConfirmRemoval, [state.matched || 0]) || `Remove ${state.matched || 0} favorites`);
    }
    if (stopBtn) {
      stopBtn.disabled = !!state.finished || !!state.cancelled;
      stopBtn.hidden = !!state.finished || !!state.cancelled;
      stopBtn.textContent = state.awaitingConfirmation ? (t.btnCancel || "Cancel") : (t.btnStop || "Stop");
    }
    if (downloadBtn) {
      downloadBtn.disabled = !state.reportReady;
      const baseLabel = t.btnDownloadReport || "Download report";
      const total = state.matched || (state.removed || 0) + (state.failed || 0);
      downloadBtn.textContent = state.reportReady && total > 0
        ? `${baseLabel} (${total})`
        : baseLabel;
    }
  }

  function sanitizeCsvCell(value) {
    let text = String(value == null ? "" : value).replace(/\s+/g, " ");
    if (/^[=+\-@]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function buildReport(state, config, format) {
    const matched = state.reportScannedItems || [];
    const requestSucceeded = state.reportItems || [];
    const failed = state.reportFailedItems || [];
    const verifiedRemoved = state.reportVerifiedItems || [];
    const stillPresent = state.reportStillPresentItems || [];
    const failedIds = new Set(failed.map((item) => item.id));
    const verifiedIds = new Set(verifiedRemoved.map((item) => item.id));
    const remainingIds = new Set(stillPresent.map((item) => item.id));
    const requestSucceededIds = new Set(requestSucceeded.map((item) => item.id));
    const statusFor = (item) => {
      if (verifiedIds.has(item.id)) return "verified_removed";
      if (remainingIds.has(item.id)) return "still_present";
      if (failedIds.has(item.id)) return "request_failed";
      if (requestSucceededIds.has(item.id)) return "request_succeeded_unverified";
      return config.dryRun ? "matched" : "not_processed";
    };
    const metadata = {
      extensionVersion: chrome.runtime.getManifest().version,
      startedAt: state.startedAt || null,
      finishedAt: state.finishedAt || null,
      mode: config.dryRun ? "analysis" : "removal",
      keywordsFilter: config.keywordsFilter || "",
      intervalMode: config.requestIntervalMode,
      intervalRange: config.requestIntervalRange,
      intervalSet: config.requestIntervalSet,
      pagePauseSeconds: config.pagePauseSeconds,
      cancelled: !!state.cancelled,
    };
    const summary = {
      listed: state.totalListed || 0,
      matched: matched.length,
      requestsSucceeded: requestSucceeded.length,
      requestFailures: failed.length,
      verifiedRemoved: verifiedRemoved.length,
      stillPresent: stillPresent.length,
    };
    if (format === "csv") {
      const headers = ["id", "authorName", "desc", "url", "status"];
      const rows = matched.map((item) => [item.id, item.authorName, item.desc || "", item.url, statusFor(item)]);
      return headers.map(sanitizeCsvCell).join(",") + "\n" + rows.map((row) => row.map(sanitizeCsvCell).join(",")).join("\n");
    }
    return JSON.stringify({ metadata, summary, items: matched.map((item) => ({ ...item, status: statusFor(item) })), diagnostics: state.diagnostics || {} }, null, 2);
  }

  function downloadReport(content, format, mode) {
    const ext = format === "csv" ? "csv" : "json";
    const mime = format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8";
    const blob = new Blob([content], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `tiktok-favorites-${mode === "analysis" ? "analysis" : "removal-report"}-${Date.now()}.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const MAX_CONSECUTIVE_FAILURES = 5;

  let panelState = {
    status: "Preparando...",
    pages: 0,
    removed: 0,
    processed: 0,
    failed: 0,
    matched: 0,
    verifiedRemoved: null,
    stillPresent: null,
    totalListed: 0,
    paused: false,
    reportReady: false,
    reportItems: [],
    reportFailedItems: [],
    reportScannedItems: [],
    reportVerifiedItems: [],
    reportStillPresentItems: [],
    diagnostics: { listing: [], removal: [] },
    reportFormat: "json",
    cancelled: false,
    finished: false,
    awaitingConfirmation: false,
    pageByPageMode: false,
    startedAt: null,
    finishedAt: null,
  };

  async function runRemoval(config) {
    config = config || {};
    var panel = createInPagePanel(config.i18n);
    if (!panel || !panel.parentNode) {
      console.error("TikTok Favorites Remover: não foi possível criar o painel na página.");
      return;
    }
    const keywordList = parseKeywords(config.keywordsFilter || "");
    Object.assign(panelState, {
      status: "Preparing…",
      pages: 0,
      removed: 0,
      processed: 0,
      failed: 0,
      matched: 0,
      verifiedRemoved: null,
      stillPresent: null,
      totalListed: 0,
      paused: false,
      disablePause: false,
      reportReady: false,
      reportItems: [],
      reportFailedItems: [],
      reportScannedItems: [],
      reportVerifiedItems: [],
      reportStillPresentItems: [],
      diagnostics: { listing: [], removal: [], verification: [] },
      reportFormat: config.exportFileType || "json",
      cancelled: false,
      finished: false,
      awaitingConfirmation: false,
      pageByPageMode: false,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    });

    const pauseBtn = panel.querySelector("#tfr-pause-btn");
    const confirmBtn = panel.querySelector("#tfr-confirm-btn");
    const stopBtn = panel.querySelector("#tfr-stop-btn");
    const downloadBtn = panel.querySelector("#tfr-download-btn");
    const closeBtn = panel.querySelector(".tfr-close");

    const t0 = config.i18n || {};
    let confirmationResolver = null;
    pauseBtn.onclick = () => {
      if (panelState.finished || panelState.awaitingConfirmation) return;
      panelState.paused = !panelState.paused;
      panelState.status = panelState.paused ? (t0.statusPaused || "Paused") : (t0.statusResuming || "Resuming…");
      updatePanel(panel, panelState, t0);
    };

    downloadBtn.onclick = () => {
      const content = buildReport(panelState, config, panelState.reportFormat);
      downloadReport(content, panelState.reportFormat, config.dryRun ? "analysis" : "removal");
    };

    const stopRun = () => {
      if (panelState.finished || panelState.cancelled) return;
      panelState.cancelled = true;
      panelState.paused = false;
      panelState.disablePause = true;
      panelState.awaitingConfirmation = false;
      panelState.finished = true;
      panelState.finishedAt = new Date().toISOString();
      panelState.status = t0.statusCancelled || "Stopped by user.";
      panelState.reportReady = true;
      cancelActiveRemoval();
      if (confirmationResolver) {
        confirmationResolver(false);
        confirmationResolver = null;
      }
      updatePanel(panel, panelState, t0);
    };
    if (confirmBtn) {
      confirmBtn.onclick = () => {
        if (!panelState.awaitingConfirmation || !confirmationResolver) return;
        panelState.awaitingConfirmation = false;
        const resolve = confirmationResolver;
        confirmationResolver = null;
        resolve(true);
      };
    }
    if (stopBtn) stopBtn.onclick = stopRun;
    closeBtn.onclick = () => {
      stopRun();
      panel.remove();
    };

    const t = config.i18n || {};
    const setStatus = (s) => {
      panelState.status = s;
      updatePanel(panel, panelState, t);
    };

    const finish = (status) => {
      panelState.status = status;
      panelState.finished = true;
      panelState.awaitingConfirmation = false;
      panelState.disablePause = true;
      panelState.reportReady = true;
      panelState.finishedAt = new Date().toISOString();
      updatePanel(panel, panelState, t);
    };

    try {
      if (config.notLoggedInRedirect) {
        finish(t.statusErrorRedirectedForyou || "You were redirected to For You because you're not logged in. Please log in, then open the extension and click Start again.");
        return;
      }

      const favoriteTabResult = await openFavoritesTab();
      panelState.diagnostics.favoriteTab = favoriteTabResult;
      if (!favoriteTabResult.selected) {
        finish(t.statusFavoriteTabUnavailable || "Could not open the Favorites tab. Reload your profile and try again.");
        return;
      }

      setStatus(t.statusWaiting || "Identifying your account…");
      let favoriteContext = await getFavoriteContextAsync();
      let secUid = favoriteContext.secUid || null;
      if (!secUid) {
        for (let attempt = 0; attempt < 12; attempt++) {
          if (!(await cancellableSleep(1500))) return;
          favoriteContext = await getFavoriteContextAsync();
          secUid = favoriteContext.secUid || null;
          if (secUid) break;
        }
      }
      panelState.diagnostics.context = {
        source: favoriteContext.contextSource || "unknown",
        hasAccountId: !!favoriteContext.secUid,
        hasCsrfToken: !!favoriteContext.csrfToken,
        hasDeviceId: !!favoriteContext.deviceId,
        region: favoriteContext.region || "",
        language: favoriteContext.language || "",
      };
      if (!secUid) {
        const onForyou = /\/foryou(\?|$)/i.test(window.location.href);
        finish(onForyou
          ? (t.statusErrorRedirectedForyou || "You were redirected to For You because you're not logged in.")
          : (t.statusErrorNoAccount || "Could not identify your account."));
        return;
      }

      const pagePauseMs = Math.max(0, (config.pagePauseSeconds ?? 5)) * 1000;
      if (config.dryRun) {
        setStatus(t.statusListing || "Listing all favorites for analysis…");
        const analysis = await collectAllFavoriteItems(secUid, {
          diagnostics: panelState.diagnostics.listing,
          pagePauseMs,
          refresh: true,
          onPage({ page, uniqueItems, total }) {
            panelState.pages = page;
            panelState.totalListed = total;
            const pageMatches = uniqueItems.filter((item) => matchesKeywords(item.desc, keywordList)).length;
            setStatus(substitutePlaceholders(t.statusPageScanning, [page, pageMatches, uniqueItems.length])
              || `Page ${page}: ${pageMatches} of ${uniqueItems.length} items match the filter…`);
          },
        });
        panelState.pages = analysis.pages;
        panelState.totalListed = analysis.items.length;
        panelState.reportScannedItems = analysis.items.filter((item) => matchesKeywords(item.desc, keywordList));
        panelState.matched = panelState.reportScannedItems.length;
        panelState.reportReady = true;
        finish(analysis.items.length === 0
          ? (t.statusNone || "No favorites found.")
          : (substitutePlaceholders(t.statusScanDone, [panelState.matched, analysis.items.length]) || `Analysis complete: ${panelState.matched} of ${analysis.items.length} favorites match.`));
        return;
      }

      panelState.pageByPageMode = true;
      setStatus(t.statusListing || "Loading the first page of favorites…");
      let confirmed = false;
      let consecutiveFailures = 0;
      const candidateIds = new Set();
      const pagedRun = await collectAllFavoriteItems(secUid, {
        diagnostics: panelState.diagnostics.listing,
        pagePauseMs,
        refresh: true,
        ignoreExpectedCount: true,
        async onPage({ page, uniqueItems, total, result }) {
          panelState.pages = page;
          panelState.totalListed = total;
          const pageCandidates = uniqueItems.filter((item) => matchesKeywords(item.desc, keywordList));
          pageCandidates.forEach((item) => {
            if (candidateIds.has(item.id)) return;
            candidateIds.add(item.id);
            panelState.reportScannedItems.push(item);
          });
          panelState.matched = panelState.reportScannedItems.length;
          panelState.reportReady = true;
          updatePanel(panel, panelState, t);

          if (!confirmed && uniqueItems.length > 0) {
            panelState.awaitingConfirmation = true;
            setStatus(substitutePlaceholders(t.statusReadyPageByPage, [pageCandidates.length, uniqueItems.length])
              || `First page: ${pageCandidates.length} of ${uniqueItems.length} items match. Confirm to process page by page.`);
            const accepted = await new Promise((resolve) => { confirmationResolver = resolve; });
            if (!accepted || panelState.cancelled) {
              const cancelled = new Error("Cancelled");
              cancelled.code = "CANCELLED";
              throw cancelled;
            }
            confirmed = true;
            updatePanel(panel, panelState, t);
          }

          for (let index = 0; index < pageCandidates.length; index++) {
            const item = pageCandidates[index];
            if (!(await waitUntilRunnable())) {
              const cancelled = new Error("Cancelled");
              cancelled.code = "CANCELLED";
              throw cancelled;
            }
            setStatus(`Page ${page}: ` + (substitutePlaceholders(t.statusRemovingProgress, [index + 1, pageCandidates.length]) || `Removing ${index + 1} of ${pageCandidates.length}…`));
            try {
              const removalResult = await removeFavoriteWithRetry(item);
              panelState.diagnostics.removal.push({ id: item.id, page, success: true, httpStatus: removalResult.httpStatus || null, attempts: removalResult.attempts });
              panelState.reportItems.push(item);
              consecutiveFailures = 0;
            } catch (error) {
              if (error.code === "CANCELLED") throw error;
              panelState.diagnostics.removal.push({ id: item.id, page, success: false, errorCode: error.code || "REMOVE_FAILED", httpStatus: error.httpStatus || null });
              panelState.reportFailedItems.push(item);
              consecutiveFailures++;
              if (error.code === "RATE_LIMITED" || error.code === "SESSION_REJECTED") throw error;
              if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                const stopped = new Error("Too many consecutive failures");
                stopped.code = "TOO_MANY_FAILURES";
                throw stopped;
              }
            }
            panelState.failed = panelState.reportFailedItems.length;
            panelState.processed = panelState.reportItems.length + panelState.reportFailedItems.length;
            updatePanel(panel, panelState, t);
            if (index < pageCandidates.length - 1 && !(await cancellableSleep(randomDelayMs(config)))) {
              const cancelled = new Error("Cancelled");
              cancelled.code = "CANCELLED";
              throw cancelled;
            }
          }
          if (result.hasMore) setStatus(t.statusBetweenPages || "Loading the next page…");
        },
      });

      panelState.pages = pagedRun.pages;
      panelState.totalListed = pagedRun.items.length;
      const candidates = panelState.reportScannedItems;
      if (pagedRun.items.length === 0) {
        finish(t.statusNone || "No favorites found.");
        return;
      }
      if (candidates.length === 0) {
        finish(t.statusNoMatches || "Favorites were found, but none match the selected filter.");
        return;
      }

      setStatus(t.statusVerifying || "Verifying the result with TikTok…");
      if (!(await cancellableSleep(1200))) return;
      let remainingIds = new Set();
      for (let verificationAttempt = 1; verificationAttempt <= 3; verificationAttempt++) {
        panelState.diagnostics.verification.push({ attempt: verificationAttempt, marker: "start" });
        const verification = await collectAllFavoriteItems(secUid, {
          diagnostics: panelState.diagnostics.verification,
          pagePauseMs: Math.min(pagePauseMs, 2000),
          refresh: true,
          onPage({ page, total }) {
            setStatus(substitutePlaceholders(t.statusVerificationPage, [page, total]) || `Verification page ${page}: ${total} favorites still listed…`);
          },
        });
        remainingIds = new Set(verification.items.map((item) => item.id));
        const targetStillPresent = candidates.some((item) => remainingIds.has(item.id));
        if (!targetStillPresent || verificationAttempt === 3) break;
        if (!(await cancellableSleep(verificationAttempt * 2000))) return;
      }
      panelState.reportVerifiedItems = candidates.filter((item) => !remainingIds.has(item.id));
      panelState.reportStillPresentItems = candidates.filter((item) => remainingIds.has(item.id));
      panelState.verifiedRemoved = panelState.reportVerifiedItems.length;
      panelState.removed = panelState.verifiedRemoved;
      panelState.stillPresent = panelState.reportStillPresentItems.length;
      panelState.reportReady = true;

      if (panelState.stillPresent === 0) {
        finish(substitutePlaceholders(t.statusVerifiedDone, [panelState.verifiedRemoved]) || `Done and verified: ${panelState.verifiedRemoved} favorites removed.`);
      } else {
        finish(substitutePlaceholders(t.statusPartial, [panelState.verifiedRemoved, panelState.stillPresent])
          || `Finished with verification: ${panelState.verifiedRemoved} removed, ${panelState.stillPresent} still present.`);
      }
    } catch (error) {
      if (error && error.code === "CANCELLED") {
        if (!panelState.finished) stopRun();
      } else if (error && error.code === "RATE_LIMITED") {
        finish(t.statusRateLimited || "TikTok temporarily limited requests. Wait before trying again.");
      } else if (error && error.code === "SESSION_REJECTED") {
        finish(t.statusSessionRejected || "TikTok rejected the session. Reload the page and try again.");
      } else if (error && error.code === "TOO_MANY_FAILURES") {
        finish(substitutePlaceholders(t.statusStoppedFailures, [MAX_CONSECUTIVE_FAILURES]) || `Stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive failures.`);
      } else {
        console.error("TikTok Favorites Remover:", error);
        const detail = [error && error.code, error && error.httpStatus ? `HTTP ${error.httpStatus}` : ""].filter(Boolean).join(" · ");
        finish((t.statusListError || "Could not complete the operation.") + (detail ? ` (${detail})` : ""));
      }
    } finally {
      panelState.finishedAt = panelState.finishedAt || new Date().toISOString();
      panelState.awaitingConfirmation = false;
      updatePanel(panel, panelState, t);
      try { chrome.runtime.sendMessage({ action: "runFinished" }); } catch (e) {}
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "startRemovingFavorites") {
      try {
        runRemoval(msg.config);
        sendResponse({ ok: true });
      } catch (e) {
        console.error("TikTok Favorites Remover:", e);
        sendResponse({ ok: false, error: String(e) });
      }
    }
    return true;
  });
})();
