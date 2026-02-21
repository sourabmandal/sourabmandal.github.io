// ═══════════════════════════════════════════════════════
//  CONFIG & CONSTANTS
// ═══════════════════════════════════════════════════════
const ORCID_ID  = '0000-0002-2860-2754';
const ORCID_API = 'https://pub.orcid.org/v3.0';
const AUTH_KEY  = 'sourab_tag_auth_v1';
const TAG_KEY   = 'sourab_index_tags_v2';
const IF_KEY    = 'sourab_impact_factors_v1';
const ACT_KEY   = 'sourab_activities_v1';


// ═══════════════════════════════════════════════════════
//  SUPABASE (PERSISTENT STORAGE FOR GITHUB PAGES)
//  Configure in config.js (window.SITE_CONFIG)
// ═══════════════════════════════════════════════════════
const CFG = (window.SITE_CONFIG || {});
const SUPABASE_ENABLED = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && typeof supabase !== 'undefined');

let sb = null;
if (SUPABASE_ENABLED) {
  sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
}

function debugLog(...args) {
  if (CFG.DEBUG) console.log('[debug]', ...args);
}

async function getSessionSafe() {
  if (!SUPABASE_ENABLED) return null;
  try {
    const { data } = await sb.auth.getSession();
    return data?.session || null;
  } catch (e) {
    debugLog('getSessionSafe error', e);
    return null;
  }
}

async function loadRemoteState() {
  if (!SUPABASE_ENABLED) return null;
  try {
    const { data, error } = await sb
      .from('site_state')
      .select('tags, impact_factors, activities')
      .eq('id', CFG.STATE_ROW_ID || 1)
      .single();

    if (error) {
      debugLog('loadRemoteState error', error);
      return null;
    }
    return data || null;
  } catch (e) {
    debugLog('loadRemoteState exception', e);
    return null;
  }
}

async function saveRemoteState() {
  if (!SUPABASE_ENABLED) return;

  const session = await getSessionSafe();
  if (!session) {
    showToast('Not logged in (cannot save)');
    return;
  }

  const payload = {
    id: CFG.STATE_ROW_ID || 1,
    tags: tags || {},
    impact_factors: impactFactors || {},
    activities: activities || [],
    updated_at: new Date().toISOString()
  };

  const { error } = await sb.from('site_state').upsert(payload, { onConflict: 'id' });
  if (error) {
    debugLog('saveRemoteState error', error);
    showToast('Save failed');
  } else {
    showToast('Saved ✓');
  }
}

// ═══════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════
let allPublications   = [];
let currentTypeFilter  = 'all';
let currentIndexFilter = 'none';
let currentIFFilter    = 0;
let currentSearch      = '';
let tags = {};
let impactFactors = {};
let activities = [];
let loggedIn = false;
let activeTab = 'tagging';

// ═══════════════════════════════════════════════════════
//  STORAGE
// ═══════════════════════════════════════════════════════
async function loadStorage() {
  // Fast local cache first
  try { tags          = JSON.parse(localStorage.getItem(TAG_KEY) || '{}'); } catch(e) { tags = {}; }
  try { impactFactors = JSON.parse(localStorage.getItem(IF_KEY)  || '{}'); } catch(e) { impactFactors = {}; }
  try { activities    = JSON.parse(localStorage.getItem(ACT_KEY) || '[]'); } catch(e) { activities = []; }

  // Then hydrate from remote (authoritative) if enabled
  const remote = await loadRemoteState();
  if (remote) {
    tags = remote.tags || {};
    impactFactors = remote.impact_factors || {};
    activities = remote.activities || [];
    localStorage.setItem(TAG_KEY, JSON.stringify(tags));
    localStorage.setItem(IF_KEY,  JSON.stringify(impactFactors));
    localStorage.setItem(ACT_KEY, JSON.stringify(activities));
  }
}

function saveTags() {
  localStorage.setItem(TAG_KEY, JSON.stringify(tags));
  updateIndexStats();
  // Persist across devices
  saveRemoteState();
}
function saveIFs() {
  localStorage.setItem(IF_KEY,  JSON.stringify(impactFactors));
  saveRemoteState();
}
function saveActivities() {
  localStorage.setItem(ACT_KEY, JSON.stringify(activities));
  renderActivitiesPublic();
  saveRemoteState();
}

function getTag(putCode) { return tags[putCode] || { sci: false, scopus: false }; }
function getIF(putCode)  { return impactFactors[putCode] || ''; }

// ═══════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════
function isAuthenticated() {
  return sessionStorage.getItem(AUTH_KEY) === '1' || localStorage.getItem(AUTH_KEY) === '1';
}
function setAuthenticated(remember) {
  sessionStorage.setItem(AUTH_KEY, '1');
  if (remember) localStorage.setItem(AUTH_KEY, '1');
}
function clearAuth() {
  sessionStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(AUTH_KEY);
}
async function hashString(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function submitLogin() {
  const pwd = document.getElementById('pw-input').value;
  const err = document.getElementById('pw-error');
  const inp = document.getElementById('pw-input');
  const remember = document.getElementById('pw-remember').checked;

  if (!pwd) { err.textContent = 'Please enter your password.'; return; }

  // If Supabase is not configured, we cannot persist changes across devices.
  if (!SUPABASE_ENABLED) {
    err.textContent = 'Supabase is not configured. Please set config.js first.';
    return;
  }

  const { error } = await sb.auth.signInWithPassword({
    email: (CFG.ADMIN_EMAIL || ''),
    password: pwd
  });

  if (!error) {
    setAuthenticated(remember);
    activateLoggedInState();
    showToast('Admin signed in ✓');
    err.textContent = '';
  } else {
    err.textContent = 'Incorrect password.';
    inp.classList.remove('shake'); void inp.offsetWidth; inp.classList.add('shake');
    inp.select();
  }
}

function activateLoggedInState() {
  loggedIn = true;
  document.getElementById('panel-auth-screen').style.display = 'none';
  document.getElementById('logged-strip').style.display = 'flex';
  document.getElementById('panel-tabs-bar').style.display = 'block';
  document.getElementById('panel-body').style.display = 'block';
  document.getElementById('panel-title').textContent = '⚙ Admin Panel';
  document.getElementById('login-btn').textContent = '⚙ Admin';
  document.getElementById('login-btn').classList.add('logged-in');
  // Show tagging controls on pub cards
  document.querySelectorAll('.tag-controls').forEach(el => el.classList.add('visible'));
  renderPublications(); // re-render to show tag controls
  switchTab('tagging', document.querySelector('.panel-tab'));
}

async function logout() {
  try {
    if (SUPABASE_ENABLED) await sb.auth.signOut();
  } catch(e) { debugLog('signOut error', e); }

  clearAuth();
  loggedIn = false;
  document.getElementById('login-btn').textContent = '🔐 Login';
  document.getElementById('login-btn').classList.remove('logged-in');

  // Hide admin UI
  document.getElementById('panel-auth-screen').style.display = 'block';
  document.getElementById('panel-tabs-bar').style.display = 'none';
  document.getElementById('panel-body').style.display = 'none';
  document.getElementById('logged-strip').style.display = 'none';

  // Reset fields
  document.getElementById('pw-input').value = '';
  document.getElementById('pw-error').textContent = '';

  showToast('Logged out');
}

function togglePwVisibility() {
  const inp = document.getElementById('pw-input');
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

// ═══════════════════════════════════════════════════════
//  LOGIN PANEL OPEN/CLOSE
// ═══════════════════════════════════════════════════════
function openLoginPanel() {
  document.getElementById('login-overlay').classList.add('open');
  document.getElementById('login-panel').classList.add('open');
  if (isAuthenticated() && !loggedIn) activateLoggedInState();
  else if (!loggedIn) setTimeout(() => document.getElementById('pw-input').focus(), 200);
}
function closeLoginPanel() {
  document.getElementById('login-overlay').classList.remove('open');
  document.getElementById('login-panel').classList.remove('open');
}
function closePanelOverlay(e) {
  if (e.target === document.getElementById('login-overlay')) closeLoginPanel();
}

// ═══════════════════════════════════════════════════════
//  PANEL TABS
// ═══════════════════════════════════════════════════════
function switchTab(tab, btn) {
  activeTab = tab;
  ['tagging','impact','activities','pdf'].forEach(t => {
    const el = document.getElementById('tab-' + t);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('.panel-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (tab === 'impact') renderIFPanel();
  if (tab === 'activities') renderActivitiesPanel();
}

// ═══════════════════════════════════════════════════════
//  ORCID FETCH
// ═══════════════════════════════════════════════════════
async function fetchORCID() {
  const loaderStatus = document.getElementById('loader-status');
  const badge     = document.getElementById('orcid-status-badge');
  const badgeText = document.getElementById('orcid-status-text');

  try {
    // Prevent the whole page from getting stuck if ORCID is slow/unreachable
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12000);

    const [worksRes, personRes] = await Promise.all([
      fetch(`${ORCID_API}/${ORCID_ID}/works`,  { headers: { 'Accept': 'application/json' }, signal: controller.signal }),
      fetch(`${ORCID_API}/${ORCID_ID}/person`, { headers: { 'Accept': 'application/json' }, signal: controller.signal })
    ]);

    clearTimeout(t);

    if (personRes.ok) {
      const person = await personRes.json();
      const given  = person.name?.['given-names']?.value || '';
      const family = person.name?.['family-name']?.value || '';
      const bio    = person.biography?.content || '';
      const fullName = [given, family].filter(Boolean).join(' ');
      if (fullName) {
        // Photo is embedded — initials fallback not needed
        // const initials = fullName.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
        // document.getElementById('avatar-initials').textContent = initials;
      }
      if (bio) document.getElementById('field-bio').textContent = bio;
    }

    if (!worksRes.ok) throw new Error(`ORCID ${worksRes.status}`);
    loaderStatus.textContent = 'Processing publications…';
    const data = await worksRes.json();
    const groups = data.group || [];
    const works = [];

    for (const group of groups) {
      const summary = group['work-summary']?.[0];
      if (!summary) continue;
      const title   = summary.title?.title?.value || 'Untitled';
      const year    = summary['publication-date']?.year?.value || null;
      const type    = summary.type || 'other';
      const journal = summary['journal-title']?.value || '';
      const putCode = String(summary['put-code']);
      const extIds  = summary['external-ids']?.['external-id'] || [];
      const doi     = extIds.find(e => e['external-id-type'] === 'doi')?.['external-id-value'] || null;
      const url     = doi ? `https://doi.org/${doi}` : (summary.url?.value || null);
      const summaryAuthors = (summary.contributors?.contributor || [])
        .map(c => c['credit-name']?.value).filter(Boolean).join(', ');
      works.push({ title, year, type, journal, doi, url, putCode, authors: summaryAuthors });
    }

    works.sort((a, b) => (b.year || 0) - (a.year || 0));
    allPublications = works;
    updateStats(works);
    renderPublications();
    badge.className = 'orcid-status';
    badgeText.textContent = `Synced · ${works.length} works · loading authors…`;

    // Fetch individual works for full author lists in batches
    const ordered = [...works.filter(w => !w.authors), ...works.filter(w => w.authors)];
    const BATCH = 5;
    let done = 0;
    for (let i = 0; i < ordered.length; i += BATCH) {
      await Promise.all(ordered.slice(i, i + BATCH).map(async (pub) => {
        try {
          const r  = await fetch(`${ORCID_API}/${ORCID_ID}/work/${pub.putCode}`, { headers: { 'Accept': 'application/json' } });
          if (!r.ok) return;
          const wd = await r.json();
          const names = (wd.contributors?.contributor || []).map(c => c['credit-name']?.value).filter(Boolean);
          if (names.length) {
            pub.authors = names.join(', ');
            const card = document.querySelector(`.pub-item[data-putcode="${pub.putCode}"]`);
            if (card) {
              const el = card.querySelector('.pub-authors');
              if (el) { el.className = 'pub-authors'; el.textContent = pub.authors; }
            }
          } else if (!pub.authors) {
            const card = document.querySelector(`.pub-item[data-putcode="${pub.putCode}"]`);
            if (card) { const el = card.querySelector('.pub-authors'); if (el) el.style.display = 'none'; }
          }
        } catch(e) {}
        done++;
      }));
      loaderStatus.textContent = `Authors: ${Math.min(done, works.length)}/${works.length}`;
      badgeText.textContent = `Synced · ${works.length} works · authors ${Math.min(done, works.length)}/${works.length}`;
    }
    badge.className = 'orcid-status';
    badgeText.textContent = `Synced from ORCID · ${works.length} works`;

  } catch(err) {
    console.error('ORCID error:', err);
    badge.className = 'orcid-status error';
    document.getElementById('orcid-status-text').textContent = 'Could not reach ORCID';
    renderPublications();
    updateStats(allPublications);
  }
}

// ═══════════════════════════════════════════════════════
//  STATS
// ═══════════════════════════════════════════════════════
function updateStats(works) {
  document.getElementById('stat-pubs').textContent = works.length || '—';
  const years = works.map(w => parseInt(w.year)).filter(Boolean);
  if (years.length > 1) document.getElementById('stat-years').textContent = Math.max(...years) - Math.min(...years) + 1;
  else if (years.length === 1) document.getElementById('stat-years').textContent = years[0];
  const journals = new Set(works.map(w => w.journal).filter(Boolean));
  document.getElementById('stat-journals').textContent = journals.size || '—';
  updateIndexStats();
}
function updateIndexStats() {
  document.getElementById('stat-sci').textContent    = allPublications.filter(p => getTag(p.putCode).sci).length    || '—';
  document.getElementById('stat-scopus').textContent = allPublications.filter(p => getTag(p.putCode).scopus).length || '—';
}

// ═══════════════════════════════════════════════════════
//  FILTERS
// ═══════════════════════════════════════════════════════
function getFilteredWorks() {
  let works = allPublications;
  if (currentTypeFilter !== 'all') {
    if (currentTypeFilter === 'other') {
      works = works.filter(w => !['journal-article','conference-paper','book-chapter'].includes(w.type));
    } else {
      works = works.filter(w => w.type === currentTypeFilter);
    }
  }
  if (currentIndexFilter === 'sci')    works = works.filter(w => getTag(w.putCode).sci);
  if (currentIndexFilter === 'scopus') works = works.filter(w => getTag(w.putCode).scopus);
  if (currentIFFilter > 0)             works = works.filter(w => parseFloat(getIF(w.putCode)) >= currentIFFilter);
  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    works = works.filter(w =>
      w.title.toLowerCase().includes(q) ||
      (w.authors || '').toLowerCase().includes(q) ||
      (w.journal || '').toLowerCase().includes(q) ||
      (w.year || '').toString().includes(q)
    );
  }
  return works;
}

function setFilter(group, value, btn) {
  if (group === 'type') {
    currentTypeFilter = value;
    document.querySelectorAll('.pub-filter:not(.sci-filter):not(.scopus-filter)').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  } else {
    if (currentIndexFilter === value) { currentIndexFilter = 'none'; btn.classList.remove('active'); }
    else {
      currentIndexFilter = value;
      document.querySelectorAll('.sci-filter,.scopus-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }
  }
  renderPublications();
}

function setIFFilter(val) {
  currentIFFilter = parseFloat(val) || 0;
  renderPublications();
}

function filterPublications(q) { currentSearch = q; renderPublications(); }

// ═══════════════════════════════════════════════════════
//  RENDER PUBLICATIONS
// ═══════════════════════════════════════════════════════
function typeLabel(type) {
  const map = { 'journal-article':'Journal','conference-paper':'Conference','book-chapter':'Book Chapter','dissertation':'Dissertation','preprint':'Preprint','working-paper':'Working Paper','report':'Report' };
  return map[type] || (type ? type.replace(/-/g,' ') : 'Publication');
}

function renderPublications() {
  const list    = document.getElementById('pub-list');
  const countEl = document.getElementById('pub-count');
  const works   = getFilteredWorks();

  if (allPublications.length === 0) {
    list.innerHTML = '<div class="pub-loading">No publications found on ORCID.</div>';
    countEl.style.display = 'none';
    return;
  }
  countEl.style.display = 'block';
  countEl.textContent = `${works.length} of ${allPublications.length} works`;

  if (works.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>No publications match your filter.</p></div>';
    return;
  }

  list.innerHTML = works.map((pub, i) => {
    const tag         = getTag(pub.putCode);
    const ifVal       = getIF(pub.putCode);
    const sciBadge    = tag.sci    ? '<span class="pub-tag sci">SCI</span>'       : '';
    const scopusBadge = tag.scopus ? '<span class="pub-tag scopus">Scopus</span>' : '';
    const ifBadge     = ifVal      ? `<span class="if-badge">IF ${ifVal}</span>`  : '';
    const doiBtn      = pub.doi
      ? `<button class="pub-btn" onclick="window.open('https://doi.org/${esc(pub.doi)}','_blank')">🔗 DOI</button>`
      : (pub.url ? `<button class="pub-btn" onclick="window.open('${esc(pub.url)}','_blank')">🔗 Link</button>` : '');
    const citeData    = esc(JSON.stringify({ title:pub.title, year:pub.year, journal:pub.journal, doi:pub.doi, authors:pub.authors }));
    const authorsHtml = pub.authors
      ? `<div class="pub-authors">${esc(pub.authors)}</div>`
      : `<div class="pub-authors pub-authors-loading">fetching authors…</div>`;
    const venueHtml   = pub.journal ? `<div class="pub-venue">${esc(pub.journal)}</div>` : '';
    const clickAttr   = pub.url    ? `onclick="window.open('${esc(pub.url)}','_blank')"` : '';
    const tagVisible  = loggedIn ? ' visible' : '';

    return `
      <div class="pub-item" data-putcode="${pub.putCode}" style="animation:fadeUp 0.3s ${i*0.025}s ease both;opacity:0">
        <div class="pub-item-header">
          <div style="flex:1">
            <div class="pub-title" ${clickAttr}>${esc(pub.title)}</div>
            ${authorsHtml}
            ${venueHtml}
          </div>
          ${pub.year ? `<span class="pub-year-pill">${pub.year}</span>` : ''}
        </div>
        <div class="pub-footer">
          ${sciBadge}${scopusBadge}${ifBadge}
          <span class="pub-tag">${typeLabel(pub.type)}</span>
          ${doiBtn}
          <button class="pub-btn" onclick='showCite(${citeData})'>📋 Cite</button>
        </div>
        <div class="tag-controls${tagVisible}">
          <span style="font-family:'DM Mono',monospace;font-size:0.65rem;color:var(--muted)">Tag:</span>
          <button class="tag-check-label sci-check${tag.sci?' checked':''}" onclick="toggleTag('${pub.putCode}','sci')">
            ${tag.sci?'☑':'☐'} SCI
          </button>
          <button class="tag-check-label scopus-check${tag.scopus?' checked':''}" onclick="toggleTag('${pub.putCode}','scopus')">
            ${tag.scopus?'☑':'☐'} Scopus
          </button>
          <div class="if-input-wrap">
            <span class="if-label">IF:</span>
            <input class="if-input" type="number" step="0.001" min="0" placeholder="—"
              value="${ifVal}"
              onchange="setImpactFactor('${pub.putCode}', this.value)"
              title="Impact Factor (optional)">
          </div>
          <span class="tag-controls-hint">auto-saved</span>
        </div>
      </div>`;
  }).join('');
}

function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ═══════════════════════════════════════════════════════
//  TAGGING
// ═══════════════════════════════════════════════════════
function toggleTag(putCode, type) {
  if (!tags[putCode]) tags[putCode] = { sci: false, scopus: false };
  tags[putCode][type] = !tags[putCode][type];
  saveTags();
  const card = document.querySelector(`.pub-item[data-putcode="${putCode}"]`);
  if (!card) return;
  const btn = card.querySelector(`.${type}-check`);
  if (btn) {
    const isOn = tags[putCode][type];
    btn.classList.toggle('checked', isOn);
    btn.textContent = (isOn ? '☑ ' : '☐ ') + (type === 'sci' ? 'SCI' : 'Scopus');
  }
  updateCardBadges(card, putCode);
}

function updateCardBadges(card, putCode) {
  const tag    = getTag(putCode);
  const footer = card.querySelector('.pub-footer');
  if (!footer) return;
  footer.querySelectorAll('.pub-tag.sci,.pub-tag.scopus').forEach(el => el.remove());
  if (tag.scopus) footer.insertAdjacentHTML('afterbegin', '<span class="pub-tag scopus">Scopus</span>');
  if (tag.sci)    footer.insertAdjacentHTML('afterbegin', '<span class="pub-tag sci">SCI</span>');
}

// ═══════════════════════════════════════════════════════
//  IMPACT FACTORS
// ═══════════════════════════════════════════════════════
function setImpactFactor(putCode, value) {
  const val = value.trim();
  if (val === '' || val === '0') { delete impactFactors[putCode]; }
  else { impactFactors[putCode] = val; }
  saveIFs();
  // Update badge on card
  const card = document.querySelector(`.pub-item[data-putcode="${putCode}"]`);
  if (card) {
    const footer = card.querySelector('.pub-footer');
    if (footer) {
      footer.querySelectorAll('.if-badge').forEach(el => el.remove());
      if (impactFactors[putCode]) {
        const tagEl = footer.querySelector('.pub-tag');
        if (tagEl) tagEl.insertAdjacentHTML('beforebegin', `<span class="if-badge">IF ${impactFactors[putCode]}</span>`);
        else footer.insertAdjacentHTML('afterbegin', `<span class="if-badge">IF ${impactFactors[putCode]}</span>`);
      }
    }
  }
}

function renderIFPanel() {
  const container = document.getElementById('if-pub-list');
  if (!container) return;
  const journals = allPublications.filter(p => p.type === 'journal-article');
  if (journals.length === 0) {
    container.innerHTML = '<div class="act-empty">No journal articles found.</div>';
    return;
  }
  container.innerHTML = journals.map(pub => {
    const ifVal = getIF(pub.putCode);
    return `
      <div style="background:var(--bg);border:1px solid var(--rule);border-radius:6px;padding:0.75rem 1rem;margin-bottom:0.5rem">
        <div style="font-size:0.82rem;font-weight:500;color:var(--ink);margin-bottom:0.4rem;line-height:1.3">${esc(pub.title)}</div>
        <div style="font-size:0.72rem;color:var(--muted);margin-bottom:0.5rem;font-style:italic">${esc(pub.journal||'—')} · ${pub.year||'—'}</div>
        <div class="if-input-wrap">
          <span class="if-label">Impact Factor:</span>
          <input class="if-input" type="number" step="0.001" min="0" placeholder="e.g. 3.14"
            value="${esc(ifVal)}"
            onchange="setImpactFactor('${pub.putCode}', this.value)"
            style="width:100px">
          ${ifVal ? `<span class="if-badge">IF ${ifVal}</span>` : ''}
        </div>
      </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════
//  ACTIVITIES
// ═══════════════════════════════════════════════════════
function addActivity() {
  const type  = document.getElementById('act-type').value;
  const title = document.getElementById('act-title').value.trim();
  const org   = document.getElementById('act-org').value.trim();
  const date  = document.getElementById('act-date').value.trim();
  const notes = document.getElementById('act-notes').value.trim();
  if (!title) { showToast('Please enter a title'); return; }
  activities.unshift({ id: Date.now(), type, title, org, date, notes });
  saveActivities();
  renderActivitiesPanel();
  // Clear form
  document.getElementById('act-title').value = '';
  document.getElementById('act-org').value   = '';
  document.getElementById('act-date').value  = '';
  document.getElementById('act-notes').value = '';
  showToast('Activity added ✓');
}

function deleteActivity(id) {
  activities = activities.filter(a => a.id !== id);
  saveActivities();
  renderActivitiesPanel();
}

function renderActivitiesPanel() {
  const list = document.getElementById('act-list');
  if (!list) return;
  if (activities.length === 0) {
    list.innerHTML = '<div class="act-empty">No activities added yet.</div>';
    return;
  }
  list.innerHTML = activities.map(a => `
    <div class="act-item">
      <div class="act-item-type">${esc(a.type)}</div>
      <div class="act-item-title">${esc(a.title)}</div>
      <div class="act-item-meta">${[a.org, a.date].filter(Boolean).join(' · ')}</div>
      ${a.notes ? `<div style="font-size:0.75rem;color:var(--ink3);margin-top:0.2rem;font-weight:300">${esc(a.notes)}</div>` : ''}
      <button class="act-del-btn" onclick="deleteActivity(${a.id})" title="Delete">✕</button>
    </div>`).join('');
}

// Group activities by type for public view
const ACT_ICONS = {
  'National Conference': '🇮🇳', 'International Conference': '🌐',
  'Book / Edited Book': '📗', 'Book Chapter': '📖',
  'Seminar': '🎙', 'Webinar': '💻', 'Workshop': '🛠', 'FDP': '🎓'
};

function renderActivitiesPublic() {
  const container = document.getElementById('activities-public-list');
  if (!container) return;
  if (activities.length === 0) {
    container.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:0.75rem;color:var(--muted);text-align:center;padding:2rem">No activities added yet.</div>';
    return;
  }
  // Group by type
  const grouped = {};
  activities.forEach(a => {
    if (!grouped[a.type]) grouped[a.type] = [];
    grouped[a.type].push(a);
  });
  container.innerHTML = Object.entries(grouped).map(([type, items]) => `
    <div style="margin-bottom:2rem">
      <div style="font-family:'DM Mono',monospace;font-size:0.65rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);margin-bottom:0.9rem;display:flex;align-items:center;gap:0.6rem">
        ${ACT_ICONS[type]||'📌'} ${esc(type)}
        <span style="flex:1;height:1px;background:var(--rule);display:block"></span>
      </div>
      <div style="display:flex;flex-direction:column;gap:0.5rem">
        ${items.map(a => `
          <div style="background:var(--white);border:1px solid var(--rule);border-radius:7px;padding:0.9rem 1.1rem;display:flex;gap:1rem;align-items:flex-start">
            <div style="flex:1">
              <div style="font-family:'Cormorant Garamond',serif;font-size:1rem;font-weight:600;color:var(--ink);margin-bottom:0.2rem">${esc(a.title)}</div>
              ${a.org || a.date ? `<div style="font-family:'DM Mono',monospace;font-size:0.65rem;color:var(--muted)">${[a.org,a.date].filter(Boolean).join(' · ')}</div>` : ''}
              ${a.notes ? `<div style="font-size:0.78rem;color:var(--ink3);margin-top:0.3rem;font-weight:300">${esc(a.notes)}</div>` : ''}
            </div>
          </div>`).join('')}
      </div>
    </div>`).join('');
}

// ═══════════════════════════════════════════════════════
//  CITE MODAL
// ═══════════════════════════════════════════════════════
let currentCite = '';
function showCite(pub) {
  const authors = pub.authors || 'Mandal, S.';
  const doi     = pub.doi    ? ` https://doi.org/${pub.doi}` : '';
  const journal = pub.journal ? ` ${pub.journal}.` : '';
  currentCite = `${authors} (${pub.year || 'n.d.'}). ${pub.title}.${journal}${doi}`;
  document.getElementById('cite-content').textContent = currentCite;
  document.getElementById('cite-modal').classList.add('open');
}
function closeCiteModal(e) {
  if (!e || e.target === document.getElementById('cite-modal'))
    document.getElementById('cite-modal').classList.remove('open');
}
function copyCitation() {
  navigator.clipboard.writeText(currentCite).then(() => showToast('Citation copied!'));
}

// ═══════════════════════════════════════════════════════
//  PDF / PRINT
// ═══════════════════════════════════════════════════════
function triggerPrint() {
  closeLoginPanel();
  showToast('Opening print dialog… select "Save as PDF"');
  setTimeout(() => window.print(), 500);
}

// ═══════════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════════
function scrollToSection(id, btn) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.querySelectorAll('.topbar-link').forEach(l => l.classList.remove('active'));
  if (btn) btn.classList.add('active');
}
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

// ═══════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════
async function init() {
  await loadStorage();
  renderActivitiesPublic();

  // Admin session (Supabase) preferred. Falls back to legacy local flag.
  const session = await getSessionSafe();
  if (session) {
    loggedIn = true;
    document.getElementById('login-btn').textContent = '⚙ Admin';
    document.getElementById('login-btn').classList.add('logged-in');
  } else if (isAuthenticated()) {
    // Restore logged-in state silently (no panel open)
    loggedIn = true;
    document.getElementById('login-btn').textContent = '⚙ Admin';
    document.getElementById('login-btn').classList.add('logged-in');
  }
  await fetchORCID();
  setTimeout(() => {
    const o = document.getElementById('loading-overlay');
    o.classList.add('hidden');
    setTimeout(() => o.style.display = 'none', 400);
  }, 500);
}

init();
