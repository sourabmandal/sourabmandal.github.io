// ═══════════════════════════════════════════════════════
//  CONFIG & CONSTANTS
// ═══════════════════════════════════════════════════════
const ORCID_ID  = '0000-0002-2860-2754';
const ORCID_API = 'https://pub.orcid.org/v3.0';

const AUTH_KEY  = 'sourab_tag_auth_v1';
const TAG_KEY   = 'sourab_index_tags_v2';
const IF_KEY    = 'sourab_impact_factors_v1';
const ACT_KEY   = 'sourab_activities_v1';

const ADMIN_PASSWORD_HASH =
  "b03ddf3ca2e714a6548e749f1b0c4ce3e06a5a7d61f08cc2c1fbbf5a5a7f8a32";


// ═══════════════════════════════════════════════════════
//  SUPABASE (PERSISTENT STORAGE FOR GITHUB PAGES)
//  Configure in config.js (window.SITE_CONFIG)
//  NOTE: We are NOT using Supabase Auth anymore.
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

  const payload = {
    id: CFG.STATE_ROW_ID || 1,
    tags: tags || {},
    impact_factors: impactFactors || {},
    activities: activities || [],
    updated_at: new Date().toISOString()
  };

  try {
    const { error } = await sb.from('site_state').upsert(payload, { onConflict: 'id' });
    if (error) {
      debugLog('saveRemoteState error', error);
      showToast('Save failed');
    } else {
      showToast('Saved ✓');
    }
  } catch (e) {
    debugLog('saveRemoteState exception', e);
    showToast('Save failed');
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
//  AUTH (LOCAL ONLY — hardcoded hash)
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

  const hash = await hashString(pwd);

  if (hash === ADMIN_PASSWORD_HASH) {
    setAuthenticated(remember);
    activateLoggedInState();
    showToast('Admin unlocked ✓');
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
  const firstTabBtn = document.querySelector('.panel-tab');
  if (firstTabBtn) switchTab('tagging', firstTabBtn);
}

function logout() {
  clearAuth();
  loggedIn = false;

  document.getElementById('login-btn').textContent = '🔐 Login';
  document.getElementById('login-btn').classList.remove('logged-in');

  // Hide admin UI
  document.getElementById('panel-auth-screen').style.display = 'block';
  document.getElementById('panel-tabs-bar').style.display = 'none';
  document.getElementById('panel-body').style.display = 'none';
  document.getElementById('logged-strip').style.display = 'none';

  // Hide tagging controls on pub cards
  document.querySelectorAll('.tag-controls').forEach(el => el.classList.remove('visible'));
  renderPublications();

  showToast('Logged out');
}

function togglePwVisibility() {
  const inp = document.getElementById('pw-input');
  inp.type = inp.type === 'password' ? 'text' : 'password';
}


// ═══════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════
async function init() {
  await loadStorage();
  renderActivitiesPublic();

  // Restore admin state from local flag
  if (isAuthenticated()) {
    loggedIn = true;
    document.getElementById('login-btn').textContent = '⚙ Admin';
    document.getElementById('login-btn').classList.add('logged-in');
    // Tag controls will appear when panel opens or when we re-render
  }

  await fetchORCID();

  setTimeout(() => {
    const o = document.getElementById('loading-overlay');
    o.classList.add('hidden');
    setTimeout(() => o.style.display = 'none', 400);
  }, 500);
}

init();
