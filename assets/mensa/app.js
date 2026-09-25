/*
 * Mensa-Ranking – App
 * Datenquelle: separates Supabase-Projekt (Tabellen mensa_*, Bucket mensa-photos; siehe _supabase/mensa_v1.sql).
 * Lesen und Schreiben nur für Mitglieder – durchgesetzt von Supabase (RLS), nicht von dieser Seite.
 */
(function () {
  'use strict';

  const L = window.MensaLogic;
  const CFG = window.MENSA_CONFIG || {};
  const BUCKET = 'mensa-photos';
  const UNDO_MINUTES = 15;          // so lange dürfen eigene Einträge geändert/gelöscht werden (siehe RLS)
  const LOAD_TIMEOUT = 15000;
  const UPLOAD_TIMEOUT = 60000;
  const URL_TTL = 24 * 3600;        // signierte Foto-Links gelten 1 Tag
  const PAGE = 30;
  const SERVING_COLS = 'id,dish_id,canteen_id,served_on,price_cents,note,photo_path,thumb_path,created_by,created_at';
  const LS = { cache: 'mensa.cache.v1', urls: 'mensa.urls.v1', canteen: 'mensa.canteen' };

  const configured = !!(CFG.url && CFG.key && window.supabase && L);
  const sb = configured ? window.supabase.createClient(CFG.url, CFG.key) : null;

  const TABS = { today: 'heute', entry: 'eintragen', history: 'verlauf', account: 'konto', login: 'anmelden' };
  const MEMBER_TABS = ['today', 'entry', 'history', 'dish'];

  const S = {
    user: null, me: { member: false, admin: false, name: null },
    booted: false, loaded: false, fromCache: false, error: null, loadedAt: 0, live: false,
    canteens: [], dishes: new Map(), servings: new Map(), stats: new Map(), mine: new Map(), members: new Map(),
    tab: 'today', dishId: null, highlight: null,
    hist: { q: '', range: '30', date: '', canteen: '', view: 'entries', limit: PAGE },
    form: null,
    busyVotes: new Set(), uploads: new Map(), fileTarget: null
  };

  // ── Helfer ────────────────────────────────────────────────────────────────
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => L.isoDate();
  const statsOf = id => L.summarize(S.stats.get(id));
  const allServings = () => Array.from(S.servings.values());
  const allDishes = () => Array.from(S.dishes.values());
  const dishName = id => S.dishes.get(id)?.name ?? 'Unbekanntes Gericht';
  const canteenName = id => S.canteens.find(c => c.id === id)?.name ?? '';
  const activeCanteens = () => S.canteens.filter(c => c.active);
  const byCreated = (a, b) => String(a.created_at).localeCompare(String(b.created_at));
  const priceInput = cents => (cents == null ? '' : L.formatPrice(cents).replace(' €', ''));

  function servedCount() {
    const m = new Map();
    for (const s of S.servings.values()) m.set(s.dish_id, (m.get(s.dish_id) || 0) + 1);
    return m;
  }

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* voll oder gesperrt – egal */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* egal */ } }
  };

  function withTimeout(p, ms = LOAD_TIMEOUT) {
    let t;
    return Promise.race([
      Promise.resolve(p),
      new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error('Zeitüberschreitung'), { code: 'TIMEOUT' })), ms); })
    ]).finally(() => clearTimeout(t));
  }
  async function run(builder, ms) {
    const { data, error } = await withTimeout(builder, ms);
    if (error) throw error;
    return data;
  }

  function errText(e) {
    const msg = String(e?.message || e || '');
    if (!navigator.onLine) return 'Keine Internetverbindung.';
    if (e?.code === 'TIMEOUT') return 'Keine Antwort – schlechter Empfang? Bitte nochmal versuchen.';
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return 'Verbindung fehlgeschlagen – bitte nochmal versuchen.';
    if (/row-level security|permission denied/i.test(msg)) return 'Dafür fehlen dir die Rechte.';
    if (e?.code === '23505' && /duplicate key/i.test(msg)) return 'Das gibt es so schon.';
    if (e?.code === '23514') return 'Eine Eingabe ist ungültig.';
    if (e?.code === 'PGRST116') return 'Nicht (mehr) möglich – eigene Einträge lassen sich nur 15 Minuten lang ändern.';
    if (/JWT|refresh token/i.test(msg)) return 'Anmeldung abgelaufen – bitte neu anmelden.';
    return msg || 'Unbekannter Fehler.';
  }

  // ── Zwischenspeicher: letzter Stand sofort, auch bei schlechtem Empfang ───
  function applyData(d) {
    S.canteens = d.canteens || [];
    S.dishes = new Map((d.dishes || []).map(x => [x.id, x]));
    S.servings = new Map((d.servings || []).map(x => [x.id, x]));
    S.stats = new Map((d.stats || []).map(x => [x.serving_id, x]));
    S.mine = new Map(d.mine || []);
    S.members = new Map(d.members || []);
  }
  function saveCache() {
    if (!S.user || !S.loaded || !S.me.member) return;
    store.set(LS.cache, {
      uid: S.user.id, at: S.loadedAt, me: S.me, canteens: S.canteens, dishes: allDishes(), servings: allServings(),
      stats: Array.from(S.stats.values()), mine: Array.from(S.mine.entries()), members: Array.from(S.members.entries())
    });
  }
  let cacheTimer = null;
  const saveCacheSoon = () => { clearTimeout(cacheTimer); cacheTimer = setTimeout(saveCache, 800); };
  function loadCache() {
    const c = store.get(LS.cache);
    if (!c || !S.user || c.uid !== S.user.id) return false;
    applyData(c);
    S.me = c.me || S.me;
    S.loaded = true; S.fromCache = true; S.loadedAt = c.at || 0;
    return true;
  }
  function clearData() {
    applyData({});
    S.loaded = false; S.fromCache = false; S.error = null; S.loadedAt = 0;
    S.form = null; S.uploads.clear(); S.busyVotes.clear();
  }

  // ── Fotos: private Dateien über signierte Links ───────────────────────────
  const urls = new Map();       // Pfad → { url, exp, local }
  const urlPending = new Set();
  const urlRetried = new Set();
  const urlMissing = new Set();  // Datei gibt es nicht (mehr) – nicht endlos neu anfragen
  const markFailed = p => $$(`img[data-path="${CSS.escape(p)}"]`).forEach(img => img.parentElement?.classList.add('mr-photo-failed'));
  function loadUrlCache() {
    const o = store.get(LS.urls) || {};
    const min = Date.now() + 3600e3;
    for (const [p, v] of Object.entries(o)) if (v && v.exp > min) urls.set(p, v);
  }
  function saveUrlCache() {
    const o = {};
    for (const [p, v] of urls) if (!v.local) o[p] = v;
    store.set(LS.urls, o);
  }
  function hydratePhotos(root = document) {
    if (!sb || !S.user) return;
    const missing = [];
    for (const img of $$('img[data-path]', root)) {
      const p = img.dataset.path;
      const u = urls.get(p);
      if (u && u.exp > Date.now() + 60e3) { if (img.getAttribute('src') !== u.url) img.src = u.url; }
      else if (urlMissing.has(p)) img.parentElement?.classList.add('mr-photo-failed');
      else missing.push(p);
    }
    if (missing.length) requestUrls(missing);
  }
  async function requestUrls(paths) {
    paths = Array.from(new Set(paths)).filter(p => !urlPending.has(p));
    if (!paths.length) return;
    paths.forEach(p => urlPending.add(p));
    try {
      const data = await run(sb.storage.from(BUCKET).createSignedUrls(paths, URL_TTL));
      const exp = Date.now() + URL_TTL * 1000;
      const got = new Set();
      for (const d of data || []) if (d.signedUrl && !d.error) { urls.set(d.path, { url: d.signedUrl, exp }); got.add(d.path); }
      paths.filter(p => !got.has(p)).forEach(p => { urlMissing.add(p); markFailed(p); });
      saveUrlCache();
      paths.forEach(p => urlPending.delete(p));
      hydratePhotos();
    } catch (e) {
      // Netz weg o. Ä.: beim nächsten Neuzeichnen wieder versuchen, nicht sofort
      console.warn('Foto-Links', e);
      paths.forEach(p => { urlPending.delete(p); markFailed(p); });
    }
  }

  // Foto im Browser verkleinern und neu als JPEG kodieren – dabei fallen EXIF-/GPS-Daten weg.
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const src = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(src); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('Dieses Bildformat kann dein Browser nicht öffnen – bitte ein JPEG-Foto wählen.')); };
      img.src = src;
    });
  }
  function encode(img, max, quality) {
    const { w, h } = L.fitSize(img.naturalWidth, img.naturalHeight, max);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return new Promise((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Foto konnte nicht verarbeitet werden.'))), 'image/jpeg', quality));
  }
  async function processPhoto(file) {
    if (file.type && !file.type.startsWith('image/')) throw new Error('Das ist kein Foto.');
    if (file.size > 40e6) throw new Error('Das Foto ist zu groß.');
    const img = await loadImage(file);
    const full = await encode(img, 1280, 0.8);
    const thumb = await encode(img, 400, 0.72);
    if (full.size > 3e6) throw new Error('Das Foto ist auch verkleinert noch zu groß.');
    return { full, thumb, preview: URL.createObjectURL(full) };
  }
  function randomId() {
    return Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join('');
  }
  async function uploadPhoto(servingId, photo) {
    const p = L.photoPaths(S.user.id, servingId, randomId());
    const bucket = sb.storage.from(BUCKET);
    const opts = { contentType: 'image/jpeg', cacheControl: '604800', upsert: false };
    await run(bucket.upload(p.thumb, photo.thumb, opts), UPLOAD_TIMEOUT);
    try {
      await run(bucket.upload(p.photo, photo.full, opts), UPLOAD_TIMEOUT);
      await run(sb.rpc('mensa_set_photo', { p_serving_id: servingId, p_photo_path: p.photo, p_thumb_path: p.thumb }));
    } catch (e) {
      bucket.remove([p.photo, p.thumb]).catch(() => {});
      throw e;
    }
    const s = S.servings.get(servingId);
    if (s) { s.photo_path = p.photo; s.thumb_path = p.thumb; }
    const exp = Date.now() + 6 * 3600e3;
    urls.set(p.photo, { url: photo.preview, exp, local: true });
    urls.set(p.thumb, { url: photo.preview, exp, local: true });
  }
  async function startUpload(id, photo) {
    S.uploads.set(id, { photo, state: 'uploading' });
    update();
    try {
      await uploadPhoto(id, photo);
      S.uploads.delete(id);
      saveCacheSoon();
    } catch (e) {
      console.error(e);
      if (S.servings.has(id)) {
        S.uploads.set(id, { photo, state: 'failed' });
        toast('Foto nicht hochgeladen: ' + errText(e));
      } else S.uploads.delete(id);
    }
    update();
  }
  function pickPhoto(target) {
    S.fileTarget = target;
    const input = $('#mr-file');
    input.value = '';
    input.click();
  }
  async function onFile(input) {
    const file = input.files && input.files[0];
    const target = S.fileTarget;
    S.fileTarget = null;
    if (!file || target == null) return;
    if (target === 'form') {
      const F = S.form;
      if (!F) return;
      F.photoBusy = true; F.photoError = '';
      renderPhotoPick();
      F.photoTask = processPhoto(file)
        .then(p => { if (F.photo) URL.revokeObjectURL(F.photo.preview); F.photo = p; })
        .catch(e => { F.photoError = e.message; })
        .finally(() => { F.photoBusy = false; F.photoTask = null; if (S.form === F) renderPhotoPick(); });
      return;
    }
    try { startUpload(target, await processPhoto(file)); }
    catch (e) { toast(e.message); }
  }

  // ── Daten laden ───────────────────────────────────────────────────────────
  async function fetchAll(make, order) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const data = await run(make().order(order, { ascending: true }).range(from, from + 999));
      out.push(...data);
      if (data.length < 1000) return out;
    }
  }
  let loading = null;
  function loadAll() {
    if (loading) return loading;
    loading = (async () => {
      try {
        const [canteens, dishes, servings, stats, votes, members] = await Promise.all([
          fetchAll(() => sb.from('mensa_canteens').select('id,name,openmensa_id,active'), 'id'),
          fetchAll(() => sb.from('mensa_dishes').select('id,name,created_at'), 'id'),
          fetchAll(() => sb.from('mensa_servings').select(SERVING_COLS), 'id'),
          fetchAll(() => sb.rpc('mensa_serving_stats'), 'serving_id'),
          fetchAll(() => sb.from('mensa_votes').select('serving_id,rating,filling'), 'serving_id'),
          fetchAll(() => sb.from('mensa_members').select('user_id,display_name'), 'user_id')
        ]);
        applyData({
          canteens, dishes, servings, stats,
          mine: votes.map(v => [v.serving_id, { rating: v.rating, filling: v.filling }]),
          members: members.map(m => [m.user_id, m.display_name])
        });
        S.loaded = true; S.fromCache = false; S.error = null; S.loadedAt = Date.now();
        saveCache();
      } catch (e) {
        console.error(e);
        S.error = e;
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  async function refreshMe() {
    try {
      S.me = await run(sb.rpc('mensa_me'));
      S.error = null;
    } catch (e) {
      console.error(e);
      S.error = e;
    }
  }

  async function reload(showLoading) {
    if (showLoading) { S.booted = false; render(); }
    await afterLogin();
    S.booted = true;
    render();
  }

  async function afterLogin() {
    await refreshMe();
    if (S.me.member) {
      await loadAll();
      subscribe();
    } else if (!S.error) {
      clearData();
      store.del(LS.cache);
    }
  }

  // ── Live-Updates ──────────────────────────────────────────────────────────
  let channel = null;
  const pend = { stats: new Set(), dishes: new Set() };
  let pendTimer = null;
  function subscribe() {
    if (channel || !sb) return;
    channel = sb.channel('mensa-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mensa_servings' }, onServingChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mensa_dishes' }, onDishChange)
      .subscribe(status => { S.live = status === 'SUBSCRIBED'; });
  }
  function unsubscribe() {
    if (channel) { sb.removeChannel(channel); channel = null; S.live = false; }
  }
  function onServingChange(p) {
    if (p.eventType === 'DELETE') {
      const id = p.old && p.old.id;
      if (id != null) { S.servings.delete(id); S.stats.delete(id); S.mine.delete(id); }
      return queueRefresh();
    }
    const row = p.new;
    if (!row || row.id == null) return;
    S.servings.set(row.id, row);
    if (!S.dishes.has(row.dish_id)) pend.dishes.add(row.dish_id);
    pend.stats.add(row.id);
    queueRefresh();
  }
  function onDishChange(p) {
    if (p.eventType === 'DELETE') { if (p.old) S.dishes.delete(p.old.id); }
    else if (p.new && p.new.id != null) S.dishes.set(p.new.id, { id: p.new.id, name: p.new.name, created_at: p.new.created_at });
    queueRefresh();
  }
  function queueRefresh() {
    clearTimeout(pendTimer);
    pendTimer = setTimeout(flushRefresh, 500);
  }
  async function flushRefresh() {
    const ids = Array.from(pend.stats), dishIds = Array.from(pend.dishes);
    pend.stats.clear(); pend.dishes.clear();
    try {
      if (ids.length) {
        const rows = await run(sb.rpc('mensa_serving_stats', { p_ids: ids }));
        ids.forEach(id => S.stats.delete(id));
        rows.forEach(r => S.stats.set(r.serving_id, r));
      }
      if (dishIds.length) {
        const rows = await run(sb.from('mensa_dishes').select('id,name,created_at').in('id', dishIds));
        rows.forEach(d => S.dishes.set(d.id, d));
      }
    } catch (e) { console.warn(e); }
    saveCacheSoon();
    update();
  }

  // ── Rahmen ────────────────────────────────────────────────────────────────
  function render() {
    const root = $('#mr');
    const member = !!(S.user && S.me.member);
    if (!configured || !S.user) S.tab = 'login';
    else if (S.booted && !member) S.tab = 'account';
    else if (S.tab === 'login') S.tab = 'today';

    $('#mr-tabs').hidden = !member;
    $$('.mr-tabs [data-tab]').forEach(b => b.setAttribute('aria-current', b.dataset.tab === S.tab ? 'page' : 'false'));
    $$('.mr-panel', root).forEach(p => { p.hidden = p.dataset.panel !== S.tab; });
    renderStatus();
    renderBanner();
    $('#mr-auth').innerHTML = S.user && S.booted
      ? `<button type="button" class="mr-link" data-tab="account">${esc(S.me.name || 'Konto')}</button>` : '';

    const panel = root.querySelector(`[data-panel="${S.tab}"]`);
    if (!configured) return renderUnconfigured(panel);
    if (S.user && !S.booted && !S.loaded) { panel.innerHTML = '<p class="mr-empty">Lädt …</p>'; return; }
    if (MEMBER_TABS.includes(S.tab) && !S.loaded) {
      panel.innerHTML = S.error ? errorCard() : '<p class="mr-empty">Lädt …</p>';
      return;
    }
    keepPhotos(panel, () =>
      ({ today: renderToday, entry: renderEntry, history: renderHistory, dish: renderDish, account: renderAccount, login: renderLogin })[S.tab](panel));
  }

  // Beim Neuzeichnen schon geladene Fotos weiterverwenden – sonst blitzen sie nach jeder Stimme leer auf
  function keepPhotos(el, draw) {
    const loaded = new Map();
    for (const img of $$('img[data-path]', el)) if (img.complete && img.naturalWidth) loaded.set(img.dataset.path, img);
    draw();
    for (const img of $$('img[data-path]', el)) {
      const old = loaded.get(img.dataset.path);
      if (old) { img.replaceWith(old); loaded.delete(img.dataset.path); }
    }
    hydratePhotos(el);
  }

  // Nach Datenänderungen neu zeichnen, ohne Eingaben unter den Fingern zu zerstören
  function update() {
    renderStatus();
    renderBanner();
    if (!S.me.member) return;
    if (S.tab === 'entry') return renderDishInfo();
    if (S.tab === 'history') return renderHistResults();
    if (S.tab === 'today' || S.tab === 'dish') {
      const y = window.scrollY;
      render();
      window.scrollTo(0, y);
    }
  }

  function renderStatus() {
    let t;
    if (!configured) t = 'Wird gerade eingerichtet';
    else if (!S.user) t = 'Nur für unsere Mensa-Gruppe';
    else if (!S.booted && !S.loaded) t = 'Lädt …';
    else if (!S.me.member) t = 'Noch nicht freigeschaltet';
    else if (!S.loaded) t = S.error ? 'Keine Verbindung' : 'Lädt …';
    else {
      const n = allServings().filter(s => s.served_on === today()).length;
      const act = activeCanteens();
      t = `${act.length === 1 ? act[0].name : 'Heidelberg'} · heute ${n === 0 ? 'noch nichts' : n === 1 ? '1 Essen' : n + ' Essen'}`;
    }
    $('#mr-status').textContent = t;
  }

  function renderBanner() {
    const el = $('#mr-offline');
    if (!navigator.onLine) {
      el.textContent = 'Offline – du siehst den zuletzt geladenen Stand.';
      el.hidden = false;
    } else if (S.loaded && S.error) {
      el.innerHTML = 'Aktualisieren hat nicht geklappt – du siehst den zuletzt geladenen Stand. <button type="button" class="mr-link" data-action="reload">Erneut versuchen</button>';
      el.hidden = false;
    } else el.hidden = true;
  }

  function setTab(tab, { push = false } = {}) {
    S.tab = tab;
    const hash = tab === 'dish' ? '#gericht-' + S.dishId : '#' + TABS[tab];
    if (location.hash !== hash) {
      if (push) history.pushState({ mr: 1 }, '', hash);
      else history.replaceState(null, '', hash);
    }
    const hl = S.highlight;
    if (hl == null) window.scrollTo({ top: Math.min(window.scrollY, $('#mr').offsetTop), behavior: 'auto' });
    render();
  }
  function routeFromHash() {
    const h = decodeURIComponent(location.hash.slice(1));
    const m = /^gericht-(\d+)$/.exec(h);
    if (m) { S.dishId = Number(m[1]); S.tab = 'dish'; return; }
    S.tab = Object.keys(TABS).find(k => TABS[k] === h) || 'today';
  }
  function openDish(id) {
    S.dishId = id;
    setTab('dish', { push: true });
  }
  function goBack() {
    if (history.state && history.state.mr) history.back();
    else setTab('today');
  }
  function flashHighlight(panel) {
    if (S.highlight == null) return;
    const el = panel.querySelector(`[data-card="${S.highlight}"]`);
    S.highlight = null;
    if (!el) return;
    el.classList.add('mr-highlight');
    requestAnimationFrame(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }

  function errorCard() {
    return `<div class="mr-card mr-pad mr-error"><h2>Daten konnten nicht geladen werden</h2>
      <p>${esc(errText(S.error))}</p>
      <p class="mr-sub">Kostenlose Supabase-Projekte pausieren nach einer Woche ohne Nutzung – dann im Supabase-Dashboard „Restore“ klicken.</p>
      <button type="button" class="mr-btn mr-btn-primary" data-action="reload">Erneut versuchen</button></div>`;
  }

  function renderUnconfigured(panel) {
    panel.innerHTML = `<div class="mr-card mr-pad"><h2>Gleich geht's los</h2>
      <p>Das Mensa-Ranking wird gerade eingerichtet. Schau später nochmal vorbei.</p></div>`;
  }

  // ── Heute ─────────────────────────────────────────────────────────────────
  function renderToday(panel) {
    const t = today();
    const list = allServings().filter(s => s.served_on === t);
    let html = '';
    if (!list.length) {
      html += `<div class="mr-card mr-empty-card"><h2>Heute noch nichts eingetragen</h2>
        <p>Wer gerade in der Mensa sitzt: Foto machen, Gericht eintragen – dauert unter einer Minute.</p>
        <button type="button" class="mr-btn mr-btn-primary" data-tab="entry">📷 Essen eintragen</button></div>`;
      const prev = allServings().filter(s => s.served_on < t).reduce((m, s) => (s.served_on > m ? s.served_on : m), '');
      if (prev) {
        html += `<h2 class="mr-section">Zuletzt: ${esc(L.dayLabel(prev))}</h2>`;
        html += allServings().filter(s => s.served_on === prev).sort(byCreated).map(s => servingCard(s)).join('');
      }
    } else {
      const multi = new Set(list.map(s => s.canteen_id)).size > 1;
      list.sort((a, b) => (multi ? canteenName(a.canteen_id).localeCompare(canteenName(b.canteen_id), 'de') : 0) || byCreated(a, b));
      let last = null;
      for (const s of list) {
        if (multi && s.canteen_id !== last) { html += `<h2 class="mr-section">${esc(canteenName(s.canteen_id))}</h2>`; last = s.canteen_id; }
        html += servingCard(s);
      }
      html += `<p class="mr-sub" style="text-align:center"><button type="button" class="mr-link" data-tab="history">Frühere Tage im Verlauf →</button></p>`;
    }
    panel.innerHTML = html;
    flashHighlight(panel);
  }

  function canEdit(s) {
    if (!S.user) return false;
    return S.me.admin || (s.created_by === S.user.id && Date.now() - Date.parse(s.created_at) < UNDO_MINUTES * 60e3);
  }

  function servingCard(s, { compact = false } = {}) {
    const name = dishName(s.dish_id);
    const st = statsOf(s.id);
    const mine = S.mine.get(s.id);
    const up = S.uploads.get(s.id);
    const by = S.members.get(s.created_by);
    const meta = [canteenName(s.canteen_id), L.dayLabel(s.served_on), s.price_cents != null ? L.formatPrice(s.price_cents) : '']
      .filter(Boolean).map(esc).join(' · ');

    let photo;
    if (up) {
      photo = `<div class="mr-photo"><img src="${up.photo.preview}" alt="Foto: ${esc(name)}">${up.state === 'failed'
        ? `<div class="mr-photo-state"><span>Foto nicht hochgeladen</span><button type="button" class="mr-link" data-action="retry-photo" data-id="${s.id}">Erneut versuchen</button></div>`
        : '<div class="mr-photo-state"><span>Foto wird hochgeladen …</span></div>'}</div>`;
    } else if (s.photo_path) {
      photo = `<div class="mr-photo"><img data-path="${esc(compact ? s.thumb_path : s.photo_path)}" alt="Foto: ${esc(name)}" loading="lazy" decoding="async"></div>`;
    } else {
      photo = `<div class="mr-photo mr-photo-empty"><span>Noch kein Foto</span>
        <button type="button" class="mr-btn mr-btn-ghost mr-btn-small" data-action="add-photo" data-id="${s.id}">📷 Foto hinzufügen</button></div>`;
    }

    const score = st.votes
      ? `<div class="mr-score"><span class="mr-avg">${L.formatAvg(st.avg)}</span><span class="mr-of">/10</span>
          <span class="mr-count">${L.votesLabel(st.votes)}</span>${st.few ? '<span class="mr-few">wenige Stimmen</span>' : ''}</div>`
      : '<div class="mr-score"><span class="mr-unrated">Noch nicht<br>bewertet</span></div>';

    let hist = '';
    if (!compact) {
      const h = L.dishHistory(s, allServings(), statsOf);
      hist = h.servings
        ? `<p class="mr-history">Früher (${h.servings}×, zuletzt ${esc(L.dayLabel(h.last))}): <strong>${h.votes ? L.scoreText(h) : 'nicht bewertet'}</strong>${h.few ? ' · wenige Stimmen' : ''} · <a href="#gericht-${s.dish_id}" data-dish="${s.dish_id}">alle</a></p>`
        : '<p class="mr-new">Zum ersten Mal eingetragen.</p>';
    }

    const note = s.note
      ? `<p class="mr-note">„${esc(s.note)}“${by ? ' – ' + esc(by) : ''}</p>`
      : by ? `<p class="mr-meta">eingetragen von ${esc(by)}</p>` : '';

    return `<article class="mr-card${compact ? ' mr-compact' : ''}" data-card="${s.id}">${photo}<div class="mr-body">
      <div class="mr-headrow"><div><h3 class="mr-dish"><a href="#gericht-${s.dish_id}" data-dish="${s.dish_id}">${esc(name)}</a></h3>
      <p class="mr-meta">${meta}</p></div>${score}</div>
      ${note}${hist}${voteBlock(s, mine, st)}${actionsBlock(s)}</div></article>`;
  }

  function voteBlock(s, mine, st) {
    if (s.served_on > today()) return '';
    const busy = S.busyVotes.has(s.id);
    const btns = Array.from({ length: 10 }, (_, i) => i + 1).map(n =>
      `<button type="button" data-action="vote" data-id="${s.id}" data-value="${n}" aria-pressed="${mine?.rating === n}" aria-label="${n} von 10">${n}</button>`).join('');
    const group = L.fillingText(st);
    const fill = mine
      ? `<div class="mr-fill"><span class="mr-fill-label">Sättigung – dein Eindruck, kein Messwert (freiwillig):</span>
          <div class="mr-seg" role="group" aria-label="Sättigung">${[1, 2, 3].map(k =>
            `<button type="button" data-action="fill" data-id="${s.id}" data-value="${k}" aria-pressed="${mine.filling === k}">${L.FILLING[k]}</button>`).join('')}</div>
          ${group ? `<p class="mr-mine">Gruppe: ${esc(group)}</p>` : ''}</div>`
      : '';
    return `<div class="mr-vote" role="group" aria-label="Deine Note"${busy ? ' aria-busy="true"' : ''}>${btns}</div>
      <p class="mr-mine">${mine
        ? `Deine Note: <strong>${mine.rating}</strong> · <button type="button" class="mr-link" data-action="unvote" data-id="${s.id}">zurückziehen</button>`
        : 'Deine Note: tippe 1 (mies) bis 10 (top).'}</p>${fill}`;
  }

  function actionsBlock(s) {
    if (!canEdit(s)) return '';
    const left = Math.max(1, Math.ceil((UNDO_MINUTES * 60e3 - (Date.now() - Date.parse(s.created_at))) / 60e3));
    return `<div class="mr-actions">
      <button type="button" class="mr-link" data-action="edit" data-id="${s.id}">Bearbeiten</button>
      <button type="button" class="mr-link mr-link-danger" data-action="delete" data-id="${s.id}">Löschen</button>
      ${S.me.admin ? '<span class="mr-muted">Admin</span>' : `<span class="mr-muted">noch ${left} Min.</span>`}</div>`;
  }

  // ── Abstimmen ─────────────────────────────────────────────────────────────
  async function vote(id, rating, filling) {
    if (S.busyVotes.has(id)) return;
    const prev = S.mine.get(id);
    const next = { rating, filling: filling === undefined ? (prev ? prev.filling : null) : filling };
    if (prev && prev.rating === next.rating && prev.filling === next.filling) return;
    S.busyVotes.add(id);
    S.mine.set(id, next);
    update();
    try {
      const st = await run(sb.rpc('mensa_vote', { p_serving_id: id, p_rating: rating, p_filling: next.filling }));
      if (st) S.stats.set(id, st); else S.stats.delete(id);
      saveCacheSoon();
    } catch (e) {
      console.error(e);
      if (prev) S.mine.set(id, prev); else S.mine.delete(id);
      toast('Stimme nicht gespeichert: ' + errText(e));
    } finally {
      S.busyVotes.delete(id);
      update();
    }
  }
  async function unvote(id) {
    if (S.busyVotes.has(id)) return;
    const prev = S.mine.get(id);
    S.busyVotes.add(id);
    S.mine.delete(id);
    update();
    try {
      const st = await run(sb.rpc('mensa_unvote', { p_serving_id: id }));
      if (st) S.stats.set(id, st); else S.stats.delete(id);
      saveCacheSoon();
    } catch (e) {
      if (prev) S.mine.set(id, prev);
      toast('Nicht geklappt: ' + errText(e));
    } finally {
      S.busyVotes.delete(id);
      update();
    }
  }

  // ── Eintragen ─────────────────────────────────────────────────────────────
  function preferredCanteen() {
    const saved = Number(store.get(LS.canteen));
    const act = activeCanteens();
    return (act.find(c => c.id === saved) || act[0] || {}).id ?? null;
  }
  function newForm(preset = {}) {
    return {
      photo: null, photoBusy: false, photoTask: null, photoError: '',
      canteen: null, date: today(), dishId: null, name: '', price: '', note: '',
      confirmNew: false, submitting: false, error: '', ...preset
    };
  }

  function renderEntry(panel) {
    if (!S.form) S.form = newForm();
    const F = S.form;
    if (F.canteen == null) F.canteen = preferredCanteen();
    const act = activeCanteens();
    const canteenField = act.length > 1
      ? `<select name="canteen">${act.map(c => `<option value="${c.id}"${c.id === F.canteen ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`
      : `<span class="mr-static">${esc(act[0] ? act[0].name : '–')}</span>`;
    panel.innerHTML = `<form class="mr-card mr-pad" data-form="entry" novalidate>
      <h2>Essen eintragen</h2>
      <div id="mr-photo-pick"></div>
      <p class="mr-hint">Bitte nur das Essen fotografieren, keine Personen. Das Foto wird verkleinert; Standort- und Kameradaten werden entfernt.</p>
      <div class="mr-field-row">
        <label class="mr-field"><span>Mensa</span>${canteenField}</label>
        <label class="mr-field" style="flex:0 0 9.5rem"><span>Datum</span><input class="mr-input" type="date" name="date" value="${F.date}" max="${today()}" required></label>
      </div>
      <label class="mr-field"><span>Gericht</span>
        <input class="mr-input" name="name" value="${esc(F.name)}" placeholder="z. B. Käsespätzle" autocomplete="off" autocapitalize="sentences" enterkeyhint="done" maxlength="120"></label>
      <div id="mr-dish-info"></div>
      <div id="mr-menu" class="mr-menu"></div>
      <details class="mr-more"${F.price || F.note ? ' open' : ''}><summary>Preis &amp; Notiz (optional)</summary>
        <div class="mr-field-row">
          <label class="mr-field" style="flex:0 0 6.5rem"><span>Preis in €</span><input class="mr-input" name="price" inputmode="decimal" placeholder="3,40" value="${esc(F.price)}" maxlength="6"></label>
          <label class="mr-field"><span>Notiz</span><input class="mr-input" name="note" maxlength="200" placeholder="z. B. Soße war kalt" value="${esc(F.note)}"></label>
        </div>
      </details>
      <p class="mr-form-error" id="mr-form-error" role="alert">${esc(F.error)}</p>
      <button class="mr-btn mr-btn-primary mr-btn-block" type="submit" id="mr-submit">Eintragen</button>
      <p class="mr-step" id="mr-step" aria-live="polite"></p>
    </form>`;
    renderPhotoPick();
    renderDishInfo();
    renderMenu();
    updateSubmit();
  }

  function renderPhotoPick() {
    const el = $('#mr-photo-pick');
    const F = S.form;
    if (!el || !F) return;
    if (F.photo) {
      el.innerHTML = `<div class="mr-preview"><img src="${F.photo.preview}" alt="Vorschau deines Fotos">
        <button type="button" class="mr-btn mr-btn-ghost mr-btn-small" data-action="pick-photo">Anderes Foto</button></div>`;
    } else if (F.photoBusy) {
      el.innerHTML = '<div class="mr-pick" aria-busy="true"><span class="mr-pick-icon">⏳</span>Foto wird vorbereitet …</div>';
    } else {
      el.innerHTML = `<button type="button" class="mr-pick" data-action="pick-photo"><span class="mr-pick-icon">📷</span>Foto aufnehmen oder auswählen</button>
        ${F.photoError ? `<p class="mr-form-error">${esc(F.photoError)}</p>` : ''}`;
    }
  }

  function dishInfo(d, counts) {
    const c = L.combine(allServings().filter(s => s.dish_id === d.id).map(s => statsOf(s.id)));
    return `${counts.get(d.id) || 0}× · ${c.votes ? L.scoreText(c) : 'unbewertet'}`;
  }
  const dishChip = (d, sub) =>
    `<button type="button" class="mr-chip" data-action="pick-dish" data-id="${d.id}">${esc(d.name)}${sub ? ` <small>${esc(sub)}</small>` : ''}</button>`;

  function renderDishInfo() {
    const el = $('#mr-dish-info');
    const F = S.form;
    if (!el || !F) return;
    const counts = servedCount();
    const chosen = F.dishId ? S.dishes.get(F.dishId) : L.findExact(F.name, allDishes());
    if (chosen) {
      el.innerHTML = `<div class="mr-chosen"><span>✓ Bekanntes Gericht: <strong>${esc(chosen.name)}</strong><br>
        <small class="mr-muted">${esc(dishInfo(chosen, counts))}</small></span>
        ${F.dishId ? '<button type="button" class="mr-link" data-action="unpick-dish">ändern</button>' : ''}</div>`;
      return;
    }
    // Vorschläge nur aus Gerichten, die schon einmal eingetragen wurden
    const known = allDishes().filter(d => counts.get(d.id));
    if (F.confirmNew === 'ask') {
      const sim = L.similarDishes(F.name, known);
      el.innerHTML = `<div class="mr-confirm"><p>Ähnliche Gerichte gibt es schon. Ist es eins davon?</p>
        <div class="mr-chips">${sim.map(x => dishChip(x.dish, dishInfo(x.dish, counts))).join('')}</div>
        <p style="margin:8px 0 0"><button type="button" class="mr-btn mr-btn-ghost mr-btn-small" data-action="confirm-new">Nein – „${esc(L.cleanName(F.name))}“ neu anlegen</button></p></div>`;
      return;
    }
    const sug = L.suggest(F.name, known, { popularity: d => counts.get(d.id) || 0 });
    if (sug.length) {
      el.innerHTML = `<div class="mr-suggest"><p class="mr-suggest-label">Schon mal gegessen? Antippen zum Zuordnen:</p>
        <div class="mr-chips">${sug.map(x => dishChip(x.dish, dishInfo(x.dish, counts))).join('')}</div></div>`;
    } else if (L.nameKey(F.name).length >= 2) {
      el.innerHTML = `<p class="mr-hint" style="margin-top:-4px">Neues Gericht – wird beim Eintragen angelegt.</p>`;
    } else el.innerHTML = '';
  }

  // Tagesgerichte von openmensa.org als Schnellauswahl
  const menus = new Map();      // "id|datum" → Promise<[{name, price_cents}]>
  const menuItems = new Map();  // "id|datum" → aufgelöste Liste
  function fetchMenu(id, date) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    return fetch(`https://openmensa.org/api/v2/canteens/${id}/days/${date}/meals`, { signal: ctrl.signal })
      .then(r => {
        if (r.status === 404) return [];
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json().then(L.parseMenu);
      })
      .finally(() => clearTimeout(t));
  }
  async function renderMenu() {
    const el = $('#mr-menu');
    const F = S.form;
    if (!el || !F) return;
    const c = S.canteens.find(x => x.id === F.canteen);
    if (!CFG.openmensa || !c || !c.openmensa_id) { el.innerHTML = ''; return; }
    const key = c.openmensa_id + '|' + F.date;
    if (!menus.has(key)) menus.set(key, fetchMenu(c.openmensa_id, F.date));
    if (!menuItems.has(key)) el.innerHTML = '<p class="mr-suggest-label">Speiseplan lädt …</p>';
    let items;
    try {
      items = await menus.get(key);
      menuItems.set(key, items);
    } catch (e) {
      menus.delete(key);
      items = null;
    }
    const cur = S.form && S.canteens.find(x => x.id === S.form.canteen);
    if ($('#mr-menu') !== el || !cur || cur.openmensa_id + '|' + S.form.date !== key) return;
    el.innerHTML = items == null
      ? '<p class="mr-suggest-label">Speiseplan gerade nicht erreichbar – einfach selbst eintippen.</p>'
      : items.length
        ? `<p class="mr-suggest-label">Laut Speiseplan (openmensa.org) – antippen:</p><div class="mr-chips">${items.map((it, i) =>
            `<button type="button" class="mr-chip" data-action="menu" data-key="${esc(key)}" data-i="${i}">${esc(it.name)}${it.price_cents != null ? ` <small>${L.formatPrice(it.price_cents)}</small>` : ''}</button>`).join('')}</div>`
        : '<p class="mr-suggest-label">Für diesen Tag steht nichts im Speiseplan.</p>';
  }

  function updateSubmit(step) {
    const btn = $('#mr-submit');
    if (!btn || !S.form) return;
    btn.disabled = S.form.submitting;
    btn.textContent = S.form.submitting ? 'Speichere …' : 'Eintragen';
    $('#mr-step').textContent = step || '';
  }
  function formError(msg) {
    if (!S.form) return;
    S.form.error = msg;
    const el = $('#mr-form-error');
    if (el) el.textContent = msg;
  }
  function syncField(name, value) {
    const input = $(`#mr form[data-form="entry"] [name="${name}"]`);
    if (input) input.value = value;
  }

  async function submitEntry() {
    const F = S.form;
    if (!F || F.submitting) return;
    const name = L.cleanName(F.name);
    const exact = F.dishId ? S.dishes.get(F.dishId) : L.findExact(name, allDishes());
    if (!exact && L.nameKey(name).length < 2) return formError('Wie heißt das Gericht?');
    if (!F.canteen) return formError('Bitte eine Mensa wählen.');
    if (!F.date || F.date > today()) return formError('Das Datum darf nicht in der Zukunft liegen.');
    const price = L.parsePrice(F.price);
    if (Number.isNaN(price)) return formError('Preis bitte wie „3,40“ angeben (höchstens 50 €).');
    if (!exact && F.confirmNew !== 'yes') {
      const counts = servedCount();
      if (L.similarDishes(name, allDishes().filter(d => counts.get(d.id))).length) {
        F.confirmNew = 'ask';
        renderDishInfo();
        $('#mr-dish-info').scrollIntoView({ block: 'center', behavior: 'smooth' });
        return formError('Kurz prüfen: bekanntes Gericht oder neu?');
      }
    }
    if (!navigator.onLine) return formError('Keine Internetverbindung. Deine Eingaben bleiben erhalten – gleich nochmal versuchen.');

    F.submitting = true;
    formError('');
    updateSubmit(F.photoBusy ? 'Foto wird vorbereitet …' : '');
    try {
      if (F.photoTask) await F.photoTask;
      updateSubmit('Eintrag wird gespeichert …');
      const res = await run(sb.rpc('mensa_add_serving', {
        p_canteen_id: F.canteen,
        p_served_on: F.date,
        p_dish_id: exact ? exact.id : null,
        p_dish_name: exact ? null : name,
        p_price_cents: price,
        p_note: L.cleanName(F.note) || null
      }));
      const [row, dish] = await Promise.all([
        run(sb.from('mensa_servings').select(SERVING_COLS).eq('id', res.serving_id).single()),
        S.dishes.get(res.dish_id) || run(sb.from('mensa_dishes').select('id,name,created_at').eq('id', res.dish_id).single())
      ]);
      S.dishes.set(dish.id, dish);
      S.servings.set(row.id, row);
      store.set(LS.canteen, F.canteen);
      const photo = F.photo;
      S.form = null;
      if (photo && !row.photo_path) startUpload(row.id, photo);
      else if (photo) URL.revokeObjectURL(photo.preview);

      if (!res.existed) toast('Eingetragen!', { label: 'Rückgängig', run: () => deleteServing(row.id, true) });
      else toast(row.photo_path || !photo ? 'Gibt es schon – du kannst direkt bewerten.' : 'Gab es schon – dein Foto wird ergänzt.');
      saveCacheSoon();
      S.highlight = row.id;
      if (row.served_on === today()) setTab('today');
      else openDish(row.dish_id);
    } catch (e) {
      console.error(e);
      if (S.form === F) {
        F.submitting = false;
        updateSubmit();
        formError(errText(e));
      }
    }
  }

  // ── Bearbeiten & Löschen ──────────────────────────────────────────────────
  function openEdit(id) {
    const s = S.servings.get(id);
    if (!s) return;
    const act = S.canteens;
    const dlg = $('#mr-dialog');
    dlg.innerHTML = `<form data-form="edit" data-id="${id}">
      <h2 style="margin-bottom:12px">Eintrag bearbeiten</h2>
      <label class="mr-field"><span>Gericht</span>
        <input class="mr-input" name="name" list="mr-edit-dishes" value="${esc(dishName(s.dish_id))}" maxlength="120" autocomplete="off"></label>
      <datalist id="mr-edit-dishes">${allDishes().map(d => `<option value="${esc(d.name)}"></option>`).join('')}</datalist>
      <p class="mr-hint" style="margin-top:-4px">Name eines bestehenden Gerichts wählen, um den Eintrag dorthin zu verschieben. Ein neuer Name legt ein neues Gericht an.</p>
      <div class="mr-field-row">
        ${act.length > 1 ? `<label class="mr-field"><span>Mensa</span><select name="canteen">${act.map(c =>
          `<option value="${c.id}"${c.id === s.canteen_id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}
        <label class="mr-field"><span>Datum</span><input class="mr-input" type="date" name="date" value="${s.served_on}" max="${today()}"></label>
      </div>
      <div class="mr-field-row">
        <label class="mr-field" style="flex:0 0 6.5rem"><span>Preis in €</span><input class="mr-input" name="price" inputmode="decimal" value="${priceInput(s.price_cents)}" maxlength="6"></label>
        <label class="mr-field"><span>Notiz</span><input class="mr-input" name="note" maxlength="200" value="${esc(s.note || '')}"></label>
      </div>
      ${s.photo_path ? `<p><button type="button" class="mr-link mr-link-danger" data-action="remove-photo" data-id="${id}">Foto entfernen</button></p>` : ''}
      <p class="mr-form-error" id="mr-edit-error" role="alert"></p>
      <div class="mr-dialog-actions">
        <button type="button" class="mr-btn mr-btn-ghost" data-action="close-dialog">Abbrechen</button>
        <button type="submit" class="mr-btn mr-btn-primary">Speichern</button>
      </div></form>`;
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }
  function closeDialog() {
    const dlg = $('#mr-dialog');
    if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
  }

  async function saveEdit(form) {
    const id = Number(form.dataset.id);
    const s = S.servings.get(id);
    const fd = new FormData(form);
    const errEl = $('#mr-edit-error');
    const name = L.cleanName(fd.get('name'));
    if (L.nameKey(name).length < 2) { errEl.textContent = 'Wie heißt das Gericht?'; return; }
    const price = L.parsePrice(fd.get('price'));
    if (Number.isNaN(price)) { errEl.textContent = 'Preis bitte wie „3,40“ angeben (höchstens 50 €).'; return; }
    const date = String(fd.get('date') || s.served_on);
    if (date > today()) { errEl.textContent = 'Das Datum darf nicht in der Zukunft liegen.'; return; }
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      let dishId = s.dish_id;
      if (L.nameKey(name) !== L.nameKey(dishName(s.dish_id))) {
        const ex = L.findExact(name, allDishes());
        if (ex) dishId = ex.id;
        else {
          const d = await run(sb.from('mensa_dishes').insert({ name }).select('id,name,created_at').single());
          S.dishes.set(d.id, d);
          dishId = d.id;
        }
      }
      const patch = { dish_id: dishId, served_on: date, price_cents: price, note: L.cleanName(fd.get('note')) || null };
      if (fd.get('canteen')) patch.canteen_id = Number(fd.get('canteen'));
      const row = await run(sb.from('mensa_servings').update(patch).eq('id', id).select(SERVING_COLS).single());
      S.servings.set(id, row);
      closeDialog();
      toast('Gespeichert.');
      saveCacheSoon();
      update();
    } catch (e) {
      errEl.textContent = e.code === '23505' ? 'Dieses Gericht ist an dem Tag in der Mensa schon eingetragen.' : errText(e);
    } finally {
      btn.disabled = false;
    }
  }

  async function removePhoto(id) {
    const s = S.servings.get(id);
    if (!s || !confirm('Foto wirklich entfernen?')) return;
    try {
      await run(sb.rpc('mensa_set_photo', { p_serving_id: id, p_photo_path: null, p_thumb_path: null }));
      const paths = [s.photo_path, s.thumb_path].filter(Boolean);
      sb.storage.from(BUCKET).remove(paths).catch(() => {});
      s.photo_path = null; s.thumb_path = null;
      closeDialog();
      toast('Foto entfernt.');
      saveCacheSoon();
      update();
    } catch (e) {
      $('#mr-edit-error').textContent = errText(e);
    }
  }

  async function deleteServing(id, undo) {
    const s = S.servings.get(id);
    if (!s) return;
    if (!undo && !confirm(`„${dishName(s.dish_id)}“ (${L.dayLabel(s.served_on)}) löschen? Die Stimmen dazu werden mit gelöscht.`)) return;
    try {
      const { error, count } = await withTimeout(sb.from('mensa_servings').delete({ count: 'exact' }).eq('id', id));
      if (error) throw error;
      if (!count) { toast('Löschen nicht möglich – eigene Einträge nur 15 Minuten lang.'); return; }
      const paths = [s.photo_path, s.thumb_path].filter(Boolean);
      if (paths.length) sb.storage.from(BUCKET).remove(paths).catch(() => {});
      S.servings.delete(id); S.stats.delete(id); S.mine.delete(id); S.uploads.delete(id);
      closeDialog();
      saveCacheSoon();
      update();
      toast(undo ? 'Eintrag zurückgenommen.' : 'Eintrag gelöscht.');
    } catch (e) {
      toast('Löschen fehlgeschlagen: ' + errText(e));
    }
  }

  // ── Verlauf ───────────────────────────────────────────────────────────────
  function renderHistory(panel) {
    const H = S.hist;
    const act = S.canteens;
    const ranges = [['7', 'Letzte 7 Tage'], ['30', 'Letzte 30 Tage'], ['365', 'Letztes Jahr'], ['all', 'Alle Tage']];
    panel.innerHTML = `<div class="mr-filters">
      <input class="mr-input" type="search" data-hist="q" placeholder="Gericht suchen …" value="${esc(H.q)}" aria-label="Gericht suchen" enterkeyhint="search">
      <div class="mr-filter-row">
        <select data-hist="range" aria-label="Zeitraum">${ranges.map(([v, l]) => `<option value="${v}"${H.range === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <input class="mr-input" type="date" data-hist="date" value="${H.date}" max="${today()}" aria-label="Bestimmter Tag" title="Bestimmter Tag">
        ${act.length > 1 ? `<select data-hist="canteen" aria-label="Mensa"><option value="">Alle Mensen</option>${act.map(c =>
          `<option value="${c.id}"${String(c.id) === H.canteen ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` : ''}
      </div>
      <div class="mr-seg" role="group" aria-label="Ansicht">
        <button type="button" data-action="hist-view" data-value="entries" aria-pressed="${H.view === 'entries'}">Einträge</button>
        <button type="button" data-action="hist-view" data-value="dishes" aria-pressed="${H.view === 'dishes'}">Rangliste der Gerichte</button>
      </div></div>
      <div id="mr-hist-results"></div>`;
    renderHistResults();
  }

  function histFiltered() {
    const H = S.hist;
    const from = H.range === 'all' ? '' : L.addDays(today(), 1 - Number(H.range));
    return allServings().filter(s =>
      (H.date ? s.served_on === H.date : !from || s.served_on >= from) &&
      (!H.canteen || s.canteen_id === Number(H.canteen)) &&
      L.matchesSearch(H.q, dishName(s.dish_id)));
  }
  const thumbHtml = path => path
    ? `<span class="mr-thumb"><img data-path="${esc(path)}" alt="" loading="lazy" decoding="async"></span>`
    : '<span class="mr-thumb mr-thumb-empty" aria-hidden="true">🍽</span>';
  const rowScore = st => st.votes
    ? `<span class="mr-row-score"><strong>${L.formatAvg(st.avg)}</strong><small>${L.votesLabel(st.votes)}${st.few ? ' · wenige' : ''}</small></span>`
    : '<span class="mr-row-score"><small>Noch nicht<br>bewertet</small></span>';

  function renderHistResults() {
    const el = $('#mr-hist-results');
    if (el) keepPhotos(el, () => drawHistResults(el));
  }

  function drawHistResults(el) {
    const H = S.hist;
    const list = histFiltered();
    if (!list.length) {
      el.innerHTML = `<div class="mr-card"><p class="mr-empty">${S.servings.size ? 'Nichts gefunden – Suche oder Zeitraum anpassen?' : 'Noch keine Einträge.'}</p></div>`;
      return;
    }
    const multi = S.canteens.length > 1;
    if (H.view === 'dishes') {
      const ids = new Set(list.map(s => s.dish_id));
      const ranked = L.rankDishes(allDishes().filter(d => ids.has(d.id)), list, statsOf);
      let html = '<div class="mr-card"><ol class="mr-list">';
      let rank = 0, divider = false;
      for (const r of ranked) {
        if (r.votes < L.MIN_VOTES && !divider) {
          divider = true;
          html += `<li class="mr-divider">Unter ${L.MIN_VOTES} Stimmen – noch nicht in der Rangliste</li>`;
        }
        const latest = list.filter(s => s.dish_id === r.dish.id && s.thumb_path).sort((a, b) => b.served_on.localeCompare(a.served_on))[0];
        html += `<li><a class="mr-row" href="#gericht-${r.dish.id}" data-dish="${r.dish.id}">
          <span class="mr-rank">${r.votes >= L.MIN_VOTES ? ++rank + '.' : ''}</span>${thumbHtml(latest && latest.thumb_path)}
          <span class="mr-row-main"><span class="mr-row-title">${esc(r.dish.name)}</span>
          <span class="mr-row-meta">${r.servings}× · zuletzt ${esc(L.dayLabel(r.last))}</span></span>${rowScore(r)}</a></li>`;
      }
      el.innerHTML = html + '</ol></div>';
    } else {
      list.sort((a, b) => b.served_on.localeCompare(a.served_on) || byCreated(b, a));
      const shown = list.slice(0, H.limit);
      let html = '<div class="mr-card"><ul class="mr-list">';
      for (const s of shown) {
        const mine = S.mine.get(s.id);
        html += `<li><a class="mr-row" href="#gericht-${s.dish_id}" data-dish="${s.dish_id}" data-serving="${s.id}">${thumbHtml(s.thumb_path)}
          <span class="mr-row-main"><span class="mr-row-title">${esc(dishName(s.dish_id))}</span>
          <span class="mr-row-meta">${esc(L.dayLabel(s.served_on))}${multi ? ' · ' + esc(canteenName(s.canteen_id)) : ''}${mine ? ' · deine Note ' + mine.rating : ''}</span></span>
          ${rowScore(statsOf(s.id))}</a></li>`;
      }
      html += '</ul></div>';
      if (list.length > shown.length) {
        html += `<button type="button" class="mr-btn mr-btn-ghost mr-btn-block" data-action="more">Mehr anzeigen (${list.length - shown.length})</button>`;
      }
      el.innerHTML = html;
    }
  }

  // ── Gericht ───────────────────────────────────────────────────────────────
  function renderDish(panel) {
    const d = S.dishes.get(S.dishId);
    if (!d) {
      panel.innerHTML = `<div class="mr-card mr-pad"><p>Dieses Gericht gibt es nicht (mehr).</p>
        <button type="button" class="mr-btn mr-btn-ghost" data-tab="today">Zur Übersicht</button></div>`;
      return;
    }
    const t = today();
    const list = allServings().filter(s => s.dish_id === d.id).sort((a, b) => b.served_on.localeCompare(a.served_on) || byCreated(b, a));
    const todays = list.filter(s => s.served_on === t);
    const earlier = list.filter(s => s.served_on < t);
    const all = L.combine(list.map(s => statsOf(s.id)));
    const tile = (label, c) => `<div class="mr-tile"><div class="mr-tile-label">${label}</div>
      <div class="mr-tile-value">${c.votes ? L.formatAvg(c.avg) : '–'}</div>
      <div class="mr-tile-sub">${c.votes ? L.votesLabel(c.votes) + (c.few ? ' · wenige' : '') : 'unbewertet'}</div></div>`;
    const tiles = todays.length
      ? tile('Heute', L.combine(todays.map(s => statsOf(s.id)))) + tile('Früher', L.combine(earlier.map(s => statsOf(s.id)))) + tile('Insgesamt', all)
      : tile('Schnitt', all) + `<div class="mr-tile"><div class="mr-tile-label">Eingetragen</div><div class="mr-tile-value">${list.length}×</div>
          <div class="mr-tile-sub">${list.length ? 'zuletzt ' + esc(L.dayLabel(list[0].served_on)) : ''}</div></div>`;
    const filling = L.fillingText(all);

    let html = `<button type="button" class="mr-link mr-back" data-action="back">← Zurück</button>
      <div class="mr-card mr-pad"><h2 class="mr-dish">${esc(d.name)}</h2>
      <div class="mr-tiles"${todays.length ? '' : ' style="grid-template-columns:repeat(2,minmax(0,1fr))"'}>${tiles}</div>
      ${filling ? `<p class="mr-sub" style="margin-top:8px">Sättigung laut Gruppe (Eindruck, kein Messwert): ${esc(filling)}</p>` : ''}
      ${todays.length ? '' : `<button type="button" class="mr-btn mr-btn-ghost mr-btn-small" data-action="entry-with" data-id="${d.id}" style="margin-top:8px">Heute wieder da? Eintragen</button>`}
      ${S.me.admin ? adminDishTools(d) : ''}</div>`;
    if (todays.length) html += '<h2 class="mr-section">Heute</h2>' + todays.map(s => servingCard(s)).join('');
    if (earlier.length) html += `<h2 class="mr-section">${todays.length ? 'Früher' : 'Bisherige Einträge'}</h2>` + earlier.map(s => servingCard(s, { compact: true })).join('');
    if (!list.length) html += '<div class="mr-card"><p class="mr-empty">Noch keine Einträge zu diesem Gericht.</p></div>';
    panel.innerHTML = html;
    flashHighlight(panel);
  }

  function adminDishTools(d) {
    return `<details class="mr-more" style="margin-top:12px"><summary>Admin: Gericht korrigieren</summary>
      <form data-form="rename" data-id="${d.id}" class="mr-field-row" style="align-items:flex-end">
        <label class="mr-field"><span>Umbenennen</span><input class="mr-input" name="name" value="${esc(d.name)}" maxlength="120"></label>
        <button class="mr-btn mr-btn-ghost" type="submit" style="flex:0 0 auto;margin-bottom:10px">Speichern</button>
      </form>
      <form data-form="merge" data-id="${d.id}">
        <label class="mr-field"><span>Doppelt angelegt? Zusammenführen mit …</span>
          <input class="mr-input" name="target" list="mr-merge-dishes" placeholder="Name des richtigen Gerichts" autocomplete="off"></label>
        <datalist id="mr-merge-dishes">${allDishes().filter(x => x.id !== d.id).map(x => `<option value="${esc(x.name)}"></option>`).join('')}</datalist>
        <p class="mr-hint" style="margin-top:-4px">Alle Einträge und Stimmen wandern zum gewählten Gericht, dieses hier verschwindet. Nur bewusst nutzen – es wird nie automatisch zusammengeführt.</p>
        <button class="mr-btn mr-btn-ghost" type="submit">Zusammenführen</button>
      </form></details>`;
  }

  async function renameDish(form) {
    const id = Number(form.dataset.id);
    const name = L.cleanName(new FormData(form).get('name'));
    if (L.nameKey(name).length < 2 || name === dishName(id)) return;
    try {
      const d = await run(sb.from('mensa_dishes').update({ name }).eq('id', id).select('id,name,created_at').single());
      S.dishes.set(d.id, d);
      toast('Umbenannt.');
      saveCacheSoon();
      render();
    } catch (e) {
      toast(e.code === '23505' ? 'Diesen Namen gibt es schon – dann lieber zusammenführen.' : errText(e));
    }
  }

  async function mergeDish(form) {
    const id = Number(form.dataset.id);
    const target = L.findExact(new FormData(form).get('target'), allDishes().filter(x => x.id !== id));
    if (!target) { toast('Bitte den Namen eines bestehenden Gerichts aus der Liste wählen.'); return; }
    if (!confirm(`„${dishName(id)}“ mit „${target.name}“ zusammenführen? Das lässt sich nicht automatisch rückgängig machen.`)) return;
    try {
      await run(sb.rpc('mensa_merge_dishes', { p_keep: target.id, p_drop: id }));
      await loadAll();
      toast('Zusammengeführt.');
      S.dishId = target.id;
      setTab('dish');
    } catch (e) {
      toast(errText(e));
    }
  }

  // ── Konto & Anmeldung ─────────────────────────────────────────────────────
  function renderLogin(panel) {
    if (!configured) return renderUnconfigured(panel);
    panel.innerHTML = `<div class="mr-card mr-pad mr-login"><h2>Anmelden</h2>
      <p class="mr-sub">Das Mensa-Ranking ist nur für unsere Gruppe. Den Account bekommst du von Neo.</p>
      <form data-form="login">
        <label class="mr-field"><span>E-Mail</span><input class="mr-input" type="email" name="email" autocomplete="username" required></label>
        <label class="mr-field"><span>Passwort</span><input class="mr-input" type="password" name="password" autocomplete="current-password" required></label>
        <p class="mr-form-error" id="mr-login-error" role="alert"></p>
        <button class="mr-btn mr-btn-primary mr-btn-block" type="submit">Anmelden</button>
      </form>
      <p class="mr-hint">Passwort vergessen? Neo kann es dir neu setzen.</p></div>`;
  }

  function renderAccount(panel) {
    if (!S.user) return renderLogin(panel);
    const member = S.me.member;
    let html = '<div class="mr-card mr-pad mr-stack">';
    if (member) {
      html += `<h2>Dein Konto</h2>
        <p>Angemeldet als <strong>${esc(S.me.name)}</strong> (${esc(S.user.email)})${S.me.admin ? ' · Admin' : ''}.</p>
        <p class="mr-sub">Deine einzelnen Noten sieht niemand außer dir. Die anderen sehen nur Schnitt und Anzahl der Stimmen – und wer ein Essen eingetragen hat.</p>`;
    } else if (S.error) {
      html += `<h2>Keine Verbindung</h2><p>${esc(errText(S.error))}</p>
        <button type="button" class="mr-btn mr-btn-primary" data-action="recheck">Erneut versuchen</button>`;
    } else {
      html += `<h2>Noch nicht freigeschaltet</h2>
        <p>Du bist als <strong>${esc(S.user.email)}</strong> angemeldet, aber dieser Account gehört noch nicht zur Mensa-Gruppe.</p>
        <p class="mr-sub">Schick Neo diese E-Mail-Adresse, damit du freigeschaltet wirst.</p>
        <button type="button" class="mr-btn mr-btn-ghost" data-action="recheck">Erneut prüfen</button>`;
    }
    html += '</div>';
    if (member) {
      html += `<form class="mr-card mr-pad" data-form="password"><h2>Passwort ändern</h2>
        <input type="email" name="username" value="${esc(S.user.email)}" autocomplete="username" hidden>
        <label class="mr-field"><span>Neues Passwort (mind. 8 Zeichen)</span><input class="mr-input" type="password" name="pw1" autocomplete="new-password" minlength="8" required></label>
        <label class="mr-field"><span>Wiederholen</span><input class="mr-input" type="password" name="pw2" autocomplete="new-password" minlength="8" required></label>
        <p class="mr-form-error" id="mr-pw-error" role="alert"></p>
        <button class="mr-btn mr-btn-primary" type="submit">Passwort speichern</button></form>`;
    }
    html += '<p style="text-align:center"><button type="button" class="mr-btn mr-btn-ghost" data-action="logout">Abmelden</button></p>';
    panel.innerHTML = html;
  }

  async function login(form) {
    const fd = new FormData(form);
    const btn = form.querySelector('[type="submit"]');
    const errEl = $('#mr-login-error');
    btn.disabled = true;
    errEl.textContent = '';
    let res;
    try {
      res = await withTimeout(sb.auth.signInWithPassword({ email: String(fd.get('email')).trim(), password: String(fd.get('password')) }));
    } catch (e) {
      res = { error: e };
    }
    btn.disabled = false;
    if (res.error) {
      errEl.textContent = /invalid login|invalid credentials/i.test(res.error.message || '') ? 'E-Mail oder Passwort falsch.' : errText(res.error);
      return;
    }
    await onAuth('SIGNED_IN', res.data.session);
  }

  async function changePassword(form) {
    const fd = new FormData(form);
    const pw1 = String(fd.get('pw1')), pw2 = String(fd.get('pw2'));
    const errEl = $('#mr-pw-error');
    if (pw1.length < 8) { errEl.textContent = 'Mindestens 8 Zeichen.'; return; }
    if (pw1 !== pw2) { errEl.textContent = 'Die beiden Passwörter sind verschieden.'; return; }
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      const { error } = await withTimeout(sb.auth.updateUser({ password: pw1 }));
      if (error) throw error;
      form.reset();
      errEl.textContent = '';
      toast('Passwort geändert.');
    } catch (e) {
      errEl.textContent = /different/i.test(e.message || '') ? 'Das neue Passwort muss sich vom alten unterscheiden.' : errText(e);
    } finally {
      btn.disabled = false;
    }
  }

  function clearUser() {
    unsubscribe();
    S.user = null;
    S.me = { member: false, admin: false, name: null };
    clearData();
    store.del(LS.cache);
    store.del(LS.urls);
    urls.clear();
  }

  async function logout() {
    try { await withTimeout(sb.auth.signOut()); } catch (e) { console.warn(e); }
    clearUser();
    setTab('login');
  }

  // Anmeldestatus (auch aus anderen Tabs)
  async function onAuth(event, session) {
    const uid = session && session.user ? session.user.id : null;
    if (!uid) {
      if (S.user) { clearUser(); render(); }
      return;
    }
    if (S.user && uid === S.user.id) { S.user = session.user; return; }
    S.user = session.user;
    clearData();
    S.booted = false;
    loadCache();
    render();
    await afterLogin();
    S.booted = true;
    if (S.tab === 'login' || S.tab === 'account') S.tab = 'today';
    render();
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  let toastTimer = null;
  function toast(text, action) {
    const el = $('#mr-toast');
    el.textContent = '';
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mr-link';
      b.textContent = action.label;
      b.addEventListener('click', () => { el.hidden = true; action.run(); });
      el.appendChild(b);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, action ? 12000 : 4500);
  }

  // ── Events ────────────────────────────────────────────────────────────────
  function onClick(e) {
    const t = e.target.closest('[data-tab],[data-action],[data-dish]');
    if (!t || t.id === 'mr-toast') return;
    if (t.dataset.tab) {
      e.preventDefault();
      return setTab(t.dataset.tab);
    }
    const a = t.dataset.action;
    if (!a && t.dataset.dish) {
      e.preventDefault();
      if (t.dataset.serving) S.highlight = Number(t.dataset.serving);
      return openDish(Number(t.dataset.dish));
    }
    const id = Number(t.dataset.id);
    const F = S.form;
    switch (a) {
      case 'vote': return vote(id, Number(t.dataset.value));
      case 'fill': {
        const m = S.mine.get(id);
        const v = Number(t.dataset.value);
        return m && vote(id, m.rating, m.filling === v ? null : v);
      }
      case 'unvote': return unvote(id);
      case 'pick-photo': return pickPhoto('form');
      case 'add-photo': return pickPhoto(id);
      case 'retry-photo': { const u = S.uploads.get(id); return u && startUpload(id, u.photo); }
      case 'pick-dish': {
        const d = S.dishes.get(id);
        if (!F || !d) return;
        Object.assign(F, { dishId: id, name: d.name, confirmNew: false });
        syncField('name', d.name);
        formError('');
        return renderDishInfo();
      }
      case 'unpick-dish':
        if (!F) return;
        F.dishId = null;
        renderDishInfo();
        return $('#mr form[data-form="entry"] [name="name"]').focus();
      case 'confirm-new':
        if (!F) return;
        F.confirmNew = 'yes';
        renderDishInfo();
        return submitEntry();
      case 'menu': {
        const it = (menuItems.get(t.dataset.key) || [])[Number(t.dataset.i)];
        if (!F || !it) return;
        Object.assign(F, { name: it.name, dishId: null, confirmNew: false });
        syncField('name', it.name);
        if (it.price_cents != null && !F.price) { F.price = priceInput(it.price_cents); syncField('price', F.price); }
        formError('');
        return renderDishInfo();
      }
      case 'entry-with':
        S.form = newForm({ dishId: id, name: dishName(id) });
        return setTab('entry');
      case 'edit': return openEdit(id);
      case 'delete': return deleteServing(id);
      case 'remove-photo': return removePhoto(id);
      case 'close-dialog': return closeDialog();
      case 'hist-view':
        S.hist.view = t.dataset.value;
        S.hist.limit = PAGE;
        $$('[data-action="hist-view"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === S.hist.view)));
        return renderHistResults();
      case 'more':
        S.hist.limit += PAGE;
        return renderHistResults();
      case 'back': return goBack();
      case 'logout': return logout();
      case 'recheck':
      case 'reload':
        return reload(a === 'recheck');
    }
  }

  function onInput(e) {
    const t = e.target;
    if (t.dataset.hist) {
      S.hist[t.dataset.hist] = t.value;
      S.hist.limit = PAGE;
      return renderHistResults();
    }
    const F = S.form;
    if (!F || !t.form || t.form.dataset.form !== 'entry') return;
    if (t.name === 'name') {
      F.name = t.value;
      F.dishId = null;
      F.confirmNew = false;
      renderDishInfo();
    } else if (t.name === 'price') F.price = t.value;
    else if (t.name === 'note') F.note = t.value;
    else if (t.name === 'date') { F.date = t.value || today(); renderMenu(); }
    else if (t.name === 'canteen') { F.canteen = Number(t.value); store.set(LS.canteen, F.canteen); renderMenu(); }
    if (F.error) formError('');
  }

  function onChange(e) {
    if (e.target.id === 'mr-file') onFile(e.target);
  }

  function onSubmit(e) {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const kind = form.dataset.form;
    if (kind === 'entry') return submitEntry();
    if (kind === 'login') return login(form);
    if (kind === 'password') return changePassword(form);
    if (kind === 'edit') return saveEdit(form);
    if (kind === 'rename') return renameDish(form);
    if (kind === 'merge') return mergeDish(form);
  }

  // Abgelaufene Foto-Links neu anfordern (einmal pro Pfad)
  function onImgError(e) {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.path) return;
    const p = img.dataset.path;
    if (!urlRetried.has(p)) {
      urlRetried.add(p);
      urls.delete(p);
      requestUrls([p]);
    } else img.parentElement && img.parentElement.classList.add('mr-photo-failed');
  }

  // ── Start ─────────────────────────────────────────────────────────────────
  (async function init() {
    const root = $('#mr');
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('error', onImgError, true);
    window.addEventListener('popstate', () => { routeFromHash(); render(); });
    window.addEventListener('online', () => { if (S.me.member) loadAll().then(update); else renderBanner(); });
    window.addEventListener('offline', renderBanner);
    // zurück aus dem Hintergrund (Handy): frische Daten holen
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && S.me.member && Date.now() - S.loadedAt > 30e3) loadAll().then(update);
    });
    // Fallback, falls die Live-Verbindung hängt
    setInterval(() => {
      if (document.visibilityState === 'visible' && S.me.member && !S.live && Date.now() - S.loadedAt > 60e3) loadAll().then(update);
    }, 30e3);
    window.addEventListener('beforeunload', e => {
      if (Array.from(S.uploads.values()).some(u => u.state === 'uploading')) { e.preventDefault(); e.returnValue = ''; }
    });

    routeFromHash();
    loadUrlCache();
    if (!configured) { S.booted = true; return render(); }

    const { data } = await sb.auth.getSession();
    S.user = data.session ? data.session.user : null;
    if (S.user) loadCache();   // letzter Stand sofort, falls vorhanden
    render();
    if (S.user) await afterLogin();
    S.booted = true;
    render();
    // Supabase empfiehlt, im Callback keine weiteren Supabase-Aufrufe direkt abzuwarten
    sb.auth.onAuthStateChange((event, session) => { setTimeout(() => onAuth(event, session), 0); });
  })();
})();
