// Supabase connection
const SUPABASE_URL = 'https://mseywoukzrktdghstxwv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zZXl3b3VrenJrdGRnaHN0eHd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NTgwMzUsImV4cCI6MjA5NTUzNDAzNX0.bTm6JRABNrmhd8TfioqOhBAcp5zhyojMZMWsnJ4MIo4';

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
  const response = await fetch(`${SUPABASE_URL}/rest/v1/workers`, {
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

async function signUpWithPassword(email, password) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY
    },
    body: JSON.stringify({ email, password })
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

function getSession() {
  return {
    accessToken: sessionStorage.getItem('sw_access_token'),
    email: sessionStorage.getItem('sw_user_email')
  };
}

function signOut() {
  sessionStorage.removeItem('sw_access_token');
  sessionStorage.removeItem('sw_user_email');
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