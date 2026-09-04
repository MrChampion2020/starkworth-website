// Supabase connection
const SUPABASE_URL = 'https://mseywoukzrktdghstxwv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zZXl3b3VrenJrdGRnaHN0eHd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NTgwMzUsImV4cCI6MjA5NTUzNDAzNX0.bTm6JRABNrmhd8TfioqOhBAcp5zhyojMZMWsnJ4MIo4';

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
  const token = sessionStorage.getItem('sw_access_token');
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${token || SUPABASE_ANON_KEY}`
  };
}

// Save agreement to Supabase (public form — stays on anon key)
async function saveAgreement(data) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/agreements`, {
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
  return response.ok;
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
  return rows[0] || null;
}

async function fetchStarkAcActivity(email) {
  return fetchTableRows('starkac_trainee_activity', `trainee_email=eq.${escapeQuery(email)}&order=activity_date.desc,created_at.desc`);
}

async function fetchStarkAcTraineesAll() {
  return fetchTableRows('starkac_trainees', 'order=created_at.desc');
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
    sessionStorage.setItem('sw_access_token', data.access_token);
    sessionStorage.setItem('sw_user_email', email);
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
    sessionStorage.setItem('sw_access_token', data.access_token);
    sessionStorage.setItem('sw_user_email', email);
  }
  return { ok: response.ok, data };
}

function setSessionPortalType(portalType) {
  if (portalType) sessionStorage.setItem('sw_portal_type', portalType);
}

function getSessionPortalType() {
  return sessionStorage.getItem('sw_portal_type') || '';
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
  return {
    accessToken: sessionStorage.getItem('sw_access_token'),
    email: sessionStorage.getItem('sw_user_email')
  };
}

function signOut() {
  sessionStorage.removeItem('sw_access_token');
  sessionStorage.removeItem('sw_user_email');
  sessionStorage.removeItem('sw_portal_type');
  sessionStorage.removeItem('sw_user_name');
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
