// Supabase connection
const SUPABASE_URL = 'https://mseywoukzrktdghstxwv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zZXl3b3VrenJrdGRnaHN0eHd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NTgwMzUsImV4cCI6MjA5NTUzNDAzNX0.bTm6JRABNrmhd8TfioqOhBAcp5zhyojMZMWsnJ4MIo4';

// Save agreement to Supabase
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

// Save worker registration to Supabase
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

// Save contact message to Supabase
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

// Fetch all agreements (for admin)
async function fetchAgreements() {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/agreements?order=signed_at.desc`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  });
  return response.json();
}

// Fetch all workers (for admin)
async function fetchWorkers() {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/workers?order=registered_at.desc`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  });
  return response.json();
}

// Fetch a single worker's own profile by email (for the Annotator dashboard)
async function fetchWorkerByEmail(email) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/workers?email=eq.${encodeURIComponent(email)}`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  });
  const rows = await response.json();
  return rows[0] || null;
}

// Fetch all contacts (for admin)
async function fetchContacts() {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/contacts?order=submitted_at.desc`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  });
  return response.json();
}

// ===== Auth (Supabase GoTrue) =====

// Create a login (Account Owner or Annotator) with their own email + password
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

// Sign in with email + password. Stores the session in sessionStorage on success.
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

// Send a password-reset email
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

// Set a new password using the access token from the recovery email link
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