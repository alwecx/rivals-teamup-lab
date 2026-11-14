/*
  library.js - the Team-Up Lab's Library: save teams into folders and
  subfolders, with notes and comments on every team.

  Storage
    * Without a database (data/cloud-config.js empty) folders live in this
      browser's localStorage.
    * With a Firebase Realtime Database URL configured, every folder is stored
      online under /folders/<folderId> and streamed live (Server-Sent Events
      via the REST API, no SDK): anyone with a folder link sees teams, notes
      and comments appear as they are added. A folder id is a random
      20-character key, so a folder can only be opened by people who have its
      link.

  Data (one document per top-level folder):
    { name, at,
      folders:  { <fid>: { name, parent: "root" | <fid>, at } },
      teams:    { <tid>: { name, folder: "root" | <fid>, t, c, notes, by, at, upd,
                           comments: { <cid>: { by, text, at } } } } }
  `t` is the same team string the lab uses in its links (slots, team-up picks,
  either/or alternatives), `c` the V-D-S comp.

  Relies on globals from index.html: H, slots, comp, compTitle, slotsToT,
  tToSlots, maskOf, partnerIn, equipped, renderAll, esc, slug, flashStatus.
*/
(function () {
  "use strict";
  const DB = ((window.CLOUD_CONFIG || {}).databaseURL || "").trim().replace(/\/+$/, "");
  const CLOUD = /^https:\/\//.test(DB);
  const K_INDEX = "tul.lib.index", K_DOC = "tul.lib.doc.", K_NAME = "tul.lib.name";
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  function rid(n) { const b = new Uint8Array(n || 20); crypto.getRandomValues(b); return Array.from(b, x => ALPH[x % ALPH.length]).join(""); }
  const now = () => Date.now();
  const $ = q => document.querySelector(q);
  // prompt()/confirm() throw in some in-app browsers (Discord, embedded views): treat as "cancelled"
  const ask = (msg, def) => { try { return window.prompt(msg, def); } catch (e) { return null; } };
  const sure = msg => { try { return window.confirm(msg); } catch (e) { return false; } };

  /* ---------------- index of folders this browser knows ---------------- */
  // [{ id, name, cloud }]
  let index = ls.get(K_INDEX, []);
  const saveIndex = () => ls.set(K_INDEX, index);
  const meta = id => index.find(x => x.id === id);

  /* ---------------- documents + live sync ---------------- */
  const docs = {};        // id -> doc
  const streams = {};     // id -> EventSource
  const status = {};      // id -> "live" | "connecting" | "error" | "local"
  function loadLocal(id) { docs[id] = ls.get(K_DOC + id, null); return docs[id]; }
  function cache(id) { if (docs[id]) ls.set(K_DOC + id, docs[id]); }
  function parts(path) { return path.split("/").filter(Boolean); }
  function setIn(obj, ps, val) {
    if (!ps.length) return val;
    obj = obj && typeof obj === "object" ? obj : {};
    const [k, ...rest] = ps;
    const child = setIn(obj[k], rest, val);
    if (child === null || child === undefined) delete obj[k]; else obj[k] = child;
    return obj;
  }
  function applyLocal(id, path, value) {
    docs[id] = setIn(docs[id] || {}, parts(path), value);
    cache(id);
    const m = meta(id);
    if (m && docs[id] && docs[id].name && m.name !== docs[id].name) { m.name = docs[id].name; saveIndex(); }
    if (loaded && loaded.root === id) refreshUpdateBtn();
  }
  async function write(id, path, value) {
    applyLocal(id, path, value);
    render();
    const m = meta(id);
    if (!(m && m.cloud && CLOUD)) return true;
    try {
      const url = `${DB}/folders/${id}${path ? "/" + parts(path).join("/") : ""}.json`;
      const r = await fetch(url, value == null ? { method: "DELETE" } : { method: "PUT", body: JSON.stringify(value) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return true;
    } catch (e) { toast("Couldn't save online - check your connection and try again.", true); return false; }
  }
  function subscribe(id) {
    const m = meta(id);
    if (!m || !m.cloud || !CLOUD || streams[id]) return;
    status[id] = "connecting";
    const es = new EventSource(`${DB}/folders/${id}.json`);
    streams[id] = es;
    const onData = (kind) => (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!msg) return;
      if (kind === "put") applyLocal(id, msg.path, msg.data);
      else for (const k in (msg.data || {})) applyLocal(id, (msg.path === "/" ? "" : msg.path) + "/" + k, msg.data[k]);
      status[id] = "live";
      if (!docs[id]) status[id] = "missing";
      if (view.root === id || !view.root) render();
    };
    es.addEventListener("put", onData("put"));
    es.addEventListener("patch", onData("patch"));
    es.addEventListener("cancel", () => { status[id] = "error"; es.close(); delete streams[id]; render(); });
    es.onerror = () => { if (status[id] !== "error") { status[id] = "connecting"; render(); } };
  }
  // keep local folders in sync across tabs
  window.addEventListener("storage", e => {
    if (e.key === K_INDEX) { index = ls.get(K_INDEX, []); render(); }
    else if (e.key && e.key.startsWith(K_DOC)) { const id = e.key.slice(K_DOC.length); const m = meta(id); if (m && !m.cloud) { loadLocal(id); render(); } }
  });

  /* ---------------- operations ---------------- */
  async function createRoot(name) {
    const id = rid(20);
    index.push({ id, name, cloud: CLOUD });
    saveIndex();
    docs[id] = { name, at: now() };
    cache(id);
    if (CLOUD) {
      try {
        const r = await fetch(`${DB}/folders/${id}.json`, { method: "PUT", body: JSON.stringify(docs[id]) });
        if (!r.ok) throw new Error("HTTP " + r.status);
        subscribe(id);
      } catch (e) { toast("Couldn't create the folder online - it's saved in this browser for now.", true); meta(id).cloud = false; saveIndex(); }
    }
    return id;
  }
  async function uploadRoot(id) { // a browser-only folder becomes a live, shareable one
    if (!CLOUD) return false;
    try {
      const r = await fetch(`${DB}/folders/${id}.json`, { method: "PUT", body: JSON.stringify(docs[id] || { name: meta(id).name, at: now() }) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      meta(id).cloud = true; saveIndex(); subscribe(id); return true;
    } catch (e) { toast("Couldn't upload the folder - check your connection.", true); return false; }
  }
  function openShared(id, folder) {
    if (!/^[A-Za-z0-9]{16,40}$/.test(id)) { toast("That folder link doesn't look right.", true); return; }
    if (!meta(id)) { index.push({ id, name: "Shared folder", cloud: true }); saveIndex(); }
    if (!CLOUD) { toast("This site isn't connected to a database, so shared folders can't be opened here.", true); }
    loadLocal(id); subscribe(id);
    go(id, folder || "root");
    openDrawer();
  }
  function removeRoot(id, everywhere) {
    const m = meta(id);
    if (streams[id]) { streams[id].close(); delete streams[id]; }
    if (everywhere && m && m.cloud && CLOUD) fetch(`${DB}/folders/${id}.json`, { method: "DELETE" }).catch(() => {});
    index = index.filter(x => x.id !== id); saveIndex();
    ls.del(K_DOC + id); delete docs[id];
    go(null);
  }
  function teamFromBoard(name, folder) {
    return { name: name || compTitle || "Untitled team", folder, t: slotsToT(slots), c: `${comp.v}-${comp.d}-${comp.s}`, notes: "", by: myName(), at: now(), upd: now() };
  }
  /* ---- the saved team currently on the board (for "Update saved team") ---- */
  let loaded = null; // { root, tid }
  const boardState = () => ({ t: slotsToT(slots), c: `${comp.v}-${comp.d}-${comp.s}`, name: compTitle });
  function loadedTeam() { if (!loaded) return null; const d = docs[loaded.root]; return (d && d.teams && d.teams[loaded.tid]) || null; }
  function refreshUpdateBtn() {
    const b = document.getElementById("updateBtn"); if (!b) return;
    const t = loadedTeam();
    if (!t) { b.hidden = true; return; }
    const s = boardState();
    const changed = s.t !== (t.t || "") || s.c !== (t.c || "2-2-2") || (!!s.name && s.name !== t.name);
    b.hidden = !changed || !s.t;
    const nm = String(t.name || "team");
    b.textContent = `Update “${nm.length > 18 ? nm.slice(0, 17) + "…" : nm}”`;
    b.title = `Save the board's changes into "${nm}"${meta(loaded.root) && meta(loaded.root).cloud ? " (live for everyone in that folder)" : ""}`;
  }
  function updateSaved(root, tid) {
    const doc = docs[root], t = doc && doc.teams && doc.teams[tid];
    if (!t) { flashStatus("That saved team no longer exists."); loaded = null; refreshUpdateBtn(); return; }
    const s = boardState();
    if (!s.t) { flashStatus("The board is empty - nothing to update with."); return; }
    // field-by-field writes, so notes/comments someone else is adding aren't overwritten
    write(root, `teams/${tid}/t`, s.t);
    write(root, `teams/${tid}/c`, s.c);
    if (s.name && s.name !== t.name) write(root, `teams/${tid}/name`, s.name.slice(0, 48));
    write(root, `teams/${tid}/upd`, now());
    if (myName()) write(root, `teams/${tid}/by`, myName());
    loaded = { root, tid };
    refreshUpdateBtn();
    flashStatus(`Updated "${s.name || t.name}".`);
    toast(`Updated "${s.name || t.name}".`);
  }
  function loadTeam(team, root, tid) {
    if (root && tid) loaded = { root, tid };
    slots = tToSlots(team.t || "");
    const c = String(team.c || "2-2-2").split("-").map(Number);
    if (c.length === 3 && c.every(x => Number.isInteger(x) && x >= 0 && x <= 6)) comp = { v: c[0], d: c[1], s: c[2] };
    compTitle = String(team.name || "").slice(0, 48);
    renderAll();
    if (window.matchMedia("(max-width:760px)").matches) closeDrawer();
    window.scrollTo({ top: 0, behavior: "smooth" });
    flashStatus(`Loaded "${team.name}".`);
  }
  function teamLink(team) {
    const p = [`t=${team.t}`];
    if (team.c && team.c !== "2-2-2") p.push(`c=${team.c}`);
    if (team.name) p.push(`n=${encodeURIComponent(team.name)}`);
    return location.origin + location.pathname + "#" + p.join("&");
  }
  function folderLink(id, folder) { return location.origin + location.pathname + "#f=" + id + (folder && folder !== "root" ? ":" + folder : ""); }
  const myName = () => ls.get(K_NAME, "") || "";

  /* ---------------- helpers for display ---------------- */
  function enhancedCount(list) {
    let lo = 0, hi = 0, n = 0, e = 0;
    for (const s of list) if (s) { const [a, b] = maskOf(s.id); lo = (lo | a) >>> 0; hi = (hi | b) >>> 0; }
    for (const s of list) if (s) { n++; const h = H[s.id], eq = equipped(s, lo, hi); if (eq >= 0 && partnerIn(h, eq, lo, hi)) e++; }
    return [e, n];
  }
  const icon = name => `avatars/Hero_Icon_${name.replace(/[ &]+/g, "_")}.webp`;
  function mini(id, cls) {
    const h = H[id];
    return `<span class="lb-av ${cls || ""}" style="--rc:${RC[h.role]}" title="${esc(h.name)}"><img src="${esc(icon(h.name))}" alt="" onerror="this.remove()"><i>${esc(h.name.slice(0, 2))}</i></span>`;
  }
  function teamStrip(t) {
    return tToSlots(t).filter(Boolean).map(s => `<span class="lb-slot">${mini(s.id)}${(s.alts || []).map(a => `<b>/</b>${mini(a, "alt")}`).join("")}</span>`).join("");
  }
  function ago(ts) {
    const s = Math.max(1, Math.round((now() - (ts || 0)) / 1000));
    if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago"; return Math.floor(s / 86400) + "d ago";
  }
  const kids = (doc, folder) => Object.entries((doc && doc.folders) || {}).filter(([, f]) => (f.parent || "root") === folder).sort((a, b) => String(a[1].name).localeCompare(String(b[1].name)));
  const teamsIn = (doc, folder) => Object.entries((doc && doc.teams) || {}).filter(([, t]) => (t.folder || "root") === folder).sort((a, b) => (b[1].upd || b[1].at || 0) - (a[1].upd || a[1].at || 0));
  function countDeep(doc, folder) {
    let f = 0, t = teamsIn(doc, folder).length;
    for (const [fid] of kids(doc, folder)) { const c = countDeep(doc, fid); f += 1 + c[0]; t += c[1]; }
    return [f, t];
  }
  function trail(doc, folder) {
    const out = [];
    let cur = folder, guard = 0;
    while (cur && cur !== "root" && guard++ < 50) { const f = doc.folders && doc.folders[cur]; if (!f) break; out.unshift([cur, f.name]); cur = f.parent || "root"; }
    return out;
  }

  /* ---------------- drawer UI ---------------- */
  const view = { root: null, folder: "root", open: {}, saving: false };
  function go(root, folder) { view.root = root; view.folder = folder || "root"; render(); }
  let toastTimer = 0;
  function toast(text, err) {
    const el = $("#lbToast"); if (!el) return;
    el.textContent = text; el.className = "lb-toast show" + (err ? " err" : "");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.className = "lb-toast"; }, 3500);
  }
  async function copy(text, okMsg) {
    try {
      // some browsers never settle the permission check: give up after 2.5 s
      await Promise.race([navigator.clipboard.writeText(text), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 2500))]);
      toast(okMsg);
    } catch (e) {
      const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch (_) {}
      ta.remove(); if (ok) toast(okMsg); else if (ask("Copy this link:", text) === null) toast("Copy this link: " + text);
    }
  }
  function openDrawer(saving) { view.saving = !!saving; $("#libDrawer").classList.add("open"); $("#libDrawer").setAttribute("aria-hidden", "false"); render(); }
  function closeDrawer() { view.saving = false; $("#libDrawer").classList.remove("open"); $("#libDrawer").setAttribute("aria-hidden", "true"); }

  function syncPill(id) {
    if (!id) return CLOUD ? `<span class="lb-pill live">Live sync on</span>` : `<span class="lb-pill">Saved in this browser</span>`;
    const m = meta(id);
    if (!m || !m.cloud) return `<span class="lb-pill">This browser only</span>`;
    const s = status[id] || "connecting";
    return s === "live" ? `<span class="lb-pill live">● Live</span>` : s === "error" ? `<span class="lb-pill err">No access</span>` : s === "missing" ? `<span class="lb-pill err">Deleted</span>` : `<span class="lb-pill">Connecting…</span>`;
  }

  function render() {
    const body = $("#libBody"); if (!body || !$("#libDrawer").classList.contains("open")) return;
    // keep what the user is typing across live re-renders
    const ae = document.activeElement, keep = ae && body.contains(ae) && ae.id ? { id: ae.id, v: ae.value, s: ae.selectionStart, e: ae.selectionEnd } : null;
    const scroll = body.scrollTop;
    body.innerHTML = view.root ? folderView() : homeView();
    if (keep) { const el = document.getElementById(keep.id); if (el) { el.value = keep.v; el.focus(); try { el.setSelectionRange(keep.s, keep.e); } catch (e) {} } }
    body.scrollTop = scroll;
  }
  // Database security rules the site expects (same as README "Live folders")
  const RULES = JSON.stringify({ rules: { folders: { $folder: {
    ".read": "$folder.length >= 20", ".write": "$folder.length >= 20",
    name: { ".validate": "newData.isString() && newData.val().length <= 60" },
    folders: { $sub: { name: { ".validate": "newData.isString() && newData.val().length <= 60" } } },
    teams: { $team: {
      name: { ".validate": "newData.isString() && newData.val().length <= 48" },
      t: { ".validate": "newData.isString() && newData.val().length <= 1500" },
      notes: { ".validate": "newData.isString() && newData.val().length <= 4000" },
      comments: { $c: { text: { ".validate": "newData.isString() && newData.val().length <= 1000" } } } } } } } } }, null, 2);
  // where the site owner edits data/cloud-config.js (GitHub Pages sites only)
  function configEditLink() {
    const m = /^([a-z0-9-]+)\.github\.io$/i.exec(location.hostname);
    const repo = location.pathname.split("/").filter(Boolean)[0];
    return m && repo && !/\.html$/.test(repo) ? `https://github.com/${m[1]}/${repo}/blob/HEAD/data/cloud-config.js` : null;
  }
  function setupGuide(open) {
    const edit = configEditLink();
    return `<details class="lb-setup"${open ? " open" : ""}><summary>How to turn on live shared folders <small>(site owner, once, ~5 min)</small></summary>
      <p>Connect a free Firebase database once and everyone using this site gets live folders: share a folder link and teams, notes and comments appear for everyone instantly. Visitors don't need accounts.</p>
      <ol>
        <li>Go to <a href="https://console.firebase.google.com" target="_blank" rel="noopener">console.firebase.google.com</a>, sign in with a Google account and press <b>Create a project</b> (any name, e.g. <i>teamup-lab</i>; Google Analytics can stay off).</li>
        <li>In the project's left menu open <b>Build → Realtime Database</b> → <b>Create database</b>. Pick the location closest to you, choose <b>Start in locked mode</b>, then <b>Enable</b>.</li>
        <li>Open the <b>Rules</b> tab, delete everything there, paste these rules and press <b>Publish</b>:
          <div class="lb-rules"><button data-act="copyrules">Copy rules</button><pre>${esc(RULES)}</pre></div></li>
        <li>Open the <b>Data</b> tab and copy the database address at the top - it looks like <code>https://teamup-lab-default-rtdb.firebaseio.com</code>.</li>
        <li>${edit ? `Open <a href="${esc(edit)}" target="_blank" rel="noopener">data/cloud-config.js</a> in this site's GitHub repository` : `In this site's GitHub repository open <code>data/cloud-config.js</code>`}, press the ✎ <b>edit</b> button, paste the address between the quotes of <code>databaseURL: ""</code> and press <b>Commit changes</b>.</li>
        <li>Wait about a minute for the site to update, reload this page, and the Library shows <span class="lb-pill live">Live sync on</span>. Folders already saved in a browser upload themselves.</li>
      </ol>
      <p class="lb-small">Privacy: nobody can browse the list of folders; each folder only opens with its long random link, and anyone with that link can view, add and comment - like a shared doc link.</p>
    </details>`;
  }
  function homeView() {
    let h = `<div class="lb-row"><label class="lb-name">Your name <input id="lbMe" maxlength="24" placeholder="for notes & comments" value="${esc(myName())}"></label>${syncPill()}</div>`;
    h += `<div class="lb-row"><input id="lbNewRoot" maxlength="60" placeholder="New folder name"><button class="lb-primary" data-act="newroot">＋ Folder</button></div>`;
    if (view.saving) h += `<p class="lb-hint">Pick (or create) a folder to save the current team into.</p>`;
    if (!index.length) h += `<p class="lb-empty">No folders yet. Create one above${CLOUD ? ", or open a folder link a friend sent you" : ""}.</p>`;
    for (const m of index) {
      const doc = docs[m.id] || loadLocal(m.id);
      const [f, t] = countDeep(doc, "root");
      h += `<button class="lb-item lb-folder" data-act="open" data-id="${m.id}"><span class="lb-ico">📁</span><span class="lb-grow"><b>${esc((doc && doc.name) || m.name)}</b><small>${t} team${t === 1 ? "" : "s"}${f ? ` · ${f} subfolder${f === 1 ? "" : "s"}` : ""}</small></span>${syncPill(m.id)}</button>`;
    }
    if (CLOUD) h += `<div class="lb-row lb-paste"><input id="lbPaste" placeholder="Paste a folder link to open it"><button data-act="paste">Open</button></div>`;
    else h += `<p class="lb-hint">Folders are saved in this browser for now. Shared, live folders need a free database - setup steps below.</p>` + setupGuide(view.showSetup);
    return h;
  }
  function folderView() {
    const id = view.root, m = meta(id), doc = docs[id] || loadLocal(id);
    if (!doc) {
      return `<div class="lb-crumbs"><button data-act="home">Library</button></div><p class="lb-empty">${status[id] === "error" ? "You don't have access to this folder, or the link is wrong." : status[id] === "missing" ? "This folder was deleted." : "Loading folder…"}</p>`;
    }
    if (view.folder !== "root" && !(doc.folders || {})[view.folder]) view.folder = "root";
    const tr = trail(doc, view.folder);
    let h = `<div class="lb-crumbs"><button data-act="home">Library</button><span>›</span><button data-act="nav" data-f="root">${esc(doc.name || "Folder")}</button>${tr.map(([fid, n]) => `<span>›</span><button data-act="nav" data-f="${fid}">${esc(n)}</button>`).join("")}${syncPill(id)}</div>`;
    const here = view.folder === "root" ? doc.name : doc.folders[view.folder].name;
    h += `<div class="lb-title"><h4>${esc(here || "Folder")}</h4><button data-act="rename" title="Rename">✎</button><button data-act="share" title="Copy a link to this folder">🔗 Share</button><button data-act="delfolder" class="lb-danger" title="Delete">🗑</button></div>`;
    const saveName = compTitle || "";
    h += `<div class="lb-save${view.saving ? " hot" : ""}"><input id="lbSaveName" maxlength="48" placeholder="Team name" value="${esc(saveName)}"><button class="lb-primary" data-act="save">Save current team here</button></div>`;
    h += `<div class="lb-row"><input id="lbNewSub" maxlength="60" placeholder="New subfolder name"><button data-act="newsub">＋ Subfolder</button></div>`;
    const subs = kids(doc, view.folder);
    for (const [fid, f] of subs) {
      const [nf, nt] = countDeep(doc, fid);
      h += `<button class="lb-item lb-folder" data-act="nav" data-f="${fid}"><span class="lb-ico">📂</span><span class="lb-grow"><b>${esc(f.name)}</b><small>${nt} team${nt === 1 ? "" : "s"}${nf ? ` · ${nf} subfolder${nf === 1 ? "" : "s"}` : ""}</small></span><span class="lb-go">›</span></button>`;
    }
    const ts = teamsIn(doc, view.folder);
    if (!subs.length && !ts.length) h += `<p class="lb-empty">Empty folder. Save the team on the board here, or add a subfolder.</p>`;
    for (const [tid, t] of ts) h += teamCard(doc, tid, t);
    return h;
  }
  function teamCard(doc, tid, t) {
    const list = tToSlots(t.t || "");
    const [e, n] = enhancedCount(list);
    const comments = Object.entries(t.comments || {}).sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
    const open = !!view.open[tid];
    let h = `<div class="lb-team${open ? " open" : ""}">
      <div class="lb-thead"><b>${esc(t.name || "Untitled")}</b><span class="lb-enh">${e}/${n} enhanced</span></div>
      <div class="lb-strip">${teamStrip(t.t || "")}</div>
      <div class="lb-meta">${t.by ? esc(t.by) + " · " : ""}${ago(t.upd || t.at)}${t.notes ? " · 📝 notes" : ""}${comments.length ? ` · 💬 ${comments.length}` : ""}</div>
      <div class="lb-acts"><button class="lb-primary" data-act="load" data-t="${tid}">Load</button><button data-act="tupdate" data-t="${tid}" title="Replace this saved team with the team on the board">↻ Update</button><button data-act="tlink" data-t="${tid}">Copy link</button><button data-act="toggle" data-t="${tid}">${open ? "Hide" : "Notes & comments"}</button><button data-act="trename" data-t="${tid}" title="Rename">✎</button><button data-act="tdel" data-t="${tid}" class="lb-danger" title="Delete">🗑</button></div>`;
    if (open) {
      const folders = [["root", doc.name || "Top level"]].concat(Object.entries(doc.folders || {}).map(([fid]) => [fid, [doc.name].concat(trail(doc, fid).map(x => x[1])).join(" › ")]));
      h += `<label class="lb-lab">Notes</label><textarea id="lbNotes_${tid}" data-t="${tid}" class="lb-notes" maxlength="4000" placeholder="Win conditions, ult combos, what to swap into…">${esc(t.notes || "")}</textarea>
        <label class="lb-lab">Comments</label><div class="lb-comments">${comments.map(([cid, c]) => `<div class="lb-c"><b>${esc(c.by || "Anonymous")}</b> <small>${ago(c.at)}</small><button class="lb-cx" data-act="cdel" data-t="${tid}" data-c="${cid}" title="Delete comment">✕</button><div>${esc(c.text || "")}</div></div>`).join("") || `<p class="lb-empty">No comments yet.</p>`}</div>
        <div class="lb-row"><input id="lbC_${tid}" maxlength="1000" placeholder="Add a comment…"><button data-act="comment" data-t="${tid}">Post</button></div>
        <label class="lb-lab">Move to</label><select data-act="move" data-t="${tid}">${folders.map(([fid, nm]) => `<option value="${fid}"${(t.folder || "root") === fid ? " selected" : ""}>${esc(nm)}</option>`).join("")}</select>`;
    }
    return h + `</div>`;
  }

  /* ---------------- events ---------------- */
  const notesTimers = {};
  function onClick(e) {
    const b = e.target.closest("[data-act]"); if (!b || b.tagName === "SELECT") return;
    const act = b.dataset.act, id = view.root, doc = id ? docs[id] : null, tid = b.dataset.t;
    const team = doc && tid ? (doc.teams || {})[tid] : null;
    switch (act) {
      case "home": go(null); break;
      case "open": go(b.dataset.id, "root"); subscribe(b.dataset.id); break;
      case "nav": go(id, b.dataset.f); break;
      case "newroot": {
        const name = ($("#lbNewRoot").value || "").trim() || "My Teams";
        createRoot(name).then(nid => go(nid, "root"));
        break;
      }
      case "paste": {
        const m = /f=([A-Za-z0-9]+)(?::([A-Za-z0-9]+))?/.exec($("#lbPaste").value || "");
        if (m) openShared(m[1], m[2]); else toast("Paste a folder link (it contains #f=…).", true);
        break;
      }
      case "newsub": {
        const name = ($("#lbNewSub").value || "").trim(); if (!name) { toast("Give the subfolder a name.", true); break; }
        const fid = rid(10); write(id, `folders/${fid}`, { name: name.slice(0, 60), parent: view.folder, at: now() });
        break;
      }
      case "save": {
        if (!slots.some(Boolean)) { toast("The board is empty - slot some heroes first.", true); break; }
        const name = ($("#lbSaveName").value || "").trim().slice(0, 48) || "Untitled team";
        const nid = rid(12); write(id, `teams/${nid}`, teamFromBoard(name, view.folder));
        loaded = { root: id, tid: nid };
        if (compTitle !== name) { compTitle = name; renderAll(); } else refreshUpdateBtn();
        view.saving = false; toast(`Saved "${name}".`);
        break;
      }
      case "rename": {
        const cur = view.folder === "root" ? doc.name : doc.folders[view.folder].name;
        const name = (ask("Rename folder", cur || "") || "").trim().slice(0, 60); if (!name) break;
        write(id, view.folder === "root" ? "name" : `folders/${view.folder}/name`, name);
        break;
      }
      case "delfolder": {
        if (view.folder === "root") {
          const shared = meta(id) && meta(id).cloud;
          if (!sure(shared ? `Delete "${doc.name}" for EVERYONE who has the link? This can't be undone.\n\n(Cancel to keep it.)` : `Delete "${doc.name}" and everything in it? This can't be undone.`)) {
            if (shared && sure(`Just remove "${doc.name}" from your library instead? It stays available to others.`)) removeRoot(id, false);
            break;
          }
          removeRoot(id, true);
        } else {
          const f = doc.folders[view.folder];
          const [nf, nt] = countDeep(doc, view.folder);
          if (!sure(`Delete "${f.name}"${nf || nt ? ` with ${nt} team(s) and ${nf} subfolder(s)` : ""}? This can't be undone.`)) break;
          const dead = new Set([view.folder]);
          let grew = true; while (grew) { grew = false; for (const [fid, x] of Object.entries(doc.folders || {})) if (!dead.has(fid) && dead.has(x.parent)) { dead.add(fid); grew = true; } }
          const parent = f.parent || "root";
          for (const [ttid, t] of Object.entries(doc.teams || {})) if (dead.has(t.folder)) write(id, `teams/${ttid}`, null);
          for (const fid of dead) write(id, `folders/${fid}`, null);
          go(id, parent);
        }
        break;
      }
      case "share": {
        const m = meta(id);
        if (!CLOUD) { view.showSetup = true; go(null); toast("Folder sharing needs the live database - see the setup steps. Team links already work (Copy link on a team).", true); break; }
        const doCopy = () => copy(folderLink(id, view.folder), "Folder link copied - anyone with it can view, add and comment, live.");
        if (m && !m.cloud) { if (sure("This folder is only in your browser. Upload it so it can be shared?")) uploadRoot(id).then(ok => { if (ok) doCopy(); }); }
        else doCopy();
        break;
      }
      case "load": if (team) loadTeam(team, id, tid); break;
      case "tupdate":
        if (!team) break;
        if (!slots.some(Boolean)) { toast("The board is empty - load or build a team first.", true); break; }
        if (sure(`Replace "${team.name}" with the team that's on the board now? Notes and comments are kept.`)) updateSaved(id, tid);
        break;
      case "tlink": if (team) copy(teamLink(team), "Team link copied."); break;
      case "toggle": view.open[tid] = !view.open[tid]; render(); break;
      case "trename": {
        if (!team) break;
        const name = (ask("Rename team", team.name || "") || "").trim().slice(0, 48); if (!name) break;
        write(id, `teams/${tid}/name`, name); write(id, `teams/${tid}/upd`, now());
        break;
      }
      case "tdel": if (team && sure(`Delete "${team.name}"? This can't be undone.`)) write(id, `teams/${tid}`, null); break;
      case "comment": {
        const inp = document.getElementById("lbC_" + tid); const text = (inp && inp.value || "").trim().slice(0, 1000);
        if (!text || !team) break;
        let who = myName();
        if (!who) { who = (ask("Your name (shown on comments)", "") || "").trim().slice(0, 24) || "Anonymous"; ls.set(K_NAME, who === "Anonymous" ? "" : who); }
        inp.value = "";
        write(id, `teams/${tid}/comments/${rid(10)}`, { by: who, text, at: now() });
        write(id, `teams/${tid}/upd`, now());
        break;
      }
      case "cdel": if (sure("Delete this comment?")) write(id, `teams/${tid}/comments/${b.dataset.c}`, null); break;
      case "copyrules": copy(RULES, "Rules copied - paste them into Firebase's Rules tab, then Publish."); break;
    }
  }
  function onInput(e) {
    const el = e.target;
    if (el.id === "lbMe") { ls.set(K_NAME, el.value.trim().slice(0, 24)); return; }
    if (el.classList.contains("lb-notes")) {
      const tid = el.dataset.t, id = view.root;
      clearTimeout(notesTimers[tid]);
      notesTimers[tid] = setTimeout(() => { write(id, `teams/${tid}/notes`, el.value.slice(0, 4000)); write(id, `teams/${tid}/upd`, now()); }, 700);
    }
  }
  function onChange(e) {
    const el = e.target;
    if (el.dataset && el.dataset.act === "move") { write(view.root, `teams/${el.dataset.t}/folder`, el.value); }
  }
  function onKey(e) {
    if (e.key !== "Enter" || e.target.tagName !== "INPUT") return;
    const map = { lbNewRoot: "newroot", lbNewSub: "newsub", lbSaveName: "save", lbPaste: "paste" };
    const act = map[e.target.id] || (e.target.id.startsWith("lbC_") ? "comment" : null);
    if (!act) return;
    const btn = $(`#libBody [data-act="${act}"]${act === "comment" ? `[data-t="${e.target.id.slice(4)}"]` : ""}`);
    if (btn) btn.click();
  }

  /* ---------------- mount ---------------- */
  const css = `
  .lib-drawer{position:fixed;top:0;right:0;bottom:0;width:min(460px,100vw);z-index:60;background:var(--panel);border-left:1px solid var(--line);box-shadow:-20px 0 60px rgba(0,0,0,.45);transform:translateX(105%);transition:transform .18s ease;display:flex;flex-direction:column}
  .lib-drawer.open{transform:none}
  .lib-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--line)}
  .lib-head h3{font-size:14px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);flex:1}
  .lib-body{flex:1;overflow:auto;padding:12px 14px 40px;scrollbar-width:thin}
  .lb-row{display:flex;gap:6px;margin-bottom:8px;align-items:center}
  .lb-row input,.lb-save input,.lib-drawer textarea,.lib-drawer select{flex:1;min-width:0;font:inherit;font-size:13px;color:var(--ink);background:#0f1428;border:1px solid var(--line);border-radius:7px;padding:6px 8px}
  .lib-drawer button{font-size:12.5px;padding:5px 10px}
  .lib-drawer .lb-primary{background:linear-gradient(180deg,#7c5cf0,#5b3fd0);border-color:#8f74ff;font-weight:600}
  .lib-drawer .lb-danger:hover{border-color:var(--duel);color:var(--duel)}
  .lb-name{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dim);flex:1}
  .lb-item{display:flex;align-items:center;gap:10px;width:100%;text-align:left;margin-bottom:6px;padding:9px 10px !important;background:var(--panel2)}
  .lb-item .lb-grow{flex:1;min-width:0;display:flex;flex-direction:column}
  .lb-item small{color:var(--faint);font-size:11.5px}
  .lb-ico{font-size:18px}
  .lb-go{color:var(--faint);font-size:18px}
  .lb-pill{font-size:10.5px;letter-spacing:.06em;padding:1px 8px;border-radius:20px;border:1px solid var(--line);color:var(--dim);white-space:nowrap}
  .lb-pill.live{color:var(--strat);border-color:color-mix(in srgb,var(--strat) 50%,transparent)}
  .lb-pill.err{color:var(--duel);border-color:color-mix(in srgb,var(--duel) 50%,transparent)}
  .lb-crumbs{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:8px;font-size:12px}
  .lb-crumbs button{background:none;border:none;padding:2px 4px !important;color:var(--grant)}
  .lb-crumbs span{color:var(--faint)}
  .lb-crumbs .lb-pill{margin-left:auto}
  .lb-title{display:flex;align-items:center;gap:6px;margin:4px 0 10px}
  .lb-title h4{font-family:"Chakra Petch";font-size:18px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .lb-save{display:flex;gap:6px;margin-bottom:8px;padding:8px;border:1px dashed var(--line);border-radius:9px}
  .lb-save.hot{border-color:var(--syn);box-shadow:0 0 0 1px var(--syn)}
  .lb-team{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:9px 10px;margin-bottom:8px}
  .lb-team.open{border-color:color-mix(in srgb,var(--syn) 50%,var(--line))}
  .lb-thead{display:flex;align-items:baseline;gap:8px}
  .lb-thead b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .lb-enh{font-size:11px;color:var(--syn)}
  .lb-strip{display:flex;flex-wrap:wrap;gap:4px;margin:7px 0 5px}
  .lb-slot{display:inline-flex;align-items:center;gap:2px}
  .lb-slot b{color:var(--grant);font-size:11px}
  .lb-av{position:relative;width:30px;height:30px;border-radius:7px;overflow:hidden;background:#0f1428;border:1px solid var(--rc);display:inline-flex;align-items:center;justify-content:center}
  .lb-av.alt{width:24px;height:24px;opacity:.85;border-style:dashed}
  .lb-av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .lb-av i{font-style:normal;font-size:10px;color:var(--rc);font-weight:700}
  .lb-meta{font-size:11.5px;color:var(--faint);margin-bottom:6px}
  .lb-acts{display:flex;gap:5px;flex-wrap:wrap}
  .lb-lab{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);margin:10px 0 4px}
  .lib-drawer textarea{width:100%;min-height:70px;resize:vertical}
  .lb-comments{display:flex;flex-direction:column;gap:6px;margin-bottom:6px;max-height:240px;overflow:auto}
  .lb-c{background:#10152a;border:1px solid var(--line);border-radius:8px;padding:6px 8px;font-size:13px;position:relative}
  .lb-c small{color:var(--faint);font-size:11px}
  .lb-c .lb-cx{position:absolute;top:4px;right:4px;border:none;background:none;color:var(--faint);padding:0 4px !important;font-size:11px}
  .lb-empty,.lb-hint{color:var(--faint);font-size:12.5px;margin:8px 0}
  .lb-hint{color:var(--dim)}
  .lb-toast{position:absolute;left:14px;right:14px;bottom:12px;padding:8px 10px;border-radius:8px;background:#10301f;border:1px solid var(--strat);color:#bff3e2;font-size:12.5px;opacity:0;pointer-events:none;transition:opacity .15s}
  .lb-toast.err{background:#3a1418;border-color:var(--duel);color:#ffd0d0}
  .lb-toast.show{opacity:1}
  .lb-setup{margin-top:12px;border:1px solid color-mix(in srgb,var(--grant) 45%,var(--line));border-radius:10px;padding:8px 10px;background:color-mix(in srgb,var(--grant) 6%,transparent);font-size:12.5px;color:var(--dim)}
  .lb-setup summary{cursor:pointer;color:var(--ink);font-weight:600}
  .lb-setup summary small{color:var(--faint);font-weight:400}
  .lb-setup p{margin:8px 0}
  .lb-setup ol{margin:6px 0 4px 18px;display:flex;flex-direction:column;gap:7px}
  .lb-setup b{color:var(--ink)}
  .lb-setup a{color:var(--grant)}
  .lb-setup code{font-size:11.5px;background:#0f1428;border:1px solid var(--line);border-radius:4px;padding:0 4px;word-break:break-all}
  .lb-rules{position:relative;margin-top:6px}
  .lb-rules pre{max-height:180px;overflow:auto;font-size:11px;line-height:1.4;background:#0b0f20;border:1px solid var(--line);border-radius:7px;padding:8px;color:#bcc6e6}
  .lb-rules button{position:absolute;top:6px;right:6px}
  .lb-small{font-size:11.5px;color:var(--faint)}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  const dr = document.createElement("aside");
  dr.className = "lib-drawer"; dr.id = "libDrawer"; dr.setAttribute("aria-label", "Library"); dr.setAttribute("aria-hidden", "true");
  dr.innerHTML = `<div class="lib-head"><h3>Library</h3><button id="libClose" aria-label="Close library">✕</button></div><div class="lib-body" id="libBody"></div><div class="lb-toast" id="lbToast" role="status"></div>`;
  document.body.appendChild(dr);
  $("#libClose").onclick = closeDrawer;
  dr.addEventListener("click", onClick);
  dr.addEventListener("input", onInput);
  dr.addEventListener("change", onChange);
  dr.addEventListener("keydown", onKey);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && dr.classList.contains("open") && altPick == null) closeDrawer(); });
  const libBtn = document.getElementById("libraryBtn"); if (libBtn) libBtn.onclick = () => dr.classList.contains("open") ? closeDrawer() : openDrawer();
  const saveBtn = document.getElementById("saveBtn"); if (saveBtn) saveBtn.onclick = () => {
    if (!slots.some(Boolean)) { flashStatus("Slot some heroes first, then save."); return; }
    if (!view.root && index.length === 1) go(index[0].id, "root");
    openDrawer(true);
  };
  setInterval(() => { if (dr.classList.contains("open") && !(document.activeElement && dr.contains(document.activeElement))) render(); }, 30000); // refresh "x min ago"

  // "Update saved team" button next to Save/Share: shown when the board differs
  // from the saved team it was loaded from (or last saved as)
  const updBtn = document.getElementById("updateBtn");
  if (updBtn) updBtn.onclick = () => { if (loaded) updateSaved(loaded.root, loaded.tid); };
  const baseRenderAll = window.renderAll;
  window.renderAll = function () { baseRenderAll.apply(this, arguments); refreshUpdateBtn(); };

  // live folders this browser knows about stream in the background
  index.forEach(m => { loadLocal(m.id); subscribe(m.id); });
  // folders made before the site was connected to the database upload themselves
  if (CLOUD) {
    const pending = index.filter(m => !m.cloud);
    if (pending.length) Promise.all(pending.map(m => uploadRoot(m.id))).then(res => {
      const n = res.filter(Boolean).length;
      if (n) { flashStatus(`${n} saved folder${n === 1 ? " is" : "s are"} now synced online.`); toast(`${n} folder${n === 1 ? "" : "s"} uploaded - now live and shareable.`); render(); }
    });
  }
  // a folder link opened the page
  if (window.LIB_LINK) { const [fid, sub] = String(window.LIB_LINK).split(":"); openShared(fid, sub); }
  window.addEventListener("hashchange", () => {
    const m = /(?:^#|&)f=([A-Za-z0-9]+)(?::([A-Za-z0-9]+))?/.exec(location.hash);
    if (m) openShared(m[1], m[2]);
  });
  window.TUL_LIBRARY = { open: openDrawer, close: closeDrawer, cloud: CLOUD };
})();
