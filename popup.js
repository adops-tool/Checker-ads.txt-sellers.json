(() => {
  const adsTab = document.getElementById("ads-tab");
  const appAdsTab = document.getElementById("appads-tab");
  const sellerTab = document.getElementById("seller-tab");
  const output = document.getElementById("output");

  const filterArea = document.getElementById("filter-area");
  const filterLeftSection = document.getElementById("filter-left-section");
  const linkBlock = document.getElementById("link-block");
  const filterStatusText = document.getElementById("filter-status-text");

  const settingsToggle = document.getElementById("settings-toggle");
  const settingsPanel = document.getElementById("settings-panel");
  const closeSettingsBtn = document.getElementById("close-settings");
  const urlInput = document.getElementById("sellers-url-input");
  const autoCloseSettingsInput = document.getElementById("auto-close-settings-input");
  const persistFilterInput = document.getElementById("persist-filter-input");
  const highlightOwnDomainInput = document.getElementById("highlight-own-domain-input");
  const saveBtn = document.getElementById("save-settings");
  const refreshCacheBtn = document.getElementById("force-refresh-cache");

  const adsCountEl = document.getElementById("ads-line-count");
  const appAdsCountEl = document.getElementById("appads-line-count");
  const sellerCountEl = document.getElementById("seller-line-count");

  const statusContainer = document.getElementById("status-container");
  const fileDateEl = document.getElementById("file-date");
  const ownerBadgeEl = document.getElementById("owner-badge");
  const managerBadgeEl = document.getElementById("manager-badge");

  const openValidatorBtn = document.getElementById("open-validator-btn");

  let adsData = { text: "", url: "", date: null };
  let appAdsData = { text: "", url: "", date: null };

  let sellersData = [];
  let current = "seller";
  let isFilterActive = true;
  let currentSellersUrl = DEFAULT_SELLERS_URL;
  let currentTabDomain = "";

  let autoCloseSettingsOnTabSwitch = true;
  let persistFilterState = true;
  let highlightOwnDomain = true;

  function sendMessageSafe(message, callback = () => {}) {
    if (!chrome.runtime || !chrome.runtime.id) return;
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) return;
      callback(response);
    });
  }

  function openSettingsPanel() {
    settingsPanel.style.display = "flex";
  }

  function closeSettingsPanel() {
    settingsPanel.style.display = "none";
  }

  function toggleSettingsPanel() {
    if (settingsPanel.style.display === "none") openSettingsPanel();
    else closeSettingsPanel();
  }

  function updateFilterText() {
    const brand = getBrandName(currentSellersUrl);
    const icon = isFilterActive ? "✔" : "✖";
    filterStatusText.innerHTML = `<span class="filter-icon">${icon}</span> Show only ${brand}`;
  }

  function applyFilterVisualState() {
    filterArea.classList.toggle("active", isFilterActive);
  }

  function persistFilterStateIfNeeded() {
    if (!persistFilterState) return;
    chrome.storage.local.set({ [FILTER_ACTIVE_KEY]: isFilterActive });
  }

  function countLines(text, isError) {
    if (!text || isError) return "";
    const count = text.split("\n").filter((line) => line.trim().length > 0).length;
    return count > 0 ? count : "0";
  }

  async function fetchTxtFile(base, name, force = false) {
    if (!base) return { text: `File ${name} not found.`, isError: true };
    const url = `${base.replace(/\/$/, "")}/${name}`;
    const fetchOptions = force ? { cache: "reload" } : {};
    try {
      const res = await fetchWithTimeoutAndRetry(url, { timeout: 8000, retries: 1, fetchOptions });
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.toLowerCase().includes("text/html")) {
        return { text: `Error: ${name} returned HTML header (likely a 404 page).`, isError: true };
      }
      let text = await res.text();
      text = text.replace(/\r\n|\r/g, "\n");
      const textTrimmed = text.trim();
      if (
        textTrimmed.startsWith("<!DOCTYPE") ||
        textTrimmed.startsWith("<html") ||
        textTrimmed.startsWith("<head") ||
        textTrimmed.startsWith("<body") ||
        textTrimmed.substring(0, 300).toLowerCase().includes("<script")
      ) {
        return { text: `Error: ${name} appears to be an HTML page (Soft 404), not a valid text file.`, isError: true };
      }
      const lastModified = res.headers.get("Last-Modified");
      return { text, finalUrl: res.url || url, lastModified, isError: false };
    } catch {
      return { text: `File ${name} not found (Network Error).`, isError: true };
    }
  }

  function checkDomainField(text, fieldName) {
    if (!text) return { status: "NOT FOUND", value: null };
    const lines = text.split(/\r?\n/);
    let foundRawValue = null;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.toUpperCase().startsWith(fieldName)) {
        const val = line.substring(fieldName.length).trim().replace(/^[,=:]/, "").trim();
        if (val) {
          foundRawValue = val.split(/\s+/)[0];
          break;
        }
      }
    }
    if (!foundRawValue) return { status: "NOT FOUND", value: null };
    const valClean = cleanDomain(foundRawValue);
    const siteClean = cleanDomain(currentTabDomain);
    if (valClean === siteClean || siteClean.endsWith(`.${valClean}`)) {
      return { status: "MATCH", value: foundRawValue };
    }
    return { status: "MISMATCH", value: foundRawValue };
  }

  function renderBadge(element, label, result) {
    element.innerHTML = "";
    if (result.status === "NOT FOUND") {
      element.className = "badge neutral";
      element.textContent = `${label}: NOT FOUND`;
      return;
    }

    if (result.status === "MATCH") {
      element.className = "badge success";
      element.textContent = `${label}: MATCH`;
      return;
    }

    element.className = "badge error";
    element.textContent = `${label}: `;
    const href = safeHref(result.value);
    if (href) {
      const link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = result.value;
      link.style.color = "inherit";
      link.style.textDecoration = "underline";
      element.appendChild(link);
    } else {
      element.appendChild(document.createTextNode(result.value));
    }
  }

  function isIdInSellers(sellerId) {
    if (!sellersData || sellersData.length === 0) return true;
    return sellersData.some((s) => String(s.seller_id) === String(sellerId));
  }

  function renderTextSafe(container, text) {
    container.innerHTML = "";
    if (!text) return;
    const brand = getBrandName(currentSellersUrl).toLowerCase();
    const highlightRegex = new RegExp(`(${brand})`, "gi");

    text.split("\n").forEach((line) => {
      const trimmedLine = line.trim();
      if (trimmedLine.length === 0) return;

      const lineNode = document.createElement("div");
      lineNode.className = "line-row";
      let warningTitle = "";
      let isError = false;
      let isMismatch = false;

      if (trimmedLine.toLowerCase().includes(brand)) {
        const hasComma = trimmedLine.includes(",");
        const startsWithSpecial = /^[^a-zA-Z0-9]/.test(trimmedLine);

        if (startsWithSpecial && hasComma) {
          isError = true;
          warningTitle = "Error: Data line is commented out!";
          lineNode.classList.add("line-critical-error");
        }

        const parts = trimmedLine.split(",").map((p) => p.trim());
        if (parts.length >= 2) {
          const cleanId = parts[1].split(/\s+/)[0].replace(/[^a-zA-Z0-9]/g, "");
          if (cleanId && !isIdInSellers(cleanId)) {
            isMismatch = true;
            if (!isError && !startsWithSpecial) {
              lineNode.classList.add("line-warning");
              warningTitle = "Warning: ID not found in sellers.json";
            }
          }
        }
      }

      let lastIndex = 0;
      let match;
      while ((match = highlightRegex.exec(line)) !== null) {
        lineNode.appendChild(document.createTextNode(line.substring(lastIndex, match.index)));
        const bold = document.createElement("b");
        bold.textContent = match[0];
        lineNode.appendChild(bold);
        lastIndex = highlightRegex.lastIndex;
      }
      lineNode.appendChild(document.createTextNode(line.substring(lastIndex)));

      if (isError || (isMismatch && !/^[^a-zA-Z0-9]/.test(trimmedLine))) {
        const warnSpan = document.createElement("span");
        warnSpan.className = "warning-icon";
        warnSpan.textContent = isError ? "(X)" : "(!)";
        warnSpan.title = warningTitle;
        lineNode.appendChild(warnSpan);
      }

      container.appendChild(lineNode);
    });
  }

  function filterAndRender(text, container) {
    const brand = getBrandName(currentSellersUrl).toLowerCase();
    if (!isFilterActive) {
      renderTextSafe(container, text);
      return;
    }
    const filtered = (text || "").split("\n").filter((line) => line.toLowerCase().includes(brand));
    if (filtered.length === 0) {
      container.textContent = `No ${brand} matches.`;
      return;
    }
    renderTextSafe(container, filtered.join("\n"));
  }

  function findSellerMatches() {
    const brand = getBrandName(currentSellersUrl).toLowerCase();
    const extractIds = (text) => {
      const set = new Set();
      (text || "").split("\n").forEach((line) => {
        const trimmed = line.trim();
        if (trimmed.toLowerCase().includes(brand) && !/^[^a-zA-Z0-9]/.test(trimmed)) {
          const parts = line.split(",").map((x) => x.trim());
          if (parts.length >= 2) {
            const id = parts[1].replace(/[^a-zA-Z0-9]/g, "");
            if (id) set.add(id);
          }
        }
      });
      return set;
    };

    const ids = new Set([...extractIds(adsData.text), ...extractIds(appAdsData.text)]);
    return sellersData.filter((record) => ids.has(String(record.seller_id)));
  }

  function updateStatusInfo(type) {
    if (type === "seller") {
      statusContainer.style.display = "none";
      return;
    }

    statusContainer.style.display = "flex";
    const data = type === "ads" ? adsData : appAdsData;

    if (data.date) {
      const d = new Date(data.date);
      fileDateEl.textContent = `Modified: ${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
    } else {
      fileDateEl.textContent = "";
    }

    renderBadge(ownerBadgeEl, "OWNER", checkDomainField(data.text, "OWNERDOMAIN"));
    renderBadge(managerBadgeEl, "MANAGER", checkDomainField(data.text, "MANAGERDOMAIN"));
  }

  function showCurrent() {
    linkBlock.textContent = "";
    const brand = getBrandName(currentSellersUrl);

    if (current === "seller") {
      statusContainer.style.display = "none";
      filterArea.style.display = "none";
      const matches = findSellerMatches();
      sellerCountEl.textContent = matches.length || "0";
      output.innerHTML = "";

      if (matches.length === 0) {
        output.textContent = `No ${brand} matches.`;
      } else {
        const currentDomainClean = cleanDomain(currentTabDomain);
        matches.forEach((match) => {
          const row = document.createElement("div");
          row.className = "line-row";
          const sellerDomainClean = cleanDomain(match.domain);
          if (highlightOwnDomain && sellerDomainClean === currentDomainClean && currentDomainClean !== "") {
            row.classList.add("highlight-own-domain");
          }
          row.textContent = `${match.domain} (${match.seller_id}) — ${match.seller_type}`;
          output.appendChild(row);
        });
      }
    } else {
      updateStatusInfo(current);
      filterArea.style.display = "flex";
      const data = current === "ads" ? adsData : appAdsData;
      if (data.url) {
        const href = safeHref(data.url);
        if (href) {
          const link = document.createElement("a");
          link.href = href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = data.url;
          linkBlock.appendChild(link);
        } else {
          linkBlock.textContent = data.url;
        }
      }
      filterAndRender(data.text, output);
    }

    sendMessageSafe({ type: "setBadge", count: findSellerMatches().length });
  }

  function setActive(tab) {
    current = tab;
    [adsTab, appAdsTab, sellerTab].forEach((item) => item.classList.toggle("active", item.id === `${tab}-tab`));
    if (autoCloseSettingsOnTabSwitch) closeSettingsPanel();
    showCurrent();
  }

  function saveSettings() {
    const newUrl = urlInput.value.trim() || DEFAULT_SELLERS_URL;
    autoCloseSettingsOnTabSwitch = autoCloseSettingsInput.checked;
    persistFilterState = persistFilterInput.checked;
    highlightOwnDomain = highlightOwnDomainInput.checked;

    const payload = {
      [CUSTOM_URL_KEY]: newUrl,
      [AUTO_CLOSE_SETTINGS_KEY]: autoCloseSettingsOnTabSwitch,
      [PERSIST_FILTER_STATE_KEY]: persistFilterState,
      [HIGHLIGHT_OWN_DOMAIN_KEY]: highlightOwnDomain
    };

    if (!persistFilterState) {
      payload[FILTER_ACTIVE_KEY] = true;
      isFilterActive = true;
      applyFilterVisualState();
      updateFilterText();
    } else {
      payload[FILTER_ACTIVE_KEY] = isFilterActive;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    chrome.storage.local.set(payload, () => {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Settings";
      if (chrome.runtime.lastError) return;

      currentSellersUrl = newUrl;
      updateFilterText();
      closeSettingsPanel();
      sendMessageSafe({ type: "refreshSellers" }, () => loadData(true));
    });
  }

  function hydrateSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        [CUSTOM_URL_KEY, AUTO_CLOSE_SETTINGS_KEY, PERSIST_FILTER_STATE_KEY, FILTER_ACTIVE_KEY, HIGHLIGHT_OWN_DOMAIN_KEY],
        (res) => {
          if (chrome.runtime.lastError) return resolve();

          if (res[CUSTOM_URL_KEY]) currentSellersUrl = res[CUSTOM_URL_KEY];
          if (typeof res[AUTO_CLOSE_SETTINGS_KEY] === "boolean") autoCloseSettingsOnTabSwitch = res[AUTO_CLOSE_SETTINGS_KEY];
          if (typeof res[PERSIST_FILTER_STATE_KEY] === "boolean") persistFilterState = res[PERSIST_FILTER_STATE_KEY];
          if (typeof res[HIGHLIGHT_OWN_DOMAIN_KEY] === "boolean") highlightOwnDomain = res[HIGHLIGHT_OWN_DOMAIN_KEY];

          if (persistFilterState && typeof res[FILTER_ACTIVE_KEY] === "boolean") {
            isFilterActive = res[FILTER_ACTIVE_KEY];
          }

          urlInput.value = currentSellersUrl;
          autoCloseSettingsInput.checked = autoCloseSettingsOnTabSwitch;
          persistFilterInput.checked = persistFilterState;
          highlightOwnDomainInput.checked = highlightOwnDomain;

          applyFilterVisualState();
          updateFilterText();
          resolve();
        }
      );
    });
  }

  async function loadData(force = false) {
    output.textContent = "Loading...";

    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        if (chrome.runtime.lastError || !tabs || !tabs[0]) {
          resolve();
          return;
        }

        let origin = "";
        try {
          const url = new URL(tabs[0].url);
          if (url.protocol.startsWith("http")) {
            origin = url.origin;
            currentTabDomain = url.hostname;
          }
        } catch {}

        const [adsRes, appRes] = await Promise.all([
          fetchTxtFile(origin, "ads.txt", force),
          fetchTxtFile(origin, "app-ads.txt", force)
        ]);

        adsData = { text: adsRes.text, url: adsRes.finalUrl || (origin ? `${origin}/ads.txt` : ""), date: adsRes.lastModified };
        appAdsData = { text: appRes.text, url: appRes.finalUrl || (origin ? `${origin}/app-ads.txt` : ""), date: appRes.lastModified };

        adsCountEl.textContent = countLines(adsData.text, adsRes.isError);
        appAdsCountEl.textContent = countLines(appAdsData.text, appRes.isError);

        sendMessageSafe({ type: "getSellersCache" }, (resp) => {
          sellersData = (resp && resp.sellers) || [];
          showCurrent();
          resolve();
        });
      });
    });
  }

  settingsToggle.addEventListener("click", toggleSettingsPanel);

  settingsPanel.addEventListener("click", (event) => {
    if (event.target === settingsPanel) closeSettingsPanel();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSettingsPanel();
  });

  saveBtn.addEventListener("click", saveSettings);

  refreshCacheBtn.addEventListener("click", () => {
    refreshCacheBtn.textContent = "Syncing...";
    refreshCacheBtn.disabled = true;
    sendMessageSafe({ type: "refreshSellers" }, () => {
      loadData(true).then(() => {
        refreshCacheBtn.textContent = "Clear Cache & Sync";
        refreshCacheBtn.disabled = false;
      });
    });
  });

  if (openValidatorBtn) {
    openValidatorBtn.addEventListener("click", () => {
      chrome.windows.create({
        url: "validator/validator.html",
        type: "popup",
        width: 1050,
        height: 900
      });
    });
  }

  adsTab.addEventListener("click", () => setActive("ads"));
  appAdsTab.addEventListener("click", () => setActive("appads"));
  sellerTab.addEventListener("click", () => setActive("seller"));

  filterLeftSection.addEventListener("click", () => {
    isFilterActive = !isFilterActive;
    applyFilterVisualState();
    updateFilterText();
    persistFilterStateIfNeeded();
    showCurrent();
  });

  hydrateSettings().then(() => {
    loadData(false);
  });
})();
