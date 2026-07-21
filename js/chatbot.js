// Starkworth Assistant — a small rule-based, client-side FAQ bot.
// It is not a live human agent and not backed by an AI API; it matches
// keywords against a fixed knowledge base and falls back to pointing
// people at the Contact page when nothing matches.
(function () {
  const KB = [
    { keywords: ['hello', 'hi', 'hey', 'greetings'],
      reply: "Hi! I'm the Starkworth Assistant. Ask me about payouts, registration, security, or agreements — or tap a quick question below." },
    { keywords: ['payout', 'payment', 'paid', 'wednesday', 'money', 'earn'],
      reply: 'Payouts go out every Wednesday by 3:00 PM (CST), based on the percentage split in your signed agreement. See the full breakdown in our <a href="faq.html">FAQ</a>.' },
    { keywords: ['password', 'reset', 'forgot', 'locked out'],
      reply: 'You can reset your password from the <a href="client-portal.html">Account Owner</a> or <a href="worker-login.html">Annotator</a> login pages using "Forgot password?".' },
    { keywords: ['register', 'annotator', 'join', 'sign up', 'apply'],
      reply: 'You can register as an Annotator here: <a href="worker-register.html">Annotator Registration</a>. Applications are reviewed within 48 hours.' },
    { keywords: ['account owner', 'client portal', 'owner login'],
      reply: 'Account Owners sign in or get started here: <a href="client-portal.html">Account Owner Portal</a>.' },
    { keywords: ['agreement', 'contract', 'terms', 'sign'],
      reply: 'The profit-sharing agreement sets out your exact split and payment schedule. You can review it here: <a href="client-agreement.html">Profit-Sharing Agreement</a>.' },
    { keywords: ['privacy', 'data', 'secure', 'security', 'safe'],
      reply: 'We never collect bank details, PayPal emails, or wallet addresses on a public form — only after approval, inside your authenticated dashboard. Full details: <a href="privacy-policy.html">Privacy Policy</a>.' },
    { keywords: ['fee', 'commission', 'percentage', 'share', 'split', 'cut'],
      reply: "Your exact profit share is set out in your individual signed agreement — there's no single fixed percentage. Reach out via <a href=\"contact.html\">Contact</a> for specifics." },
    { keywords: ['human', 'agent', 'person', 'someone', 'representative', 'talk'],
      reply: 'Of course — reach a real person any time via our <a href="contact.html">Contact page</a>.' },
    { keywords: ['thanks', 'thank you', 'appreciate'],
      reply: "You're welcome! Anything else I can help with?" },
  ];

  const FALLBACK = 'I\'m not sure about that one — I\'m an automated assistant with a limited set of quick answers. For anything else, please reach out via our <a href="contact.html">Contact page</a> and a real person will help.';

  function findReply(text) {
    const lower = text.toLowerCase();
    for (const entry of KB) {
      if (entry.keywords.some((k) => lower.includes(k))) return entry.reply;
    }
    return FALLBACK;
  }

  window.StarkworthBot = { findReply };
})();
