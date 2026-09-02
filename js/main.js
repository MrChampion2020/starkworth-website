// Mobile hamburger menu
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobileMenu');

// Keep every public page on the same role-based portal navigation.
(function addProfilePortalMenu() {
  const navContainer = document.querySelector('.nav-container');
  if (!navContainer || document.querySelector('.profile-nav')) return;
  const pageRoot = window.location.pathname.includes('/pages/guides/')
    ? '../'
    : (window.location.pathname.includes('/pages/') ? '' : 'pages/');
  const existingActions = navContainer.querySelector('.nav-buttons');
  if (existingActions) existingActions.classList.add('profile-nav-replaced');
  const mobilePortalLinks = document.querySelectorAll('.mobile-menu a[href*="client-portal"], .mobile-menu a[href*="worker-login"], .mobile-menu a[href*="worker-register"], .mobile-menu a[href*="affiliate"]');
  mobilePortalLinks.forEach((portalLink) => portalLink.remove());
  const wrapper = document.createElement('div');
  wrapper.className = 'profile-nav';
  wrapper.innerHTML = `<button class="profile-nav-trigger" type="button" aria-expanded="false" aria-controls="profilePortalMenu" aria-label="Open login menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></svg><span>Login</span></button><div class="profile-portal-menu" id="profilePortalMenu" hidden><span class="profile-menu-title">Choose a portal</span><a href="${pageRoot}client-portal.html">Account Owner</a><a href="${pageRoot}worker-login.html">Worker</a><a href="${pageRoot}affiliate.html">Affiliate</a></div>`;
  navContainer.appendChild(wrapper);
  const trigger = wrapper.querySelector('.profile-nav-trigger');
  const menu = wrapper.querySelector('.profile-portal-menu');
  trigger.addEventListener('click', () => {
    const open = trigger.getAttribute('aria-expanded') === 'true';
    trigger.setAttribute('aria-expanded', String(!open));
    menu.hidden = open;
  });
  document.addEventListener('click', (event) => {
    if (!wrapper.contains(event.target)) {
      trigger.setAttribute('aria-expanded', 'false');
      menu.hidden = true;
    }
  });
})();

(function enhanceRoleDashboard() {
  const path = window.location.pathname;
  const role = path.includes('worker-dashboard') ? 'Worker' : path.includes('client-dashboard') ? 'Account Owner' : path.includes('affiliate-dashboard') ? 'Affiliate' : '';
  if (!role) return;
  document.body.classList.add('dashboard-page');
  const section = document.querySelector('.portal-section') || document.querySelector('.dashboard-section');
  const content = section?.querySelector('.portal-wrapper') || section?.querySelector(':scope > div');
  if (!section || !content) return;
  content.classList.add('dashboard-layout-inner');
  const mainPanel = content.querySelector('#dashboardContent') || content.querySelector('#affiliateContent');
  if (mainPanel) mainPanel.classList.add('dashboard-main-panel');

  const sidebar = document.createElement('aside');
  sidebar.className = 'dashboard-sidebar';
  sidebar.innerHTML = `<div class="dashboard-sidebar-brand"><span class="dashboard-sidebar-kicker">Starkworth</span><strong>${role} workspace</strong></div><nav aria-label="Dashboard sections"><a href="#overview" class="dashboard-nav-link active" data-target="overview">Overview</a><a href="#earnings" class="dashboard-nav-link" data-target="earnings">Earnings</a><a href="#payouts" class="dashboard-nav-link" data-target="payouts">Payout history</a><a href="#withdrawals" class="dashboard-nav-link" data-target="withdrawals">Withdrawals</a><a href="#tasks" class="dashboard-nav-link" data-target="tasks">Task schedule</a><a href="support.html" class="dashboard-nav-link">Support &amp; Chat</a></nav><div class="dashboard-sidebar-footer"><span class="dashboard-sync-dot"></span>Live sync enabled<button type="button" class="dashboard-refresh" onclick="window.location.reload()">Refresh data</button></div>`;
  content.insertBefore(sidebar, content.firstChild);

  const panels = [...content.querySelectorAll('.history-panel')];
  const targets = ['earnings', 'payouts', 'withdrawals', 'commissions', 'tasks'];
  panels.forEach((panel, index) => { if (targets[index]) panel.id = targets[index]; });
  const overview = content.querySelector('#dashboardBody') || content.querySelector('.dashboard-grid');
  if (overview) overview.id = 'overview';
  const links = sidebar.querySelectorAll('.dashboard-nav-link[data-target]');
  links.forEach((link) => link.addEventListener('click', () => {
    links.forEach((item) => item.classList.toggle('active', item === link));
  }));

  if (role !== 'Affiliate' && content.querySelector('#affiliateArea')) {
    const area = content.querySelector('#affiliateArea');
    const withdrawal = document.createElement('section');
    withdrawal.className = 'dashboard-action-card';
    withdrawal.innerHTML = `<div><span class="dashboard-card-label">Self-service payout</span><h3>Request a withdrawal</h3><p>Submit a withdrawal request for review. Your request and status will appear in Withdrawal history.</p></div><form class="dashboard-withdrawal-form"><label>Amount USD<input type="number" min="1" step="0.01" required name="amount" placeholder="0.00"></label><label>Destination<input required name="destination" placeholder="PayPal, bank, or wallet destination"></label><button class="btn btn-primary" type="submit">Request withdrawal</button><span class="dashboard-form-status" role="status"></span></form>`;
    area.insertBefore(withdrawal, area.firstChild);
    withdrawal.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const status = form.querySelector('.dashboard-form-status');
      status.textContent = 'Submitting...';
      const session = typeof getSession === 'function' ? getSession() : {};
      const portalType = role === 'Worker' ? 'worker' : 'owner';
      const ok = await requestAffiliateWithdrawal(session.email, form.amount.value, form.destination.value.trim(), portalType);
      status.textContent = ok ? 'Withdrawal request submitted.' : 'Could not submit request.';
      if (ok) form.reset();
    });
  }
  window.setInterval(() => window.location.reload(), 60000);
})();

if (hamburger && mobileMenu) {
  hamburger.addEventListener('click', () => {
    const isOpen = mobileMenu.classList.toggle('open');
    hamburger.classList.toggle('open', isOpen);
    hamburger.setAttribute('aria-expanded', String(isOpen));
  });
}

// Close mobile menu when a link is clicked
document.querySelectorAll('.mobile-menu a').forEach(link => {
  link.addEventListener('click', () => {
    mobileMenu.classList.remove('open');
    if (hamburger) {
      hamburger.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
    }
  });
});

// Fade in on scroll
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.step-card, .portal-card, .float-card').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(20px)';
  el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
  observer.observe(el);
});

// Review cards already carry their own CSS transform (the 3D fan tilt),
// so only fade opacity in here rather than reusing the observer above,
// which would overwrite that transform with a flat translateY via inline style.
const reviewObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.review-card').forEach(el => {
  el.style.opacity = '0';
  el.style.transition = 'opacity 0.5s ease';
  reviewObserver.observe(el);
});

// ===== Mena "an agent replied" notification (site-wide) =====
// main.js loads on nearly every page, but this does nothing unless the
// current visitor has a Mena chat that was escalated to a human and is
// still waiting on a reply — cheap to skip for everyone else. Support.html
// runs its own, richer version of this same check (js/mena-chat.js,
// checkForReply), so this is deliberately skipped there to avoid a
// duplicate request and a toast pointing at the page you're already on.
// See supabase/functions/mena-session-status for the guest-safe read path
// this relies on (no direct table access with the public anon key).
(function () {
  const SESSION_ID_KEY = 'sw_mena_session_id';
  const ESCALATED_KEY = 'sw_mena_escalated';
  const HISTORY_KEY = 'sw_mena_history';
  const MENA_SUPABASE_URL = 'https://mseywoukzrktdghstxwv.supabase.co';
  const MENA_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zZXl3b3VrenJrdGRnaHN0eHd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NTgwMzUsImV4cCI6MjA5NTUzNDAzNX0.bTm6JRABNrmhd8TfioqOhBAcp5zhyojMZMWsnJ4MIo4';

  const path = window.location.pathname;
  if (path.indexOf('/support.html') !== -1) return;
  if (localStorage.getItem(ESCALATED_KEY) !== '1') return;
  const sessionId = localStorage.getItem(SESSION_ID_KEY);
  if (!sessionId) return;

  function supportHref() {
    if (path.indexOf('/pages/guides/') !== -1) return '../support.html';
    if (path.indexOf('/pages/') !== -1) return 'support.html';
    return 'pages/support.html';
  }

  function showMenaReplyToast() {
    const toast = document.createElement('div');
    toast.style.cssText =
      'position:fixed;bottom:24px;left:24px;z-index:9999;display:flex;align-items:center;gap:10px;' +
      'background:#022c22;color:#fff;padding:12px 16px;border-radius:12px;font-family:sans-serif;' +
      'font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,0.25);max-width:calc(100vw - 48px);';

    const link = document.createElement('a');
    link.href = supportHref() + '#chatWrapper';
    link.textContent = 'An agent replied to your chat with Mena — tap to view';
    link.style.cssText = 'color:#fff;text-decoration:underline;';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Dismiss');
    closeBtn.style.cssText =
      'background:none;border:none;color:rgba(255,255,255,0.6);font-size:18px;line-height:1;' +
      'cursor:pointer;padding:0 2px;';
    closeBtn.addEventListener('click', () => toast.remove());

    toast.appendChild(link);
    toast.appendChild(closeBtn);
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 20000);
  }

  fetch(`${MENA_SUPABASE_URL}/functions/v1/mena-session-status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: MENA_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${MENA_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ session_id: sessionId }),
  })
    .then((r) => r.json())
    .then((data) => {
      if (!data || !data.ok || !data.found || !data.hadNewReply) return;

      // Fold the new admin message(s) into local history now, so
      // support.html shows them immediately once the visitor gets there.
      try {
        const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
        const lastTs = history.length ? history[history.length - 1].ts : null;
        (data.messages || []).forEach((m) => {
          if (m.sender === 'admin' && (!lastTs || m.ts > lastTs)) {
            history.push({ sender: 'admin', text: m.text, ts: m.ts });
          }
        });
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      } catch (e) {
        // Non-critical — worst case the reply just shows up via the
        // support.html-side check instead.
      }

      showMenaReplyToast();
    })
    .catch(() => {
      // Silent — this is a background nicety, not core page functionality.
    });
})();

// Rotating hero headline: "A smarter way to" stays fixed while the
// second half cycles through a few phrases every 5 seconds.
const heroRotator = document.getElementById('heroRotator');
if (heroRotator) {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!prefersReducedMotion) {
    const phrases = ['share success', 'grow together', 'build wealth', 'earn together'];
    let phraseIndex = 0;
    setInterval(() => {
      phraseIndex = (phraseIndex + 1) % phrases.length;
      heroRotator.classList.add('swap');
      setTimeout(() => {
        heroRotator.textContent = phrases[phraseIndex];
        heroRotator.classList.remove('swap');
      }, 300);
    }, 5000);
  }
}
