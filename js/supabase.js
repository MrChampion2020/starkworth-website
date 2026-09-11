// Supabase connection
const SUPABASE_URL = 'https://mseywoukzrktdghstxwv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zZXl3b3VrenJrdGRnaHN0eHd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NTgwMzUsImV4cCI6MjA5NTUzNDAzNX0.bTm6JRABNrmhd8TfioqOhBAcp5zhyojMZMWsnJ4MIo4';

// ===== Persistent session =====
// Logins are kept in localStorage (they survive closing the tab/browser) and
// the refresh token is used to keep the session alive for at least 24 hours
// from every login - in practice indefinitely until the user signs out. Also
// bump "JWT expiry" to 86400 in the Supabase dashboard (Authentication ->
// Sign In / Providers) so each access token itself lasts a full day.
const SESSION_KEYS = ['sw_access_token', 'sw_refresh_token', 'sw_expires_at', 'sw_user_email', 'sw_portal_type', 'sw_user_name'];

function _ls(action, key, value) {
  try {
    if (action === 'get') return localStorage.getItem(key);
    if (action === 'set') { localStorage.setItem(key, value); return null; }
    if (action === 'del') { localStorage.removeItem(key); return null; }
  } catch (_) { return null; }
}
function _ss(action, key, value) {
  try {
    if (action === 'get') return sessionStorage.getItem(key);
    if (action === 'set') { sessionStorage.setItem(key, value); return null; }
    if (action === 'del') { sessionStorage.removeItem(key); return null; }
  } catch (_) { return null; }
}

// Persist a token response ({ access_token, refresh_token, expires_at/expires_in, user }).
function storeSession(data, emailOverride) {
  if (!data) return;
  const email = emailOverride || data.user?.email || data.email || getStoredEmail();
  if (data.access_token) { _ls('set', 'sw_access_token', data.access_token); _ss('set', 'sw_access_token', data.access_token); }
  if (data.refresh_token) _ls('set', 'sw_refresh_token', data.refresh_token);
  const expMs = data.expires_at ? Number(data.expires_at) * 1000
    : (data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : Date.now() + 3600 * 1000);
  _ls('set', 'sw_expires_at', String(expMs));
  if (email) { _ls('set', 'sw_user_email', email); _ss('set', 'sw_user_email', email); }
}

function getStoredToken() {
  return _ls('get', 'sw_access_token') || _ss('get', 'sw_access_token');
}
function getStoredEmail() {
  return _ls('get', 'sw_user_email') || _ss('get', 'sw_user_email');
}

async function refreshSupabaseSession() {
  const refreshToken = _ls('get', 'sw_refresh_token');
  if (!refreshToken) return false;
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    if (!response.ok) return false;
    const data = await response.json();
    if (!data.access_token) return false;
    storeSession(data);
    return true;
  } catch (_) {
    return false;
  }
}

// Refresh when the token is missing, expired, or within 30 minutes of expiry.
// Cheap to call on every page load and before anything that needs auth.
let _sessionRefreshInFlight = null;
async function ensureFreshSession() {
  const token = getStoredToken();
  const expiresAt = Number(_ls('get', 'sw_expires_at') || 0);
  if (token && expiresAt && expiresAt - Date.now() > 30 * 60 * 1000) return true;
  if (!_ls('get', 'sw_refresh_token')) return !!token;
  if (!_sessionRefreshInFlight) {
    _sessionRefreshInFlight = refreshSupabaseSession().finally(() => { _sessionRefreshInFlight = null; });
  }
  await _sessionRefreshInFlight;
  return !!getStoredToken();
}

function formatUsd(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function escapeQuery(value) {
  return encodeURIComponent(value || '');
}

function getStoredReferralCode() {
  return sessionStorage.getItem('sw_referral_code') || localStorage.getItem('sw_referral_code') || '';
}

function storeReferralCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = (params.get('ref') || params.get('referral') || '').trim();
  if (code) {
    sessionStorage.setItem('sw_referral_code', code);
    localStorage.setItem('sw_referral_code', code);
  }
  return code || getStoredReferralCode();
}

async function getReferralCodeForSession() {
  const sessionCode = getStoredReferralCode();
  const token = getStoredToken();
  if (!token) return sessionCode;
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
    const user = await response.json();
    const metadataCode = user.user_metadata?.referred_by_code || user.raw_user_meta_data?.referred_by_code || '';
    if (metadataCode) {
      sessionStorage.setItem('sw_referral_code', metadataCode);
      localStorage.setItem('sw_referral_code', metadataCode);
      return metadataCode.trim();
    }
  } catch (_) {}
  return sessionCode;
}

function buildReferralLink(pagePath, referralCode) {
  const code = (referralCode || getStoredReferralCode() || '').trim();
  const [path, hash = ''] = pagePath.replace(/^\/+/, '').split('#');
  const base = window.location.origin + '/pages/' + path;
  const query = code ? `${base.includes('?') ? '&' : '?'}ref=${encodeURIComponent(code)}` : '';
  return `${base}${query}${hash ? `#${hash}` : ''}`;
}

async function fetchTableRows(table, query = '', headers = getAuthHeaders()) {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`;
  const response = await fetch(url, { headers });
  if (!response.ok) return [];
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

// Returns the real logged-in admin's token if one exists, otherwise falls
// back to the public anon key. Use this for any request that should be
// restricted to a signed-in admin (reading/updating/deleting records).
function getAuthHeaders() {
  const token = getStoredToken();
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${token || SUPABASE_ANON_KEY}`
  };
}

// Save agreement to Supabase (public form — stays on anon key)
async function saveAgreement(data) {
  const request = (payload) => fetch(`${SUPABASE_URL}/rest/v1/agreements`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(payload)
  });
  let response = await request(data);
  let error = response.ok ? null : await response.json().catch(() => ({}));
  if (!response.ok && (response.status === 400 || response.status === 404) && (error.code === 'PGRST204' || error.message?.includes('Could not find the') || error.message?.includes('column'))) {
    const fallback = { ...data };
    delete fallback.referral_code;
    delete fallback.referred_by_code;
    response = await request(fallback);
    error = response.ok ? null : await response.json().catch(() => error || ({}));
  }
  return { ok: response.ok, error };
}

// Save worker registration to Supabase (public form — stays on anon key)
async function saveWorker(data) {
  const request = (payload) => fetch(`${SUPABASE_URL}/rest/v1/workers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(payload)
  });
  let response = await request(data);
  let error = response.ok ? null : await response.json().catch(() => ({}));
  if (!response.ok && (response.status === 400 || response.status === 404)) {
    const fallback = { ...data };
    delete fallback.weekly_value_usd;
    delete fallback.referral_code;
    delete fallback.referred_by_code;
    response = await request(fallback);
    error = response.ok ? null : await response.json().catch(() => error || ({}));
  }
  return { ok: response.ok, error };
}

async function saveAffiliateSettings(data) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/affiliate_settings?id=eq.1`, {
    method: 'PATCH',
    headers: { ...getAuthHeaders(), 'Prefer': 'return=representation' },
    body: JSON.stringify(data)
  });
  const error = response.ok ? null : await response.json().catch(() => ({}));
  return { ok: response.ok, error };
}

async function fetchAffiliateSettings() {
  const rows = await fetchTableRows('affiliate_settings', 'id=eq.1&limit=1');
  return rows[0] || null;
}

async function fetchAffiliateEarnings(email) {
  const query = email ? `email=eq.${escapeQuery(email)}&order=week_start.desc,created_at.desc` : 'order=week_start.desc,created_at.desc';
  return fetchTableRows('affiliate_earnings', query);
}

async function fetchAffiliatePayouts(email) {
  const query = email ? `email=eq.${escapeQuery(email)}&order=created_at.desc` : 'order=created_at.desc';
  return fetchTableRows('affiliate_payouts', query);
}

async function fetchAffiliateWithdrawals(email) {
  const query = email ? `email=eq.${escapeQuery(email)}&order=requested_at.desc` : 'order=requested_at.desc';
  return fetchTableRows('affiliate_withdrawals', query);
}

async function fetchAffiliateCommissions(email) {
  const query = email ? `referrer_email=eq.${escapeQuery(email)}&order=created_at.desc` : 'order=created_at.desc';
  return fetchTableRows('affiliate_commissions', query);
}

async function fetchAffiliateReferrals(email) {
  const query = email ? `referrer_email=eq.${escapeQuery(email)}&order=captured_at.desc` : 'order=captured_at.desc';
  return fetchTableRows('affiliate_referrals', query);
}

async function fetchAffiliateReferralForReferred(email, portalType) {
  if (!email) return null;
  const query = `referred_email=eq.${escapeQuery(email)}${portalType ? `&referred_portal_type=eq.${escapeQuery(portalType)}` : ''}&limit=1`;
  const rows = await fetchTableRows('affiliate_referrals', query);
  return rows[0] || null;
}

async function fetchStarkAcTrainee(email) {
  const rows = await fetchTableRows('starkac_trainees', `email=eq.${escapeQuery(email)}&limit=1`);
  if (rows[0]) return rows[0];
  if (getSession().accessToken) {
    const provisioned = await provisionStarkAcProfile();
    return provisioned.ok ? provisioned.data : null;
  }
  return null;
}

async function fetchStarkAcActivity(email) {
  return fetchTableRows('starkac_trainee_activity', `trainee_email=eq.${escapeQuery(email)}&order=activity_date.desc,created_at.desc`);
}

async function fetchStarkAcTraineesAll() {
  return fetchTableRows('starkac_trainees', 'order=created_at.desc');
}

async function fetchStarkAcPayments(email) {
  return fetchTableRows('starkac_payments', `trainee_email=eq.${escapeQuery(email)}&order=created_at.desc`);
}

async function fetchWorkerDailyReports(email) {
  return fetchTableRows('worker_daily_reports', `worker_email=eq.${escapeQuery(email)}&order=report_date.desc`);
}

async function fetchWorkerDailyReport(email, date) {
  const rows = await fetchTableRows(
    'worker_daily_reports',
    `worker_email=eq.${escapeQuery(email)}&report_date=eq.${escapeQuery(date)}&limit=1`
  );
  return rows[0] || null;
}

// Admin: every annotator's daily checklist report, optionally for one date.
async function fetchWorkerDailyReportsAll(date = '') {
  const query = date
    ? `report_date=eq.${escapeQuery(date)}&order=submitted_at.desc`
    : 'order=report_date.desc,submitted_at.desc&limit=200';
  return fetchTableRows('worker_daily_reports', query);
}

async function saveWorkerDailyReport(data) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/worker_daily_reports?on_conflict=worker_email,report_date`, { method: 'POST', headers: { ...getAuthHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(data) });
  return response.ok;
}

async function fetchWorkerEmergencyAlerts(email = '') {
  const query = email ? `worker_email=eq.${escapeQuery(email)}&status=neq.resolved&order=created_at.desc` : 'status=neq.resolved&order=created_at.desc';
  return fetchTableRows('worker_emergency_alerts', query);
}

async function checkWorkerDailyRoutine() {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_worker_daily_routine`, { method: 'POST', headers: getAuthHeaders(), body: '{}' });
  return response.ok ? response.json() : null;
}

async function provisionStarkAcProfile() {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/provision_starkac_profile`, { method: 'POST', headers: getAuthHeaders(), body: '{}' });
  const data = await response.json();
  return { ok: response.ok, data };
}

async function initializeStarkAcPayment() {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/starkac-monnify-payment`, { method: 'POST', headers: getAuthHeaders(), body: '{}' });
  const data = await response.json();
  return { ok: response.ok && data.ok, data };
}

async function signInWithGoogle(redirectPath = '/starkac/dashboard.html') {
  const redirectTo = `${window.location.origin}${redirectPath}`;
  window.location.href = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
}

async function saveStarkAcActivity(data) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/starkac_trainee_activity`, {
    method: 'POST', headers: { ...getAuthHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify(data)
  });
  return response.ok;
}

async function allocateAccountEarnings(data) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/allocate_account_earnings`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      p_email: data.email,
      p_portal_type: data.portal_type,
      p_period_type: data.period_type,
      p_period_start: data.period_start,
      p_period_end: data.period_end,
      p_gross_amount_usd: Number(data.gross_amount_usd),
      p_account_rate_pct: Number(data.account_rate_pct),
      p_notes: data.notes || null
    })
  });
  return { ok: response.ok, data: await response.json().catch(() => null) };
}

async function linkExistingReferral(data) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/link_existing_referral`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      p_referrer_email: data.referrer_email,
      p_referrer_portal_type: data.referrer_portal_type,
      p_referred_email: data.referred_email,
      p_referred_portal_type: data.referred_portal_type,
      p_referral_code: data.referral_code || null,
      p_notes: data.notes || 'Linked manually by admin'
    })
  });
  return { ok: response.ok, data: await response.json().catch(() => null) };
}

async function fetchWeeklyTaskAssignments(email) {
  const query = email ? `email=eq.${escapeQuery(email)}&order=week_start.desc,created_at.desc` : 'order=week_start.desc,created_at.desc';
  return fetchTableRows('weekly_task_assignments', query);
}

async function fetchAffiliateReferrerRule(email, portalType) {
  const query = email
    ? `referrer_email=eq.${escapeQuery(email)}${portalType ? `&referrer_portal_type=eq.${escapeQuery(portalType)}` : ''}&limit=1`
    : 'limit=1';
  const rows = await fetchTableRows('affiliate_referrer_rules', query);
  return rows[0] || null;
}

async function fetchAffiliateReferrerRulesAll() {
  return fetchTableRows('affiliate_referrer_rules', 'order=updated_at.desc');
}

async function saveAffiliateReferrerRule(data) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/affiliate_referrer_rules`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Prefer': 'return=representation' },
    body: JSON.stringify(data)
  });
  return response.ok;
}

// Save contact message to Supabase (public form — stays on anon key)
async function saveContact(data) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/contacts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(data)
  });
  return response.ok;
}

// Fetch all agreements (admin only — now uses real admin token)
async function fetchAgreements() {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/agreements?order=signed_at.desc`, {
    headers: getAuthHeaders()
  });
  return response.json();
}

// Fetch all workers (admin only — now uses real admin token)
async function fetchWorkers() {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/workers?order=registered_at.desc`, {
    headers: getAuthHeaders()
  });
  return response.json();
}

// Fetch a single worker's own profile by email (Annotator dashboard —
// needs the logged-in worker's own token, per the "workers can read own row" policy)
async function fetchWorkerByEmail(email) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/workers?email=eq.${encodeURIComponent(email)}`, {
    headers: getAuthHeaders()
  });
  const rows = await response.json();
  return rows[0] || null;
}

// Fetch a single Account Owner's own signed agreement by email (Account
// Owner dashboard — needs the logged-in owner's own token, per the
// "account owners can read own agreement" policy)
async function fetchAgreementByEmail(email) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/agreements?email=eq.${encodeURIComponent(email)}&order=signed_at.desc&limit=1`, {
    headers: getAuthHeaders()
  });
  const rows = await response.json();
  return rows[0] || null;
}

// Fetch all contacts (admin only — now uses real admin token)
async function fetchContacts() {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/contacts?order=submitted_at.desc`, {
    headers: getAuthHeaders()
  });
  return response.json();
}

async function fetchAffiliateEarningsAll() {
  return fetchTableRows('affiliate_earnings', 'order=week_start.desc,created_at.desc');
}

async function fetchAffiliatePayoutsAll() {
  return fetchTableRows('affiliate_payouts', 'order=created_at.desc');
}

async function fetchAffiliateWithdrawalsAll() {
  return fetchTableRows('affiliate_withdrawals', 'order=requested_at.desc');
}

async function fetchAffiliateCommissionsAll() {
  return fetchTableRows('affiliate_commissions', 'order=created_at.desc');
}

async function fetchAffiliateReferralsAll() {
  return fetchTableRows('affiliate_referrals', 'order=captured_at.desc');
}

async function fetchWeeklyTaskAssignmentsAll() {
  return fetchTableRows('weekly_task_assignments', 'order=week_start.desc,created_at.desc');
}

// ===== Account operations: assignments, projects, tasks, check-ins =====
// Backed by supabase/account_operations.sql. All reads go through RLS, so a
// worker/owner token only ever sees its own rows; an admin token sees all.

// ---- Account-owner <-> annotator assignments ----
async function fetchAnnotatorAssignmentsAll() {
  return fetchTableRows('annotator_owner_assignments', 'order=created_at.desc');
}

async function fetchAssignmentsForAnnotator(email, activeOnly = true) {
  const query = `annotator_email=eq.${escapeQuery((email || '').toLowerCase())}` +
    (activeOnly ? '&status=eq.active' : '') + '&order=created_at.desc';
  return fetchTableRows('annotator_owner_assignments', query);
}

async function fetchAssignmentsForOwner(email, activeOnly = true) {
  const query = `owner_email=eq.${escapeQuery((email || '').toLowerCase())}` +
    (activeOnly ? '&status=eq.active' : '') + '&order=created_at.desc';
  return fetchTableRows('annotator_owner_assignments', query);
}

async function saveAnnotatorAssignment(data) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/annotator_owner_assignments?on_conflict=annotator_email,owner_email`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      annotator_email: (data.annotator_email || '').toLowerCase(),
      owner_email: (data.owner_email || '').toLowerCase(),
      status: data.status || 'active',
      ended_at: null,
      notes: data.notes || null
    })
  });
  return { ok: response.ok, error: response.ok ? null : await response.json().catch(() => ({})) };
}

async function updateAnnotatorAssignment(id, data) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/annotator_owner_assignments?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...getAuthHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify(data)
  });
  return response.ok;
}

async function endAnnotatorAssignment(id) {
  return updateAnnotatorAssignment(id, { status: 'ended', ended_at: new Date().toISOString() });
}

async function reassignOwner(payload) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/reassign_owner`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      p_owner_email: payload.owner_email,
      p_from_annotator: payload.from_annotator || null,
      p_to_annotator: payload.to_annotator,
      p_notes: payload.notes || null
    })
  });
  return { ok: response.ok, data: await response.json().catch(() => null) };
}

// ---- Owner projects ----
async function fetchOwnerProjectsAll() {
  return fetchTableRows('owner_projects', 'order=created_at.desc');
}

async function fetchOwnerProjects(ownerEmail) {
  const query = ownerEmail
    ? `owner_email=eq.${escapeQuery(ownerEmail.toLowerCase())}&order=created_at.desc`
    : 'order=created_at.desc';
  return fetchTableRows('owner_projects', query);
}

async function saveOwnerProject(data) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/owner_projects`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      owner_email: (data.owner_email || '').toLowerCase(),
      name: data.name,
      platform: data.platform || null,
      description: data.description || null,
      status: data.status || 'active',
      priority: data.priority || 'normal',
      created_by: (getSession().email || 'admin').toLowerCase()
    })
  });
  return { ok: response.ok, error: response.ok ? null : await response.json().catch(() => ({})) };
}

async function updateOwnerProject(id, data) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/owner_projects?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...getAuthHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify(data)
  });
  return response.ok;
}

async function deleteOwnerProject(id) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/owner_projects?id=eq.${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders()
  });
  return response.ok;
}

// ---- Project tasks ----
async function fetchProjectTasksAll() {
  return fetchTableRows('project_tasks', 'order=created_at.desc');
}

async function fetchProjectTasks(projectId) {
  return fetchTableRows('project_tasks', `project_id=eq.${projectId}&order=created_at.desc`);
}

async function fetchTasksForAnnotator(email) {
  return fetchTableRows('project_tasks', `assigned_annotator_email=eq.${escapeQuery((email || '').toLowerCase())}&order=created_at.desc`);
}

async function saveProjectTask(data) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/project_tasks`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      project_id: data.project_id,
      title: data.title,
      details: data.details || null,
      assigned_annotator_email: data.assigned_annotator_email
        ? data.assigned_annotator_email.toLowerCase() : null,
      status: data.status || 'todo',
      due_at: data.due_at || null,
      created_by: (getSession().email || 'admin').toLowerCase()
    })
  });
  return { ok: response.ok, error: response.ok ? null : await response.json().catch(() => ({})) };
}

async function updateProjectTask(id, data) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/project_tasks?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...getAuthHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify(data)
  });
  return response.ok;
}

async function deleteProjectTask(id) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/project_tasks?id=eq.${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders()
  });
  return response.ok;
}

// ---- Task feedback ----
async function fetchTaskFeedbackAll() {
  return fetchTableRows('task_feedback', 'order=created_at.desc');
}

async function fetchTaskFeedback(taskId) {
  return fetchTableRows('task_feedback', `task_id=eq.${taskId}&order=created_at.desc`);
}

async function saveTaskFeedback(data) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/task_feedback`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      task_id: data.task_id,
      project_id: data.project_id || null,
      author_email: (getSession().email || '').toLowerCase(),
      author_role: data.author_role || 'annotator',
      body: data.body,
      proposed_status: data.proposed_status || null
    })
  });
  return response.ok;
}

// ---- Annotator shifts and 90-minute check-ins ----
async function startWorkerShift() {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/start_worker_shift`, {
    method: 'POST', headers: getAuthHeaders(), body: '{}'
  });
  return { ok: response.ok, data: await response.json().catch(() => null) };
}

async function fetchTodayWorkerShift(email) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await fetchTableRows('worker_shifts',
    `worker_email=eq.${escapeQuery((email || '').toLowerCase())}&shift_date=eq.${today}&limit=1`);
  return rows[0] || null;
}

// Reads the worker_checkin_status view. Filter by { email, date, ownerEmail }.
async function fetchWorkerCheckinStatus(opts = {}) {
  const parts = [];
  if (opts.email) parts.push(`worker_email=eq.${escapeQuery(opts.email.toLowerCase())}`);
  if (opts.date) parts.push(`shift_date=eq.${opts.date}`);
  if (opts.ownerEmail) parts.push(`owner_email=eq.${escapeQuery(opts.ownerEmail.toLowerCase())}`);
  parts.push('order=due_at.asc');
  return fetchTableRows('worker_checkin_status', parts.join('&'));
}

async function submitWorkerCheckin(payload) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/submit_worker_checkin`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      p_slot_index: payload.slot_index ?? null,
      p_owner_email: payload.owner_email || null,
      p_project_id: payload.project_id || null,
      p_task_id: payload.task_id || null,
      p_update_text: payload.update_text || null,
      p_blockers: payload.blockers || null,
      p_items_completed: (payload.items_completed === '' || payload.items_completed == null) ? null : Number(payload.items_completed),
      p_quality_issues: payload.quality_issues || null,
      p_guideline_questions: payload.guideline_questions || null
    })
  });
  return { ok: response.ok, data: await response.json().catch(() => null) };
}

// ---- Daily Task Grid (backed by supabase/daily_task_grid.sql) ----
// Replaces the 90-minute check-in flow above: at resumption each annotator
// fills one cell per hour of the working day, then updates a cell's status as
// they work it.
async function fetchDailyTaskGridSettings() {
  const rows = await fetchTableRows('daily_task_grid_settings', 'id=eq.1&limit=1');
  return rows[0] || { start_hour: 9, end_hour: 19 };
}

async function saveDailyTaskGridSettings(data) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/daily_task_grid_settings?id=eq.1`, {
    method: 'PATCH',
    headers: { ...getAuthHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({
      start_hour: Number(data.start_hour),
      end_hour: Number(data.end_hour),
      updated_by: (getSession().email || '').toLowerCase()
    })
  });
  return response.ok;
}

// One worker's grid cells for one date.
async function fetchWorkerDailyTasks(email, date) {
  return fetchTableRows('worker_daily_tasks',
    `worker_email=eq.${escapeQuery((email || '').toLowerCase())}&task_date=eq.${escapeQuery(date)}&order=slot_hour.asc`);
}

// Admin: every worker's grid cells for one date.
async function fetchDailyTasksAll(date) {
  return fetchTableRows('worker_daily_tasks', `task_date=eq.${escapeQuery(date)}&order=worker_email.asc,slot_hour.asc`);
}

// Upsert one grid cell (worker_email + task_date + slot_hour is the unique key).
async function saveDailyTaskSlot(data) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/worker_daily_tasks?on_conflict=worker_email,task_date,slot_hour`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      worker_email: (data.worker_email || '').toLowerCase(),
      task_date: data.task_date,
      slot_hour: Number(data.slot_hour),
      owner_email: data.owner_email || null,
      project_id: data.project_id || null,
      task_id: data.task_id || null,
      task_text: data.task_text || '',
      status: data.status || 'pending',
      notes: data.notes || null
    })
  });
  return response.ok;
}

// Clears one grid cell entirely (used when a worker empties a slot's task text).
async function deleteDailyTaskSlot(email, date, slotHour) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/worker_daily_tasks?worker_email=eq.${escapeQuery((email || '').toLowerCase())}&task_date=eq.${escapeQuery(date)}&slot_hour=eq.${Number(slotHour)}`,
    { method: 'DELETE', headers: { ...getAuthHeaders(), Prefer: 'return=minimal' } }
  );
  return response.ok;
}

// ===== Weekly task values, payout splits, payments =====
// Backed by supabase/task_value_splits.sql.

// ---- Account participants (admin-maintained extra beneficiaries) ----
async function fetchAccountParticipantsAll() {
  return fetchTableRows('account_participants', 'order=owner_email.asc,created_at.desc');
}

async function fetchAccountParticipants(ownerEmail, activeOnly = true) {
  const query = `owner_email=eq.${escapeQuery((ownerEmail || '').toLowerCase())}` +
    (activeOnly ? '&active=eq.true' : '') + '&order=created_at.desc';
  return fetchTableRows('account_participants', query);
}

async function saveAccountParticipant(data) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/account_participants`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      owner_email: (data.owner_email || '').toLowerCase(),
      beneficiary_label: data.beneficiary_label,
      beneficiary_email: data.beneficiary_email ? data.beneficiary_email.toLowerCase() : null,
      role: data.role || 'other',
      default_pct: Number(data.default_pct || 0),
      payout_destination: data.payout_destination || null,
      notes: data.notes || null
    })
  });
  return { ok: response.ok, error: response.ok ? null : await response.json().catch(() => ({})) };
}

async function updateAccountParticipant(id, data) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/account_participants?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...getAuthHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify(data)
  });
  return response.ok;
}

async function deleteAccountParticipant(id) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/account_participants?id=eq.${id}`, {
    method: 'DELETE', headers: getAuthHeaders()
  });
  return response.ok;
}

// ---- Weekly task value declarations ----
async function declareWeeklyTaskValue(payload) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/declare_weekly_task_value`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      p_owner_email: payload.owner_email,
      p_week_start: payload.week_start,
      p_week_end: payload.week_end,
      p_task_value_usd: Number(payload.task_value_usd),
      p_notes: payload.notes || null
    })
  });
  return { ok: response.ok, data: await response.json().catch(() => null) };
}

async function fetchWeeklyTaskValues(opts = {}) {
  const parts = [];
  if (opts.annotator) parts.push(`annotator_email=eq.${escapeQuery(opts.annotator.toLowerCase())}`);
  if (opts.owner) parts.push(`owner_email=eq.${escapeQuery(opts.owner.toLowerCase())}`);
  if (opts.status) parts.push(`status=eq.${escapeQuery(opts.status)}`);
  parts.push('order=week_start.desc,created_at.desc');
  return fetchTableRows('weekly_task_values', parts.join('&'));
}

async function fetchWeeklyTaskValuesAll() {
  return fetchTableRows('weekly_task_values', 'order=week_start.desc,created_at.desc');
}

async function approveWeeklyTaskValue({ id, splits, review_notes }) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/approve_weekly_task_value`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ p_id: id, p_splits: splits, p_review_notes: review_notes || null })
  });
  return { ok: response.ok, data: await response.json().catch(() => null) };
}

async function rejectWeeklyTaskValue({ id, notes }) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/reject_weekly_task_value`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ p_id: id, p_notes: notes || null })
  });
  return { ok: response.ok, data: await response.json().catch(() => null) };
}

// ---- Splits, payments, reconciliation ----
async function fetchTaskValueSplits(taskValueId) {
  return fetchTableRows('task_value_splits', `task_value_id=eq.${taskValueId}&order=created_at.asc`);
}

async function fetchTaskValueSplitsAll() {
  return fetchTableRows('task_value_splits', 'order=owner_email.asc,created_at.desc');
}

async function fetchPendingSplitsAll() {
  return fetchTableRows('task_value_splits', 'payment_status=neq.paid&order=owner_email.asc,created_at.desc');
}

async function recordSplitPayment(payload) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_split_payment`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      p_split_id: payload.split_id,
      p_amount_usd: Number(payload.amount_usd),
      p_paid_at: payload.paid_at || null,
      p_method: payload.method || null,
      p_reference: payload.reference || null,
      p_notes: payload.notes || null
    })
  });
  return { ok: response.ok, data: await response.json().catch(() => null) };
}

async function fetchSplitPayments(splitId) {
  return fetchTableRows('task_value_payments', `split_id=eq.${splitId}&order=paid_at.desc`);
}

async function fetchTaskValueReconciliation(opts = {}) {
  const parts = [];
  if (opts.owner) parts.push(`owner_email=eq.${escapeQuery(opts.owner.toLowerCase())}`);
  if (opts.status) parts.push(`status=eq.${escapeQuery(opts.status)}`);
  parts.push('order=week_start.desc');
  return fetchTableRows('task_value_reconciliation', parts.join('&'));
}

// ===== AI data annotation platforms (built-in list for project dropdowns) =====
const ANNOTATION_PLATFORMS = [
  'Outlier', 'Scale AI / Remotasks', 'Appen', 'DataAnnotation.tech', 'Mercor',
  'Turing', 'Prolific', 'Toloka', 'Surge AI', 'Labelbox', 'iMerit', 'Alignerr',
  'Invisible', 'Sigma', 'Other'
];

// ===== Worker shift settings (admin-set: hours, interval, cadence) =====
async function fetchWorkerShiftSettingsAll() {
  return fetchTableRows('worker_shift_settings', 'order=worker_email.asc');
}

async function fetchWorkerShiftSetting(email) {
  const rows = await fetchTableRows('worker_shift_settings',
    `worker_email=in.(${escapeQuery((email || '').toLowerCase())},*)`);
  return rows.find(r => r.worker_email === (email || '').toLowerCase()) || rows.find(r => r.worker_email === '*') || null;
}

async function saveWorkerShiftSetting(payload) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/worker_shift_settings?on_conflict=worker_email`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      worker_email: (payload.worker_email || '*').toLowerCase(),
      shift_hours: Number(payload.shift_hours || 15),
      interval_minutes: Number(payload.interval_minutes || 90),
      assignment_mode: payload.assignment_mode || 'auto',
      updated_by: (getSession().email || 'admin').toLowerCase()
    })
  });
  return { ok: response.ok, error: response.ok ? null : await response.json().catch(() => ({})) };
}

async function deleteWorkerShiftSetting(email) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/worker_shift_settings?worker_email=eq.${escapeQuery(email.toLowerCase())}`, {
    method: 'DELETE', headers: getAuthHeaders()
  });
  return response.ok;
}

// ===== Staff members & role permissions =====
async function fetchStaffMembers() {
  return fetchTableRows('starkworth_admins', 'order=created_at.desc');
}

async function fetchStaffRolePermissions() {
  return fetchTableRows('staff_role_permissions', 'order=role.asc,permission_key.asc');
}

async function myStaffPermissions() {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/my_staff_permissions`, {
    method: 'POST', headers: getAuthHeaders(), body: '{}'
  });
  if (!response.ok) return [];
  const data = await response.json().catch(() => []);
  return Array.isArray(data) ? data : [];
}

async function upsertStaffMember(payload) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_staff_member`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      p_email: payload.email,
      p_display_name: payload.display_name || null,
      p_role: payload.role || 'admin',
      p_active: payload.active ?? true
    })
  });
  return { ok: response.ok, data: await response.json().catch(() => null) };
}

async function deleteStaffMember(email) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/delete_staff_member`, {
    method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ p_email: email })
  });
  return { ok: response.ok, data: await response.json().catch(() => null) };
}

async function setRolePermissions(role, keys) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/set_role_permissions`, {
    method: 'POST', headers: getAuthHeaders(),
    body: JSON.stringify({ p_role: role, p_keys: keys })
  });
  return { ok: response.ok, data: await response.json().catch(() => null) };
}

// ===== Mena Live Chat (admin only) =====
// Guests never read/write this table directly (see
// supabase/mena_chat_schema.sql for why) — only authenticated admins,
// through the same is_starkworth_admin() RLS pattern used everywhere else
// in this file.

async function fetchMenaChats() {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/mena_chats?order=updated_at.desc`, {
    headers: getAuthHeaders()
  });
  return response.json();
}

async function markMenaChatReadByAdmin(id) {
  await fetch(`${SUPABASE_URL}/rest/v1/mena_chats?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...getAuthHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify({ unread_by_admin: false })
  });
}

// Appends an admin message to the transcript and flags the chat unread
// for the visitor. `currentMessages` is the chat's existing `messages`
// array (pass what fetchMenaChats() returned for that row) so we append
// rather than clobber.
async function sendMenaAdminReply(id, currentMessages, text) {
  const updatedMessages = [
    ...(currentMessages || []),
    { sender: 'admin', text, ts: new Date().toISOString() }
  ];
  const response = await fetch(`${SUPABASE_URL}/rest/v1/mena_chats?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...getAuthHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      messages: updatedMessages,
      status: 'admin_replied',
      unread_by_user: true,
      unread_by_admin: false
    })
  });
  return response.ok;
}

// ===== Auth (Supabase GoTrue) =====

async function signUpWithPassword(email, password, metadata = null) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY
    },
    body: JSON.stringify({ email, password, ...(metadata ? { data: metadata } : {}) })
  });
  const data = await response.json();
  return { ok: response.ok, data };
}

async function signUpAffiliate(email, password, fullName, referredByCode = '') {
  const verificationRedirect = `${window.location.origin}/pages/affiliate.html`;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/signup?redirect_to=${encodeURIComponent(verificationRedirect)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password, data: { portal_type: 'affiliate', full_name: fullName, referred_by_code: referredByCode } })
  });
  const data = await response.json();
  if (response.ok && data.access_token) {
    storeSession(data, email);
  }
  // Notification is deliberately best-effort and never changes signup success.
  if (response.ok) {
    fetch(`${SUPABASE_URL}/functions/v1/affiliate-notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ email, full_name: fullName })
    }).catch(() => {});
  }
  return { ok: response.ok, data };
}

async function provisionAffiliateProfile(fullName = '', referredByCode = '') {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/provision_affiliate_profile`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ p_full_name: fullName, p_referred_by_code: referredByCode })
  });
  const data = await response.json();
  return { ok: response.ok, data };
}

async function signInWithPassword(email, password) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY
    },
    body: JSON.stringify({ email, password })
  });
  const data = await response.json();
  if (response.ok && data.access_token) {
    storeSession(data, email);
  }
  return { ok: response.ok, data };
}

function setSessionPortalType(portalType) {
  if (portalType) { _ls('set', 'sw_portal_type', portalType); _ss('set', 'sw_portal_type', portalType); }
}

function getSessionPortalType() {
  return _ls('get', 'sw_portal_type') || _ss('get', 'sw_portal_type') || '';
}

async function signInAffiliate(email, password) {
  const result = await signInWithPassword(email, password);
  if (!result.ok) return result;

  let profile = await fetchAffiliateAccount(email);
  if (!profile) {
    const repaired = await provisionAffiliateProfile('', getStoredReferralCode());
    if (repaired.ok && repaired.data) profile = repaired.data;
  }
  if (!profile || profile.status !== 'active') {
    signOut();
    return { ok: false, data: { msg: 'This login is not registered as an active affiliate account.' } };
  }
  return { ok: true, data: { ...result.data, profile } };
}

async function fetchAffiliateAccount(email) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/affiliate_accounts?email=eq.${encodeURIComponent(email)}&limit=1`, {
    headers: getAuthHeaders()
  });
  const rows = await response.json();
  return response.ok ? (rows[0] || null) : null;
}

async function requestAffiliateWithdrawal(email, amountUsd, destination, portalType = 'affiliate') {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/affiliate_withdrawals`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify({ email, portal_type: portalType, amount_usd: Number(amountUsd), destination, status: 'requested' })
  });
  return response.ok;
}

function getSession() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const hashToken = hash.get('access_token');
  if (hashToken && !getStoredToken()) {
    try {
      const payload = JSON.parse(atob(hashToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      storeSession({
        access_token: hashToken,
        refresh_token: hash.get('refresh_token') || null,
        expires_in: Number(hash.get('expires_in')) || null,
        email: payload.email
      });
    } catch (_) {}
  }
  return {
    accessToken: getStoredToken(),
    email: getStoredEmail()
  };
}

function signOut() {
  SESSION_KEYS.forEach(k => { _ls('del', k); _ss('del', k); });
}

async function restoreOAuthSession() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const accessToken = params.get('access_token');
  if (!accessToken) return getSession();
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return getSession();
  const user = await response.json();
  storeSession({
    access_token: accessToken,
    refresh_token: params.get('refresh_token') || null,
    expires_in: Number(params.get('expires_in')) || null,
    email: user.email || ''
  });
  history.replaceState(null, document.title, window.location.pathname + window.location.search);
  return getSession();
}

async function resetPassword(email) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY
    },
    body: JSON.stringify({
      email,
      redirect_to: window.location.origin + '/pages/reset-password.html'
    })
  });
  return response.ok;
}

async function updatePassword(newPassword, accessToken) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({ password: newPassword })
  });
  return response.ok;
}

// ===== Keep the session alive =====
// On every page load: migrate any old sessionStorage-only login into
// localStorage, then refresh proactively. Repeat every 20 minutes while the
// tab is open. Combined with the refresh token this holds a login well past
// the 24-hour minimum.
(function initPersistentSession() {
  if (typeof window === 'undefined') return;
  try {
    if (!_ls('get', 'sw_access_token') && _ss('get', 'sw_access_token')) {
      _ls('set', 'sw_access_token', _ss('get', 'sw_access_token'));
      if (_ss('get', 'sw_user_email')) _ls('set', 'sw_user_email', _ss('get', 'sw_user_email'));
      if (_ss('get', 'sw_portal_type')) _ls('set', 'sw_portal_type', _ss('get', 'sw_portal_type'));
      // Unknown real expiry for a migrated token; assume it is near the end so
      // the first ensureFreshSession() refreshes it.
      if (!_ls('get', 'sw_expires_at')) _ls('set', 'sw_expires_at', String(Date.now() + 60 * 1000));
    }
  } catch (_) {}
  if (getStoredToken()) {
    ensureFreshSession();
    setInterval(ensureFreshSession, 20 * 60 * 1000);
  }
})();
