// ═══════════════════════════════════════════════════════
//  CONFIG & CONSTANTS
// ═══════════════════════════════════════════════════════
const ORCID_ID  = '0000-0002-2860-2754';
const ORCID_API = 'https://pub.orcid.org/v3.0';

const AUTH_KEY = 'sourab_tag_auth_v1';
const TAG_KEY  = 'sourab_index_tags_v2';
const IF_KEY   = 'sourab_impact_factors_v1';
const ACT_KEY  = 'sourab_activities_v1';

// SHA-256 of password: Sourab@2024
// To change password: run in browser console →
//   crypto.subtle.digest('SHA-256', new TextEncoder().encode('YourNewPassword'))
//     .then(b => console.log(Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('')))
// Then replace the hash below and re-deploy.
const ADMIN_PASSWORD_HASH =
  "77dabf0621c2a057469e9fa2134491016b05c791006939f0330f52d718ae6b7e";


// ═══════════════════════════════════════════════════════
//  SUPABASE  (persistent storage for GitHub Pages)
//  Configure in config.js (window.SITE_CONFIG)
//  NOTE: RLS must allow anon upserts — see README.
// ═══════════════════════════════════════════════════════
const CFG = (window.SITE_CONFIG || {});
const SUPABASE_ENABLED = !!(
  CFG.SUPABASE_URL &&
  CFG.SUPABASE_ANON_KEY &&
  typeof supabase !== 'undefined'
);

let sb = null;
if (SUPABASE_ENABLED) {
  sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
}

function debugLog(...args) {
  if (CFG.DEBUG) console.log('[debug]', ...args);
}

async function loadRemoteState() {
  if (!SUPABASE_ENABLED) return null;
  try {
    const { data, error } = await sb
      .from('site_state')
      .select('tags, impact_factors, activities')
      .eq('id', CFG.STATE_ROW_ID || 1)
      .single();
    if (error) { debugLog('loadRemoteState error', error); return null; }
    return data || null;
  } catch (e) { debugLog('loadRemoteState exception', e); return null; }
}

async function saveRemoteState() {
  if (!SUPABASE_ENABLED) return;
  const payload = {
    id: CFG.STATE_ROW_ID || 1,
    tags: tags || {},
    impact_factors: impactFactors || {},
    activities: activities || [],
    updated_at: new Date().toISOString()
  };
  try {
    const { error } = await sb.from('site_state').upsert(payload, { onConflict: 'id' });
    if (error) { debugLog('saveRemoteState error', error); showToast('Save failed ✗'); }
    else { showToast('Saved ✓'); }
  } catch (e) { debugLog('saveRemoteState exception', e); showToast('Save failed ✗'); }
}


// ═══════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════
let allPublications    = [];
let currentTypeFilter  = 'all';
let currentIndexFilter = 'none';
let currentIFFilter    = 0;
let currentSearch      = '';

let tags          = {};
let impactFactors = {};
let activities    = [];

let loggedIn  = false;
let activeTab = 'tagging';


// ═══════════════════════════════════════════════════════
//  STORAGE
// ═══════════════════════════════════════════════════════
async function loadStorage() {
  try { tags          = JSON.parse(localStorage.getItem(TAG_KEY) || '{}'); } catch(e) { tags = {}; }
  try { impactFactors = JSON.parse(localStorage.getItem(IF_KEY)  || '{}'); } catch(e) { impactFactors = {}; }
  try { activities    = JSON.parse(localStorage.getItem(ACT_KEY) || '[]'); } catch(e) { activities = []; }

  const remote = await loadRemoteState();
  if (remote) {
    tags          = remote.tags           || {};
    impactFactors = remote.impact_factors || {};
    activities    = remote.activities     || [];
    localStorage.setItem(TAG_KEY, JSON.stringify(tags));
    localStorage.setItem(IF_KEY,  JSON.stringify(impactFactors));
    localStorage.setItem(ACT_KEY, JSON.stringify(activities));
  }
}

function saveTags() {
  localStorage.setItem(TAG_KEY, JSON.stringify(tags));
  updateIndexStats();
  saveRemoteState();
}

function saveIFs() {
  localStorage.setItem(IF_KEY, JSON.stringify(impactFactors));
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
//  AUTH  (local SHA-256 hash — no Supabase Auth needed)
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
  const pwd      = document.getElementById('pw-input').value;
  const err      = document.getElementById('pw-error');
  const inp      = document.getElementById('pw-input');
  const remember = document.getElementById('pw-remember').checked;

  if (!pwd) { err.textContent = 'Please enter your password.'; return; }

  const hash = await hashString(pwd);
  if (hash === ADMIN_PASSWORD_HASH) {
    setAuthenticated(remember);
    activateLoggedInState();
    showToast('Admin unlocked ✓');
    err.textContent = '';
  } else {
    err.textContent = 'Incorrect password.';
    inp.classList.remove('shake');
    void inp.offsetWidth;
    inp.classList.add('shake');
    inp.select();
  }
}

function activateLoggedInState() {
  loggedIn = true;
  document.getElementById('panel-auth-screen').style.display = 'none';
  document.getElementById('logged-strip').style.display      = 'flex';
  document.getElementById('panel-tabs-bar').style.display    = 'block';
  document.getElementById('panel-body').style.display        = 'block';
  document.getElementById('panel-title').textContent         = '⚙ Admin Panel';
  document.getElementById('login-btn').textContent           = '⚙ Admin';
  document.getElementById('login-btn').classList.add('logged-in');
  document.getElementById('tag-banner').classList.add('visible');

  document.querySelectorAll('.tag-controls').forEach(el => el.classList.add('visible'));

  renderPublications();
  renderIFList();
  renderAdminActivityList();

  const firstTab = document.querySelector('.panel-tab');
  if (firstTab) switchTab('tagging', firstTab);
}

function logout() {
  clearAuth();
  loggedIn = false;
  document.getElementById('login-btn').textContent = '🔐 Login';
  document.getElementById('login-btn').classList.remove('logged-in');
  document.getElementById('panel-auth-screen').style.display = 'block';
  document.getElementById('panel-tabs-bar').style.display    = 'none';
  document.getElementById('panel-body').style.display        = 'none';
  document.getElementById('logged-strip').style.display      = 'none';
  document.getElementById('tag-banner').classList.remove('visible');
  document.querySelectorAll('.tag-controls').forEach(el => el.classList.remove('visible'));
  renderPublications();
  showToast('Logged out');
}

function togglePwVisibility() {
  const inp = document.getElementById('pw-input');
  inp.type = inp.type === 'password' ? 'text' : 'password';
}


// ═══════════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════════
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}


// ═══════════════════════════════════════════════════════
//  LOGIN PANEL
// ═══════════════════════════════════════════════════════
function openLoginPanel() {
  document.getElementById('login-panel').classList.add('open');
  document.getElementById('login-overlay').classList.add('open');
  if (loggedIn) {
    renderIFList();
    renderAdminActivityList();
  }
}
function closeLoginPanel() {
  document.getElementById('login-panel').classList.remove('open');
  document.getElementById('login-overlay').classList.remove('open');
}
function closePanelOverlay(e) {
  if (e.target === document.getElementById('login-overlay')) closeLoginPanel();
}


// ═══════════════════════════════════════════════════════
//  TABS
// ═══════════════════════════════════════════════════════
function switchTab(tab, btn) {
  activeTab = tab;
  ['tagging', 'impact', 'activities', 'pdf'].forEach(t => {
    document.getElementById('tab-' + t).style.display = (t === tab) ? 'block' : 'none';
  });
  document.querySelectorAll('.panel-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  if (tab === 'impact')     renderIFList();
  if (tab === 'activities') renderAdminActivityList();
}


// ═══════════════════════════════════════════════════════
//  NAV
// ═══════════════════════════════════════════════════════
function scrollToSection(id, btn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.querySelectorAll('.topbar-link').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}


// ═══════════════════════════════════════════════════════
//  ORCID FETCH
// ═══════════════════════════════════════════════════════
async function fetchORCID() {
  const list = document.getElementById('pub-list');
  list.innerHTML = '<div class="pub-loading"><div class="pub-loading-spinner"></div>Loading publications from ORCID…</div>';

  setOrcidStatus('loading', 'Connecting…');

  try {
    const res = await fetch(`${ORCID_API}/${ORCID_ID}/works`, {
      headers: { Accept: 'application/json' }
    });
    if (!res.ok) throw new Error('ORCID API ' + res.status);
    const data = await res.json();

    const groups = data.group || [];
    allPublications = groups.map(g => {
      const summary = g['work-summary'][0];
      const putCode = String(summary['put-code']);
      const type    = (summary.type || 'other').toLowerCase();
      const year    = summary['publication-date']?.year?.value || '';
      const title   = summary.title?.title?.value || 'Untitled';
      const journal = summary['journal-title']?.value || '';
      const url     = summary.url?.value || '';
      const extIds  = summary['external-ids']?.['external-id'] || [];
      const doi     = extIds.find(e => e['external-id-type'] === 'doi')?.['external-id-value'] || '';
      return { putCode, type, year, title, journal, url, doi, authors: null };
    });

    // Sort newest first
    allPublications.sort((a, b) => (parseInt(b.year) || 0) - (parseInt(a.year) || 0));

    renderPublications();
    updateIndexStats();
    setOrcidStatus('connected', `${allPublications.length} works`);

    // Fetch full author details in background
    fetchAuthorsBackground();

  } catch (err) {
    debugLog('fetchORCID error', err);
    list.innerHTML = `<div class="pub-loading" style="color:var(--red)">Could not load publications.
      <a href="https://orcid.org/${ORCID_ID}" target="_blank" style="color:var(--accent);margin-left:0.4rem">View on ORCID ↗</a></div>`;
    setOrcidStatus('error', 'Connection failed');
  }
}

function setOrcidStatus(state, text) {
  const el = document.getElementById('orcid-status');
  if (!el) return;
  el.className = 'orcid-status' + (state === 'error' ? ' error' : state === 'loading' ? ' loading' : '');
  const dot = el.querySelector('.orcid-dot');
  if (dot) {
    dot.style.background = state === 'error' ? '#ef4444' : state === 'loading' ? '#9ca3af' : '#a6ce39';
  }
  const label = el.querySelector('.orcid-label');
  if (label) label.textContent = text;
}

async function fetchAuthorsBackground() {
  for (const pub of allPublications) {
    try {
      const res = await fetch(`${ORCID_API}/${ORCID_ID}/work/${pub.putCode}`, {
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) continue;
      const detail = await res.json();
      const contributors = detail.contributors?.contributor || [];
      if (contributors.length > 0) {
        pub.authors = contributors
          .map(c => c['credit-name']?.value || '')
          .filter(Boolean)
          .join(', ');
      }
      const authorEl = document.getElementById(`authors-${pub.putCode}`);
      if (authorEl && pub.authors) {
        authorEl.className = 'pub-authors';
        authorEl.textContent = pub.authors;
      }
    } catch (e) { /* skip on error */ }
    await new Promise(r => setTimeout(r, 150));
  }
}


// ═══════════════════════════════════════════════════════
//  FILTERING
// ═══════════════════════════════════════════════════════
function setFilter(kind, value, btn) {
  if (kind === 'type') {
    currentTypeFilter = value;
    document.querySelectorAll('.pub-filter:not(.sci-filter):not(.scopus-filter)')
      .forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  } else if (kind === 'index') {
    currentIndexFilter = (currentIndexFilter === value) ? 'none' : value;
    document.querySelectorAll('.sci-filter, .scopus-filter').forEach(b => b.classList.remove('active'));
    if (currentIndexFilter !== 'none') btn.classList.add('active');
  }
  renderPublications();
}

function filterPublications(val) {
  currentSearch = val.toLowerCase().trim();
  renderPublications();
}

function setIFFilter(val) {
  currentIFFilter = parseFloat(val) || 0;
  renderPublications();
}

function matchesFilters(pub) {
  if (currentTypeFilter !== 'all') {
    const t = pub.type;
    if (currentTypeFilter === 'journal-article'  && t !== 'journal-article')  return false;
    if (currentTypeFilter === 'conference-paper'  && t !== 'conference-paper')  return false;
    if (currentTypeFilter === 'book-chapter'      && t !== 'book-chapter')      return false;
    if (currentTypeFilter === 'other' &&
        (t === 'journal-article' || t === 'conference-paper' || t === 'book-chapter')) return false;
  }
  if (currentIndexFilter !== 'none') {
    const tag = getTag(pub.putCode);
    if (currentIndexFilter === 'sci'    && !tag.sci)    return false;
    if (currentIndexFilter === 'scopus' && !tag.scopus) return false;
  }
  if (currentIFFilter > 0) {
    const ifVal = parseFloat(getIF(pub.putCode));
    if (!ifVal || ifVal < currentIFFilter) return false;
  }
  if (currentSearch) {
    const hay = [pub.title, pub.journal, pub.authors || '', pub.year].join(' ').toLowerCase();
    if (!hay.includes(currentSearch)) return false;
  }
  return true;
}


// ═══════════════════════════════════════════════════════
//  RENDER PUBLICATIONS
// ═══════════════════════════════════════════════════════
function renderPublications() {
  const list     = document.getElementById('pub-list');
  const filtered = allPublications.filter(matchesFilters);
  const countEl  = document.getElementById('pub-count');

  const isFiltered = currentSearch || currentTypeFilter !== 'all' ||
                     currentIndexFilter !== 'none' || currentIFFilter > 0;
  if (isFiltered) {
    countEl.textContent  = `${filtered.length} of ${allPublications.length}`;
    countEl.style.display = 'block';
  } else {
    countEl.style.display = 'none';
  }

  if (filtered.length === 0) {
    list.innerHTML = '<div class="pub-loading" style="color:var(--muted)">No publications match your filters.</div>';
    return;
  }

  list.innerHTML = filtered.map(pub => buildPubCard(pub)).join('');
}

function buildPubCard(pub) {
  const tag       = getTag(pub.putCode);
  const ifVal     = getIF(pub.putCode);
  const typeLabel = typeToLabel(pub.type);
  const doiLink   = pub.doi ? `https://doi.org/${pub.doi}` : pub.url;

  const sciBadge    = tag.sci    ? '<span class="pub-tag sci">SCI</span>'       : '';
  const scopusBadge = tag.scopus ? '<span class="pub-tag scopus">Scopus</span>' : '';
  const ifBadge     = ifVal      ? `<span class="pub-tag if-badge">IF&nbsp;${ifVal}</span>` : '';
  const typeBadge   = `<span class="pub-tag">${typeLabel}</span>`;

  const tagControls = loggedIn ? `
    <div class="tag-controls visible">
      <label class="tag-check sci-check">
        <input type="checkbox" ${tag.sci ? 'checked' : ''}
          onchange="toggleTag('${pub.putCode}','sci',this.checked)"> SCI
      </label>
      <label class="tag-check scopus-check">
        <input type="checkbox" ${tag.scopus ? 'checked' : ''}
          onchange="toggleTag('${pub.putCode}','scopus',this.checked)"> Scopus
      </label>
    </div>` : '<div class="tag-controls"></div>';

  const authorHtml = pub.authors
    ? `<div class="pub-authors" id="authors-${pub.putCode}">${pub.authors}</div>`
    : `<div class="pub-authors-loading" id="authors-${pub.putCode}">Loading authors…</div>`;

  const titleClick = doiLink
    ? `onclick="window.open('${doiLink.replace(/'/g,"\\'")}','_blank')"`
    : '';
  const doiBtn = doiLink
    ? `<button class="pub-btn" onclick="window.open('${doiLink.replace(/'/g,"\\'")}','_blank')">DOI ↗</button>`
    : '';

  return `
    <div class="pub-item" id="pub-${pub.putCode}">
      <div class="pub-item-header">
        <div style="flex:1">
          <div class="pub-title" ${titleClick}>${pub.title}</div>
          ${authorHtml}
          ${pub.journal ? `<div class="pub-venue">${pub.journal}</div>` : ''}
        </div>
        <div class="pub-year-pill">${pub.year || '—'}</div>
      </div>
      <div class="pub-footer">
        ${typeBadge}${sciBadge}${scopusBadge}${ifBadge}
        ${doiBtn}
        <button class="pub-btn" onclick="openCiteModal('${pub.putCode}')">Cite</button>
        <div style="margin-left:auto">${tagControls}</div>
      </div>
    </div>`;
}

function typeToLabel(type) {
  const map = {
    'journal-article':   'Journal',
    'conference-paper':  'Conference',
    'book-chapter':      'Book Chapter',
    'book':              'Book',
    'preprint':          'Preprint',
    'dataset':           'Dataset',
    'other':             'Other'
  };
  return map[type] || 'Other';
}

function toggleTag(putCode, field, checked) {
  if (!tags[putCode]) tags[putCode] = { sci: false, scopus: false };
  tags[putCode][field] = checked;
  saveTags();
  renderPublications();
}


// ═══════════════════════════════════════════════════════
//  STATS STRIP
// ═══════════════════════════════════════════════════════
function updateIndexStats() {
  const total       = allPublications.length;
  const sciCount    = allPublications.filter(p => getTag(p.putCode).sci).length;
  const scopusCount = allPublications.filter(p => getTag(p.putCode).scopus).length;

  const elTotal  = document.getElementById('stat-total');
  const elSci    = document.getElementById('stat-sci');
  const elScopus = document.getElementById('stat-scopus');

  if (elTotal)  elTotal.textContent  = total;
  if (elSci)    elSci.textContent    = sciCount;
  if (elScopus) elScopus.textContent = scopusCount;
}


// ═══════════════════════════════════════════════════════
//  CITATION MODAL
// ═══════════════════════════════════════════════════════
function openCiteModal(putCode) {
  const pub = allPublications.find(p => p.putCode === putCode);
  if (!pub) return;

  const authors = pub.authors || 'Author(s)';
  const year    = pub.year    || 'n.d.';
  const doi     = pub.doi     ? `https://doi.org/${pub.doi}` : (pub.url || '');
  const journal = pub.journal || '';

  let cite = `${authors} (${year}). ${pub.title}.`;
  if (journal) cite += ` <em>${journal}</em>.`;
  if (doi)     cite += ` <a href="${doi}" target="_blank" style="color:var(--accent)">${doi}</a>`;

  document.getElementById('cite-content').innerHTML = cite;
  document.getElementById('cite-modal').classList.add('open');
}

function closeCiteModal(e) {
  if (!e || e.target === document.getElementById('cite-modal')) {
    document.getElementById('cite-modal').classList.remove('open');
  }
}

function copyCitation() {
  const text = document.getElementById('cite-content').innerText;
  navigator.clipboard.writeText(text)
    .then(() => showToast('Copied ✓'))
    .catch(() => showToast('Copy failed'));
}


// ═══════════════════════════════════════════════════════
//  IMPACT FACTOR LIST (admin panel)
// ═══════════════════════════════════════════════════════
function renderIFList() {
  const el = document.getElementById('if-pub-list');
  if (!el) return;

  const journals = allPublications.filter(p => p.type === 'journal-article');
  if (journals.length === 0) {
    el.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:0.72rem;color:var(--muted);text-align:center;padding:1rem">No journal articles loaded yet.</div>';
    return;
  }

  el.innerHTML = journals.map(pub => `
    <div style="display:flex;align-items:center;gap:0.8rem;padding:0.6rem 0.8rem;background:var(--bg);border:1px solid var(--rule);border-radius:6px">
      <div style="flex:1;font-size:0.78rem;color:var(--ink);line-height:1.3">${pub.title}</div>
      <input type="number" min="0" step="0.001" placeholder="IF"
        value="${getIF(pub.putCode)}"
        style="width:72px;background:var(--white);border:1px solid var(--rule);border-radius:4px;padding:0.3rem 0.5rem;font-family:'DM Mono',monospace;font-size:0.7rem;text-align:center;outline:none;"
        onchange="setIF('${pub.putCode}', this.value)"
        title="${pub.title.replace(/"/g,'&quot;')}">
    </div>`).join('');
}

function setIF(putCode, val) {
  if (val === '' || val === null) {
    delete impactFactors[putCode];
  } else {
    const n = parseFloat(val);
    if (!isNaN(n) && n >= 0) impactFactors[putCode] = n.toString();
    else delete impactFactors[putCode];
  }
  saveIFs();
  renderPublications();
}


// ═══════════════════════════════════════════════════════
//  ACTIVITIES
// ═══════════════════════════════════════════════════════
function addActivity() {
  const type  = document.getElementById('act-type').value.trim();
  const title = document.getElementById('act-title').value.trim();
  const org   = document.getElementById('act-org').value.trim();
  const date  = document.getElementById('act-date').value.trim();
  const notes = document.getElementById('act-notes').value.trim();

  if (!title) { showToast('Please enter a title.'); return; }

  activities.unshift({ id: Date.now(), type, title, org, date, notes });
  saveActivities();
  renderAdminActivityList();

  document.getElementById('act-title').value = '';
  document.getElementById('act-org').value   = '';
  document.getElementById('act-date').value  = '';
  document.getElementById('act-notes').value = '';
  showToast('Activity added ✓');
}

function deleteActivity(id) {
  activities = activities.filter(a => a.id !== id);
  saveActivities();
  renderAdminActivityList();
}

function renderAdminActivityList() {
  const el = document.getElementById('act-list');
  if (!el) return;
  if (activities.length === 0) {
    el.innerHTML = '<div class="act-empty">No activities yet. Add one above.</div>';
    return;
  }
  el.innerHTML = activities.map(a => `
    <div class="act-item">
      <div class="act-item-type">${a.type}</div>
      <div class="act-item-title">${a.title}</div>
      <div class="act-item-meta">${[a.org, a.date, a.notes].filter(Boolean).join(' · ')}</div>
      <button class="act-del-btn" onclick="deleteActivity(${a.id})" title="Delete">✕</button>
    </div>`).join('');
}

function renderActivitiesPublic() {
  const el = document.getElementById('activities-public-list');
  if (!el) return;

  if (!activities || activities.length === 0) {
    el.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:0.75rem;color:var(--muted);text-align:center;padding:2rem">No activities added yet.</div>';
    return;
  }

  // Group by type
  const grouped = {};
  activities.forEach(a => {
    if (!grouped[a.type]) grouped[a.type] = [];
    grouped[a.type].push(a);
  });

  el.innerHTML = Object.entries(grouped).map(([type, items]) => `
    <div style="margin-bottom:1.5rem">
      <div style="font-family:'DM Mono',monospace;font-size:0.65rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--accent);margin-bottom:0.6rem;padding-bottom:0.4rem;border-bottom:1px solid var(--rule)">${type}</div>
      ${items.map(a => `
        <div style="padding:0.7rem 1rem;background:var(--white);border:1px solid var(--rule);border-radius:6px;margin-bottom:0.5rem">
          <div style="font-size:0.88rem;font-weight:500;color:var(--ink)">${a.title}</div>
          <div style="font-size:0.75rem;color:var(--muted);margin-top:0.2rem">${[a.org, a.date].filter(Boolean).join(' · ')}</div>
          ${a.notes ? `<div style="font-size:0.75rem;color:var(--ink3);margin-top:0.2rem;font-style:italic">${a.notes}</div>` : ''}
        </div>`).join('')}
    </div>`).join('');
}


// ═══════════════════════════════════════════════════════
//  PDF / PRINT
// ═══════════════════════════════════════════════════════
function triggerPrint() {
  closeLoginPanel();
  setTimeout(() => window.print(), 300);
}


// ═══════════════════════════════════════════════════════
//  INIT
//  FIX 1: Password hash is correct (Sourab@2024)
//  FIX 2: Loading overlay is hidden immediately — no splash screen
//  FIX 3: Supabase saves work with anon role (update RLS per README)
// ═══════════════════════════════════════════════════════
async function init() {
  // Hide the loading overlay immediately — no splash screen on page open
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.style.display = 'none';

  // Load saved data (local cache first, then sync from Supabase)
  await loadStorage();
  renderActivitiesPublic();
  updateIndexStats();

  // Restore admin session if previously logged in
  if (isAuthenticated()) {
    loggedIn = true;
    document.getElementById('login-btn').textContent = '⚙ Admin';
    document.getElementById('login-btn').classList.add('logged-in');
    document.getElementById('tag-banner').classList.add('visible');
  }

  // Fetch ORCID publications in background — doesn't block page
  fetchORCID();
}

init();
