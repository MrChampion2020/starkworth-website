// Mena chat persistence + human-handoff.
//
// Keeps the visible chat log in localStorage so a visitor's conversation
// with Mena survives a reload or a later visit ("save every Mena session
// ... to return to", for guests and logged-in users alike — there's no
// login gate on the chat widget itself, so this is device-based history
// rather than account-based).
//
// Talking to a human touches Supabase, but only ever through the two Edge
// Functions in supabase/functions/ — never a direct table read/write with
// the public anon key. See supabase/mena_chat_schema.sql for why.
(function () {
  const HISTORY_KEY = 'sw_mena_history';
  const SESSION_ID_KEY = 'sw_mena_session_id';
  const ESCALATED_KEY = 'sw_mena_escalated';
  const WHATSAPP_NUMBER = '18472007752'; // +1 (847) 200-7752
  const MAX_STORED_MESSAGES = 200;

  function uuidv4() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    // Fallback for older browsers without crypto.randomUUID.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getSessionId() {
    let id = localStorage.getItem(SESSION_ID_KEY);
    if (!id) {
      id = uuidv4();
      localStorage.setItem(SESSION_ID_KEY, id);
    }
    return id;
  }

  function getHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveHistory(history) {
    const trimmed = history.slice(-MAX_STORED_MESSAGES);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
    return trimmed;
  }

  function appendMessage(sender, text) {
    const history = getHistory();
    history.push({ sender, text, ts: new Date().toISOString() });
    return saveHistory(history);
  }

  function clearHistory() {
    localStorage.removeItem(HISTORY_KEY);
    localStorage.removeItem(SESSION_ID_KEY);
    localStorage.removeItem(ESCALATED_KEY);
  }

  function getKnownUserEmail() {
    try {
      return sessionStorage.getItem('sw_user_email') || null;
    } catch {
      return null;
    }
  }

  function isEscalated() {
    return localStorage.getItem(ESCALATED_KEY) === '1';
  }

  function getWhatsAppLink(lastQuestion) {
    const text = lastQuestion
      ? `Hi, I was chatting with Mena on starkworth.org and my last question was: "${lastQuestion}"`
      : 'Hi, I was chatting with Mena on starkworth.org and would like to continue with a person.';
    return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
  }

  // Sends the current transcript to a human. Safe to call more than once
  // per session (e.g. a silent first-timer escalation followed later by an
  // explicit "talk to a human" ask) — the Edge Function merges rather than
  // duplicates.
  async function escalate(lastQuestion) {
    const sessionId = getSessionId();
    const history = getHistory();
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/mena-escalate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          session_id: sessionId,
          user_email: getKnownUserEmail(),
          last_question: lastQuestion,
          messages: history,
        }),
      });
      const data = await response.json();
      if (data && data.ok) {
        localStorage.setItem(ESCALATED_KEY, '1');
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // Polls for an admin reply. Returns the new admin message texts (if any)
  // so the caller can render them, and appends them to local history.
  async function checkForReply() {
    if (!isEscalated()) return [];
    const sessionId = getSessionId();
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/mena-session-status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const data = await response.json();
      if (!data || !data.ok || !data.found || !data.hadNewReply) return [];

      const localHistory = getHistory();
      const lastLocalTs = localHistory.length ? localHistory[localHistory.length - 1].ts : null;
      const newAdminMessages = (data.messages || []).filter(
        (m) => m.sender === 'admin' && (!lastLocalTs || m.ts > lastLocalTs),
      );

      let history = localHistory;
      for (const m of newAdminMessages) {
        history = history.concat([{ sender: 'admin', text: m.text, ts: m.ts }]);
      }
      if (newAdminMessages.length) saveHistory(history);

      return newAdminMessages.map((m) => m.text);
    } catch {
      return [];
    }
  }

  window.MenaChat = {
    getSessionId,
    getHistory,
    saveHistory,
    appendMessage,
    clearHistory,
    isEscalated,
    getWhatsAppLink,
    escalate,
    checkForReply,
  };
})();
