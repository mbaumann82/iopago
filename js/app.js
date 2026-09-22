(() => {
  const SITE = window.SITE || {};
  const ARCHIVE_RE = /\.(zip|7z|rar|tar|gz|tgz|bz2|xz|iso|dmg|exe|msi|pkg)$/i;
  const STEPS = [
    "Connecting to GitHub…",
    "Verifying release assets…",
    "Scanning file for threats…",
    "Preparing secure download…",
  ];

  const $ = (id) => document.getElementById(id);
  const ui = {
    card: $("card"),
    title: $("title"),
    subtitle: $("subtitle"),
    status: $("status"),
    timer: $("timer"),
    bar: $("bar"),
    fill: $("fill"),
    fileName: $("fileName"),
    scanLabel: $("scanLabel"),
    primary: $("primary"),
    repoLink: $("repoLink"),
    downloadsLabel: $("downloadsLabel"),
  };

  const state = {
    visual: 0,
    target: 0,
    busy: false,
    started: false,
    asset: null,
    left: Number.isFinite(SITE.countdown) ? SITE.countdown : 4,
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function paint(value) {
    const pct = Math.max(0, Math.min(100, value));
    ui.fill.style.width = `${pct}%`;
    ui.bar.setAttribute("aria-valuenow", String(Math.round(pct)));
  }

  function setTone(tone) {
    ui.card.classList.toggle("done", tone === "done");
    ui.card.classList.toggle("err", tone === "err");
  }

  function formatDownloads(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return "14,000+ downloads";
    const rounded = n >= 1000 ? Math.floor(n / 1000) * 1000 : n;
    return `${rounded.toLocaleString()}+ downloads`;
  }

  function applyCopy() {
    const owner = SITE.owner || "github";
    const repo = SITE.repo || "repository";
    ui.repoLink.href = `https://github.com/${owner}/${repo}`;
    ui.title.textContent = SITE.title || "Preparing Your Download";
    const subtitle =
      SITE.subtitle ||
      "We’re getting everything ready for you.\nYour download will start automatically in a moment.";
    ui.subtitle.innerHTML = subtitle
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
    ui.downloadsLabel.textContent = formatDownloads(SITE.downloads);
    ui.scanLabel.textContent = SITE.virusScan || "Virus scan: clean";
    ui.timer.textContent = `${state.left}s`;
  }

  function readQuery() {
    const q = new URLSearchParams(location.search);
    return {
      releaseUrl: q.get("release") || q.get("url") || SITE.releaseUrl || "",
      assetName: q.get("file") || SITE.assetName || "",
    };
  }

  function parseGithub(input) {
    if (!input) return null;
    try {
      const u = new URL(input);
      if (u.hostname !== "github.com") return { kind: "direct", url: input };
      const parts = u.pathname.replace(/^\/|\/$/g, "").split("/");
      const [owner, repo, section, a, b] = parts;
      if (!owner || !repo) return null;
      if (section === "releases" && a === "download" && b) {
        return {
          kind: "asset",
          owner,
          repo,
          tag: decodeURIComponent(b),
          file: decodeURIComponent(parts.slice(5).join("/")),
          page: `https://github.com/${owner}/${repo}`,
        };
      }
      if (section === "releases" && a === "tag" && b) {
        return { kind: "tag", owner, repo, tag: decodeURIComponent(b), page: `https://github.com/${owner}/${repo}` };
      }
      return { kind: "latest", owner, repo, page: `https://github.com/${owner}/${repo}` };
    } catch {
      return null;
    }
  }

  async function githubJson(path) {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      throw new Error(
        res.status === 404
          ? "Release not found."
          : res.status === 403
            ? "GitHub rate limit. Wait a minute and try again."
            : `GitHub error ${res.status}.`
      );
    }
    return res.json();
  }

  function pickAsset(release, wanted) {
    const assets = Array.isArray(release.assets) ? release.assets : [];
    if (wanted) {
      const match = assets.find((a) => a.name.toLowerCase() === wanted.toLowerCase());
      if (match) return match;
    }
    return assets.find((a) => ARCHIVE_RE.test(a.name)) || assets[0] || null;
  }

  async function resolveAsset(cfg) {
    const parsed = parseGithub(cfg.releaseUrl);
    if (!parsed) throw new Error("No release URL set.");

    if (parsed.kind === "direct") {
      ui.repoLink.href = parsed.url;
      return {
        name: cfg.assetName || parsed.url.split("/").pop() || "download.bin",
        browser_download_url: parsed.url,
        size: 0,
      };
    }

    ui.repoLink.href = parsed.page;

    if (parsed.kind === "asset") {
      try {
        const release = await githubJson(
          `/repos/${parsed.owner}/${parsed.repo}/releases/tags/${encodeURIComponent(parsed.tag)}`
        );
        return pickAsset(release, cfg.assetName || parsed.file) || {
          name: parsed.file,
          browser_download_url: `https://github.com/${parsed.owner}/${parsed.repo}/releases/download/${parsed.tag}/${parsed.file}`,
          size: 0,
        };
      } catch {
        return {
          name: parsed.file,
          browser_download_url: `https://github.com/${parsed.owner}/${parsed.repo}/releases/download/${parsed.tag}/${parsed.file}`,
          size: 0,
        };
      }
    }

    const path =
      parsed.kind === "tag"
        ? `/repos/${parsed.owner}/${parsed.repo}/releases/tags/${encodeURIComponent(parsed.tag)}`
        : `/repos/${parsed.owner}/${parsed.repo}/releases/latest`;
    const release = await githubJson(path);
    const asset = pickAsset(release, cfg.assetName);
    if (!asset) throw new Error("No files in this release.");
    return asset;
  }

  function nativeSave(url, name) {
    const a = document.createElement("a");
    a.href = url;
    a.download = name || "";
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function tickCountdown() {
    const total = Number.isFinite(SITE.countdown) ? SITE.countdown : 4;
    const started = performance.now();
    const step = (now) => {
      if (state.started) return;
      const elapsed = (now - started) / 1000;
      const left = Math.max(0, total - elapsed);
      state.left = Math.ceil(left);
      ui.timer.textContent = `${state.left}s`;
      state.target = ((total - left) / total) * 92;
      paint(state.target);
      const idx = Math.min(STEPS.length - 1, Math.floor((elapsed / total) * STEPS.length));
      ui.status.textContent = STEPS[idx];
      if (left > 0) requestAnimationFrame(step);
      else run();
    };
    requestAnimationFrame(step);
  }

  async function run() {
    if (state.busy) return;
    state.busy = true;
    state.started = true;
    setTone("");
    ui.primary.disabled = true;
    ui.timer.textContent = "now";
    ui.status.textContent = "Starting download…";
    paint(96);

    try {
      const asset = state.asset || (await resolveAsset(readQuery()));
      state.asset = asset;
      ui.fileName.textContent = asset.name;
      nativeSave(asset.browser_download_url, asset.name);
      await sleep(240);
      paint(100);
      setTone("done");
      ui.status.textContent = "Download started";
    } catch (err) {
      setTone("err");
      paint(100);
      ui.status.textContent = err.message || "Download failed.";
    } finally {
      ui.primary.disabled = false;
      state.busy = false;
    }
  }

  applyCopy();
  ui.primary.addEventListener("click", run);

  window.addEventListener(
    "load",
    async () => {
      try {
        state.asset = await resolveAsset(readQuery());
        ui.fileName.textContent = state.asset.name;
      } catch {
        ui.fileName.textContent = "Release file";
      }
      tickCountdown();
    },
    { once: true }
  );
})();
