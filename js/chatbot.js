// Mena — Starkworth's assistant. A rule-based, client-side FAQ bot: no live
// human agent, no AI API behind it. It scores a fixed knowledge base of
// specific, direct answers against the visitor's message and returns the
// best match, falling back to a pointer at the Contact page when nothing
// scores highly enough to be a confident answer.
(function () {
  const KB = [
    // ===== Greetings & small talk =====
    { keywords: ['hello', 'hi', 'hey', 'greetings', 'good morning', 'good afternoon', 'good evening'],
      reply: "Hi, I'm Mena, Starkworth's assistant. Ask me about payouts, registration, agreements, security, or dashboards — or tap a quick question below." },
    { keywords: ['who are you', 'your name', 'what is mena', "what's mena", 'about mena'],
      reply: "I'm Mena — Starkworth's automated assistant. I match your question against a fixed set of direct answers about Starkworth's Account Owner and Annotator roles, payouts, agreements, and security. I'm not a live person, but I can get you to one via the <a href=\"contact.html\">Contact page</a> any time." },
    { keywords: ['are you a real person', 'are you human', 'are you a bot', 'are you ai', 'are you a robot'],
      reply: "No — I'm an automated, rule-based assistant, not a live agent and not backed by a general AI model. I answer from a fixed knowledge base about Starkworth. For anything I can't answer, use <a href=\"contact.html\">Contact</a> to reach a real person." },
    { keywords: ['thanks', 'thank you', 'appreciate', 'cheers'],
      reply: "You're welcome! Anything else I can help with — payouts, agreements, registration, security, or dashboards?" },
    { keywords: ['bye', 'goodbye', 'see you', 'that is all', "that's all"],
      reply: "Take care! If anything else comes up, I'll be right here, or you can reach a real person via <a href=\"contact.html\">Contact</a>." },
    { keywords: ['help', 'menu', 'what can you do', 'what can you help with', 'topics'],
      reply: "I can answer direct questions about: becoming an <a href=\"client-portal.html\">Account Owner</a>, registering as an <a href=\"worker-register.html\">Annotator</a>, how weekly payouts work, what's in the profit-sharing agreement, payment security, and how to use your dashboard. Just ask in plain language, or browse the full <a href=\"guides.html\">Guides</a> library." },

    // ===== About Starkworth =====
    { keywords: ['what is starkworth', 'what does starkworth do', 'what is this site', 'what is this company', 'tell me about starkworth'],
      reply: "Starkworth LLC is a Limited Liability Company registered in Alabama, USA. It manages AI data-annotation accounts on behalf of Account Owners under a signed profit-sharing agreement, and pays Annotators weekly for the annotation tasks they complete on those accounts." },
    { keywords: ['is starkworth legit', 'is starkworth a scam', 'is this a scam', 'is starkworth real', 'is starkworth trustworthy'],
      reply: "Starkworth is a registered LLC in Alabama, USA, and every Account Owner signs a legally binding profit-sharing agreement before any account activity begins — no bank details, PayPal emails, or wallet addresses are ever collected on a public form. That said, Starkworth doesn't guarantee earnings; read the Legal Disclaimer section of the <a href=\"faq.html#disclaimer\">FAQ</a> for the full picture before you sign anything." },
    { keywords: ['who owns starkworth', 'ceo of starkworth', 'who runs starkworth', 'who is behind starkworth'],
      reply: "That level of company detail isn't published on this site. For a direct answer, reach out via the <a href=\"contact.html\">Contact page</a> and a real person will follow up." },
    { keywords: ['where is starkworth located', 'where is starkworth based', 'starkworth address', 'starkworth headquarters'],
      reply: "Starkworth LLC is registered in Alabama, USA — that's also the jurisdiction whose laws govern the profit-sharing agreement and terms of service, per Section 19 of the agreement." },
    { keywords: ['starkworth motto', 'starkworth slogan', 'starkworth mission', 'starkworth vision', 'starkworth values'],
      reply: "Starkworth's motto is \"There's more than enough wealth to go around.\" Its mission is to turn time and effort into real income by simplifying complex AI workflows, guided by transparency, integrity, and fairness for both Account Owners and Annotators. See <a href=\"about.html\">About</a> for the full picture." },
    { keywords: ['is starkworth a job', 'is this employment', 'am i an employee', 'employer employee'],
      reply: "No. Starkworth's Agreement (Section 11) explicitly states this is an independent relationship, not employment, partnership, or agency — except for the limited authority you grant Starkworth to manage your account as an Account Owner." },
    { keywords: ['what platforms does starkworth work with', 'what ai platform', 'which ai platform', 'third party platform'],
      reply: "Starkworth manages accounts on external, third-party AI freelance platforms. Starkworth isn't affiliated with, sponsored by, or endorsed by those platforms, and specific platform names aren't published on this site — ask via <a href=\"contact.html\">Contact</a> if you need that confirmed before signing." },
    { keywords: ['how does starkworth make money', 'starkworth business model', 'how does starkworth profit'],
      reply: "Starkworth retains a share of each managed account's Net Earnings — the \"Starkworth Share\" described in Section 4 of the agreement — to cover the scale of operations, staffing, and day-to-day account management. There's no separate signup fee." },

    // ===== Roles =====
    { keywords: ['what is an account owner', 'define account owner', 'account owner meaning'],
      reply: "An Account Owner is the person who owns and authorizes a Starkworth-managed AI annotation account. You sign a profit-sharing agreement, complete verification and live screening, and then earn a share of Net Earnings each week — without doing the day-to-day annotation work yourself." },
    { keywords: ['what is an annotator', 'define annotator', 'annotator meaning'],
      reply: "An Annotator is a person who registers with Starkworth, gets approved, and performs the actual AI data-annotation tasks — labeling images, text, audio, or video — on a Starkworth-managed account. Annotators are paid weekly based on task performance and input, and don't own or manage the account itself." },
    { keywords: ['difference between account owner and annotator', 'account owner vs annotator', 'account owner or annotator', 'which role fits me', 'which role should i choose'],
      reply: "An Account Owner owns the managed account, signs the profit-sharing agreement, and earns a percentage of Net Earnings without doing the labeling work. An Annotator does the hands-on annotation tasks and is paid weekly based on performance and input, without owning or managing the account. See the full comparison: <a href=\"guides/account-owner-vs-annotator.html\">Account Owner vs Annotator</a>." },
    { keywords: ['can i be both account owner and annotator', 'both roles', 'owner and annotator at once'],
      reply: "Yes — nothing stops you from registering as an Annotator and separately signing on as an Account Owner. They're tracked as two different roles with two different logins (<a href=\"worker-login.html\">Annotator Login</a> vs <a href=\"client-portal.html\">Account Owner Portal</a>), each under its own signed agreement." },
    { keywords: ['do i need experience', 'prior experience', 'do i need annotation experience'],
      reply: "No prior AI or annotation experience is required for either role. The Annotator registration form asks about past experience only so Starkworth can match you appropriately — everyone is reviewed on the same basis." },
    { keywords: ['do i need technical skills', 'technical background', 'do i need coding skills', 'ai background'],
      reply: "No. Neither role requires a technical or AI background. Annotation tasks come with platform-specific guidelines to follow, and Account Owners don't perform the annotation work themselves — Starkworth manages that side of the account." },
    { keywords: ['ownership vs management', 'who manages my account', 'does starkworth own my account'],
      reply: "You own the account and grant Starkworth authority to manage it day to day — task completion, quality assurance, performance optimisation — for as long as active tasks remain and the agreement is in force. Ownership itself never transfers to Starkworth. See <a href=\"guides/ownership-vs-management.html\">Ownership vs Management</a>." },

    // ===== Becoming an Account Owner =====
    { keywords: ['how do i become an account owner', 'become account owner', 'sign up as account owner', 'account owner process'],
      reply: "Four steps: 1) Sign in or sign up at the <a href=\"client-portal.html\">Account Owner Portal</a>. 2) Read the full profit-sharing agreement. 3) Sign it digitally with your ID, account details, and preferred payment method. 4) Complete identity verification and live screening — then your account goes live. Full walkthrough: <a href=\"guides/become-an-account-owner.html\">How to Become a Starkworth Account Owner</a>." },
    { keywords: ['what do i need to become an account owner', 'account owner requirements', 'what do i need to sign up owner'],
      reply: "A valid government ID for verification and a laptop for a short live screening session. No prior experience with AI freelance platforms is required — Starkworth walks you through account setup and management." },
    { keywords: ['what is live screening', 'live screening process', 'what happens during live screening'],
      reply: "Live screening is a short session mandated by the AI platform Starkworth operates on, used to verify you as the real account holder. You're responsible for your own performance during it — failing a platform-mandated screening can prevent your profit-sharing agreement from starting. Details: <a href=\"guides/live-screening.html\">What to Expect During the Live Screening Process</a>." },
    { keywords: ['what is identity verification', 'id verification', 'verify my identity', 'identity check'],
      reply: "Identity verification confirms you're the legitimate account holder, using the government ID you provide. It sits alongside live screening in the Account Owner onboarding flow, before your agreement takes effect. See <a href=\"guides/identity-verification.html\">Identity Verification for Account Owners</a>." },
    { keywords: ['prepare id documents', 'what id do i need', 'id document requirements', 'valid id'],
      reply: "You'll need a valid, unexpired government-issued photo ID, clearly legible and matching the full legal name you use when signing the agreement. Practical prep tips: <a href=\"guides/prepare-id-documents.html\">How to Prepare Your ID Documents for Verification</a>." },
    { keywords: ['how long does account owner onboarding take', 'account owner timeline', 'how long to become account owner'],
      reply: "There's no fixed published timeline — it moves through four tracked steps (Sign In, Read Terms, Sign Agreement, Done) shown on the Account Owner Portal, plus identity verification and live screening. It's designed to be completed in one sitting once you have your ID ready." },
    { keywords: ['account type', 'what account type', 'types of accounts'],
      reply: "The agreement form asks for your specific Account Type when you sign, since it varies by the platform your account operates on. If you're unsure what to enter, ask via <a href=\"contact.html\">Contact</a> before signing." },
    { keywords: ['what if i fail live screening', 'failed screening', "didn't pass screening"],
      reply: "If you don't pass a platform-mandated live screening, your profit-sharing agreement may not be able to start, since the screening is a requirement set by the third-party AI platform, not by Starkworth directly." },
    { keywords: ['is a laptop required', 'do i need a laptop', 'can i sign up on my phone as owner'],
      reply: "Yes — a laptop is specifically required for the Account Owner live screening session, unlike Annotator registration, which works from any browser." },

    // ===== Becoming an Annotator =====
    { keywords: ['how do i register as an annotator', 'become an annotator', 'sign up as annotator', 'join as annotator', 'apply as annotator'],
      reply: "Fill in the <a href=\"worker-register.html\">Annotator registration form</a> with your name, email, phone, country, payment method, and any prior experience. Starkworth reviews applications and responds within 48 hours. Full walkthrough: <a href=\"guides/register-as-annotator.html\">How to Register as a Starkworth Annotator</a>." },
    { keywords: ['what info do i need to register as annotator', 'annotator registration requirements', 'what does the registration form ask'],
      reply: "First and last name, email, phone number, a password, your country of residence, how much prior annotation experience you have, and your preferred payment method (Bank Transfer, PayPal, or Other)." },
    { keywords: ['how long does annotator approval take', 'annotator review time', 'when will i hear back annotator'],
      reply: "Annotator applications are reviewed within 48 hours of submission." },
    { keywords: ['what countries can annotators register from', 'which countries', 'is my country supported', 'countries accepted'],
      reply: "The registration form lists the United Kingdom, United States, Nigeria, Ghana, South Africa, Kenya, Canada, Australia, and India by name, plus an \"Other\" option for anywhere else — those are reviewed case by case rather than auto-rejected." },
    { keywords: ['my country is not listed', 'other country', 'country not on the list'],
      reply: "Select \"Other\" on the <a href=\"worker-register.html\">registration form</a> — Starkworth reviews those applications case by case rather than turning them away automatically." },
    { keywords: ['what happens after i register as annotator', 'after annotator registration', 'next steps after applying'],
      reply: "Your application is reviewed within 48 hours. Once approved, you get access to the <a href=\"worker-dashboard.html\">Annotator Dashboard</a> and begin completing tasks, with weekly pay based on your task performance and input from there on." },
    { keywords: ['can i register on mobile', 'register from my phone', 'mobile registration'],
      reply: "Yes — the Annotator registration form works from any device with a browser; no special hardware is required. That's different from Account Owner onboarding, which needs a laptop for live screening." },
    { keywords: ['annotator application rejected', 'not approved as annotator', 'denied annotator'],
      reply: "If your application isn't approved, you'll be notified after the review period. Reach out via <a href=\"contact.html\">Contact</a> if you'd like more detail on your specific application." },
    { keywords: ['can i reapply as annotator', 'reapply after rejection', 'apply again'],
      reply: "This isn't spelled out publicly on the site — for a direct answer about reapplying, use the <a href=\"contact.html\">Contact page</a>." },

    // ===== Agreement =====
    { keywords: ['what is a profit sharing agreement', 'profit sharing agreement explained', 'what is the agreement'],
      reply: "It's the legally binding contract between you and Starkworth LLC that sets out your exact profit split, payment schedule, responsibilities, and how the arrangement can end. Nothing is binding until you've read it and signed digitally. See <a href=\"guides/what-is-a-profit-sharing-agreement.html\">What Is a Profit-Sharing Agreement</a>." },
    { keywords: ['is the agreement legally binding', 'is it a legal contract', 'is the agreement enforceable'],
      reply: "Yes. The agreement states plainly that it's legally binding, and by ticking the acknowledgement checkbox and signing, you confirm you've read, understood, and agreed to all its terms." },
    { keywords: ['what does the agreement cover', 'agreement sections', 'what is in the agreement'],
      reply: "20 sections covering: the parties, definitions, nature of services, profit-sharing terms, duration and termination, representations and responsibilities for both sides, payment method and details, taxes, the independent (non-employment) relationship, confidentiality, data protection, IP, limitation of liability, indemnification, force majeure, amendment and assignment, and governing law. Full text is on <a href=\"client-agreement.html\">the agreement page</a>." },
    { keywords: ['how long does the agreement last', 'agreement duration', 'does the agreement expire'],
      reply: "There's no fixed end date. The agreement stays active for as long as there are active tasks available on your account, and ends only under the specific conditions in Section 5 (inactivity, notice, or breach)." },
    { keywords: ['when does the agreement end', 'agreement termination conditions', 'how does the agreement end'],
      reply: "The agreement ends at the earliest of: the account becoming permanently inactive or closed; no active or pending tasks for 30 continuous days; either party giving at least 7 days' written notice; Starkworth determining continued management isn't viable; or an uncured material breach 10 business days after written notice." },
    { keywords: ['can i cancel my agreement', 'can i cancel my account', 'terminate my agreement', 'exit my agreement'],
      reply: "Yes. Either party can end the agreement by giving at least 7 days' written notice to the other. See <a href=\"guides/end-your-agreement.html\">How to End Your Starkworth Agreement the Right Way</a> for the process." },
    { keywords: ['what happens to my money if i end the agreement', 'final payout after termination', 'money owed after cancelling'],
      reply: "Starkworth calculates and pays any Net Earnings owed to you up to the effective termination date, on the next scheduled payment date (the following Wednesday cycle)." },
    { keywords: ['who owns the account after i sign', 'do i still own my account', 'account ownership after signing'],
      reply: "You do. Signing the agreement grants Starkworth authority to operate and manage the account — it doesn't transfer ownership. The account remains yours per Section 14 of the agreement." },
    { keywords: ['can starkworth change my agreement', 'can terms change without notice', 'agreement amendment'],
      reply: "No — the agreement can only be amended by a new written agreement signed by both parties (Section 18). Starkworth can't unilaterally change your terms." },
    { keywords: ['what law governs the agreement', 'governing law', 'jurisdiction', 'which state law applies'],
      reply: "The agreement is governed by the laws of the State of Alabama, USA. Disputes go through 30 days of good-faith negotiation first, then the state and federal courts of Alabama — except where consumer-protection law in your own country of residence provides otherwise." },
    { keywords: ['what if i give false information', 'inaccurate information on agreement', 'lied on application'],
      reply: "Section 6 of the agreement has you represent and warrant that all information you provide during verification, screening, and signing is true, accurate, and complete. Providing false information is a breach of that warranty and can affect your account standing." },

    // ===== Payments / payouts =====
    { keywords: ['when do i get paid', 'payout day', 'payment day', 'what day do payouts go out', 'wednesday'],
      reply: "Every Wednesday by 3:00 PM (CST), for as long as your agreement is active — for both Account Owners and Annotators." },
    { keywords: ['how is my payout calculated', 'how are payouts calculated', 'payout calculation'],
      reply: "For Account Owners: the percentage split in your individual signed agreement, applied to that week's Net Earnings (Gross Earnings minus operating and management costs). For Annotators: pay is based on your task performance and input for the week. Full breakdown: <a href=\"guides/how-payouts-are-calculated.html\">How Are Weekly Payouts Calculated?</a>." },
    { keywords: ['what percentage do i get', 'my profit share', 'profit sharing percentage', 'what is my cut', 'what is my split'],
      reply: "There's no single fixed percentage — your exact profit share is confirmed with you individually and written into your signed agreement, not advertised publicly. See <a href=\"guides/profit-sharing-percentage.html\">Understanding Your Profit-Sharing Percentage</a>, or ask via <a href=\"contact.html\">Contact</a> before you sign." },
    { keywords: ['payday falls on a holiday', 'payment on a bank holiday', 'wednesday is a holiday'],
      reply: "If a Wednesday payment is missed due to a bank holiday, banking-system delay, or a technical issue outside Starkworth's control, it's paid on the next available Business Day instead." },
    { keywords: ['my payout is late', 'payment did not arrive', "haven't been paid", 'late payment', 'missing payout'],
      reply: "First, check whether Wednesday fell on a bank holiday or there was a banking-system delay — those push payment to the next Business Day automatically. If it's still missing after that, reach out through <a href=\"contact.html\">Contact</a>. Full checklist: <a href=\"guides/late-payout.html\">What to Do If Your Payout Is Late</a>." },
    { keywords: ['earnings summary', 'payslip', 'payment history', 'weekly statement'],
      reply: "Account Owners can request a weekly earnings summary at any time, so you can see exactly how your payout was calculated against your signed agreement." },
    { keywords: ['are earnings guaranteed', 'is income guaranteed', 'guaranteed pay', 'guaranteed earnings'],
      reply: "No. Earnings are contingent on the volume of work available on the third-party AI platform and successful completion of tasks — Starkworth doesn't guarantee a specific income level for Account Owners or Annotators." },
    { keywords: ['what currency am i paid in', 'payout currency', 'which currency'],
      reply: "This isn't a fixed, published list — it's confirmed with you individually based on your country and payment method when you sign your agreement or register. Ask via <a href=\"contact.html\">Contact</a> if you need it confirmed beforehand." },
    { keywords: ['minimum payout', 'minimum payment amount', 'is there a payout threshold'],
      reply: "There's no published minimum payout threshold on the site — payouts are simply calculated against your signed agreement's terms each week." },
    { keywords: ['do annotators get paid the same as account owners', 'annotator pay vs owner pay'],
      reply: "No — different pay bases. Annotators are paid weekly based on task performance and input. Account Owners are paid a percentage share of that week's Net Earnings, per their individual signed agreement." },
    { keywords: ['operating and management costs', 'what are net earnings', 'gross earnings vs net earnings'],
      reply: "Gross Earnings is the total, unadjusted earnings an account generates in a week. Net Earnings is Gross Earnings after operating and management costs are deducted — that's the figure the Account Owner Share percentage is applied to." },
    { keywords: ['how often are payouts', 'payout frequency', 'weekly payments'],
      reply: "Weekly, every Wednesday by 3:00 PM (CST) — not monthly, biweekly, or on-demand." },
    { keywords: ['can i track my earnings', 'earnings dashboard', 'see my earnings'],
      reply: "Yes — log in to your <a href=\"worker-dashboard.html\">Annotator Dashboard</a> or <a href=\"client-dashboard.html\">Account Owner Dashboard</a> any time to check your status; detailed earnings history appears there as activity is recorded on your account." },

    // ===== Payment methods =====
    { keywords: ['what payment methods are supported', 'payment options', 'how can i get paid'],
      reply: "Bank Transfer and PayPal are the core supported methods for both roles. Account Owners can also choose Cryptocurrency or specify \"Other\" when signing the agreement; Annotators pick Bank Transfer, PayPal, or Other at registration." },
    { keywords: ['bank transfer or paypal', 'which payment method should i choose', 'bank vs paypal'],
      reply: "Bank transfer tends to suit larger amounts and local-currency stability; PayPal tends to be faster and more flexible across borders. It's your choice at registration or signing — see the full comparison: <a href=\"guides/bank-transfer-vs-paypal.html\">Bank Transfer vs PayPal</a>." },
    { keywords: ['can i use crypto', 'cryptocurrency payment', 'get paid in crypto', 'bitcoin payment'],
      reply: "Yes, for Account Owners — Cryptocurrency is one of the options on the agreement's payment method field. It's not listed as a standard option on the Annotator registration form." },
    { keywords: ['can i change my payment method', 'update payment method', 'switch payment method'],
      reply: "Payment details are only editable inside your authenticated dashboard, not on the public forms. Reach out via <a href=\"contact.html\">Contact</a> if you need to change yours." },
    { keywords: ['where do i enter my bank details', 'where do i add paypal email', 'where do i add my wallet address'],
      reply: "Never on a public form. Bank details, PayPal emails, and wallet addresses are only collected after your application is approved, inside your authenticated dashboard." },

    // ===== Security & privacy =====
    { keywords: ['is my data secure', 'is my information secure', 'data security', 'account security'],
      reply: "Your personal and payment information is handled under Starkworth's <a href=\"privacy-policy.html\">Privacy Policy</a>, with access restricted to authorized Starkworth staff and sensitive fields — bank details, PayPal emails, wallet addresses — never collected on a public form." },
    { keywords: ['do you sell my data', 'is my data sold', 'third party data sharing'],
      reply: "No — your information is never sold to third parties." },
    { keywords: ['who can see my personal info', 'who has access to my data', 'who sees my details'],
      reply: "Access is restricted to authorized Starkworth staff only." },
    { keywords: ['is my payment info safe', 'is my payment data secure', 'is my card safe', 'is paypal email safe'],
      reply: "Bank account numbers, PayPal emails, and wallet addresses are never collected on a public form — those details are only added after your application is approved, inside your authenticated dashboard. Full detail: <a href=\"privacy-policy.html\">Privacy Policy</a>." },
    { keywords: ['gdpr', 'ndpr', 'data privacy law', 'data protection rights'],
      reply: "GDPR (EU/UK) and NDPR (Nigeria) both give you rights over your personal data depending on where you live — see <a href=\"guides/data-privacy-explained.html\">Data Privacy Explained</a> for how they apply to Starkworth users specifically." },
    { keywords: ['how is my signed agreement stored', 'where is my agreement stored', 'agreement storage'],
      reply: "Signed agreements and Annotator registrations are stored securely in Starkworth's system, and both parties receive a confirmation copy by email." },
    { keywords: ['can i delete my data', 'data deletion request', 'right to be forgotten'],
      reply: "There's no public self-service deletion tool listed on the site — for a data deletion or access request, contact Starkworth directly via <a href=\"contact.html\">Contact</a> and reference the <a href=\"privacy-policy.html\">Privacy Policy</a>." },
    { keywords: ['is the site secure', 'is this website safe', 'https secure'],
      reply: "Sensitive payment fields (bank details, PayPal emails, wallet addresses) are deliberately kept off the public forms entirely — they only ever get added inside your authenticated dashboard after approval, which limits what's exposed on the open site." },
    { keywords: ['payment information security', 'how do you keep payment info secure', 'payment security measures'],
      reply: "See <a href=\"guides/payment-security.html\">How Does Starkworth Keep Payment Information Secure?</a> for the full breakdown of what's never collected publicly and how account-level access is restricted." },

    // ===== Dashboards & login =====
    { keywords: ['how do i log in as an account owner', 'account owner login', 'sign in as account owner'],
      reply: "Go to the <a href=\"client-portal.html\">Account Owner Portal</a> and use the Sign In tab. If you've already signed your agreement, you'll land on your Account Owner Dashboard; if not, you'll be taken to read and sign it first." },
    { keywords: ['how do i log in as an annotator', 'annotator login', 'sign in as annotator'],
      reply: "Go to <a href=\"worker-login.html\">Annotator Login</a> and sign in with the email and password you registered with — that takes you to your <a href=\"worker-dashboard.html\">Annotator Dashboard</a>." },
    { keywords: ['i forgot my password', 'forgot password', 'lost password'],
      reply: "Use the \"Forgot password?\" link on the <a href=\"client-portal.html\">Account Owner Portal</a> or <a href=\"worker-login.html\">Annotator Login</a> page — it emails you a reset link." },
    { keywords: ['how do i reset my password', 'reset password', 'change my password'],
      reply: "Click \"Forgot password?\" on your login page, follow the emailed link to the reset page, and set a new password there. Step by step: <a href=\"guides/reset-password.html\">How to Reset Your Password and Secure Your Account</a>." },
    { keywords: ["what's on the annotator dashboard", 'annotator dashboard contents', 'what does my dashboard show annotator'],
      reply: "Your name, email, country, preferred payment method, and current status (Active or Under Review), plus your earnings history as it's recorded against your account activity." },
    { keywords: ["what's on the account owner dashboard", 'account owner dashboard contents', 'client dashboard'],
      reply: "Your agreement status, the date you signed, your account type and payment method on file, and quick access to request a weekly earnings summary — all on your <a href=\"client-dashboard.html\">Account Owner Dashboard</a> once you're signed in." },
    { keywords: ["why can't i see my dashboard", 'dashboard not loading', 'dashboard empty'],
      reply: "Usually one of three things: you're not signed in, your session expired (sign in again), or there's no registration/agreement on file yet linked to your email. If it persists, reach out via <a href=\"contact.html\">Contact</a>." },
    { keywords: ['how do i sign out', 'log out', 'sign out'],
      reply: "Use the \"Sign Out\" button in the navigation bar on your dashboard — it clears your session and returns you to the login page." },
    { keywords: ['can i update my details after signing up', 'change my email', 'change my phone number', 'update my profile'],
      reply: "This isn't a self-service action on the public site, since it touches secure records. Reach out via <a href=\"contact.html\">Contact</a> to update your details." },

    // ===== Legal / disclaimer / liability =====
    { keywords: ['does starkworth guarantee income', 'guarantee my earnings', 'promised income'],
      reply: "No. While Starkworth aims to provide consistent weekly earning opportunities and manages accounts professionally, all earnings depend on task volume from third-party platforms — there's no guaranteed income level." },
    { keywords: ['platform suspended my account', 'account suspended', 'platform banned my account'],
      reply: "Starkworth isn't liable for account suspensions or terminations made by the third-party AI platform as a result of that platform's own policy violations — Starkworth operates on those platforms but isn't affiliated with or in control of them." },
    { keywords: ['is this legal advice', 'is this financial advice', 'legal disclaimer'],
      reply: "No. Guides and FAQ content on this site are for operational purposes only and don't constitute legal, financial, or investment advice. Always review the actual signed profit-sharing agreement and terms of service, which are the legally binding documents." },
    { keywords: ['starkworth relationship with account owners', 'is starkworth my employer'],
      reply: "Starkworth acts as a service provider and manager under a profit-sharing framework — it does not establish a direct employer-employee relationship with Account Owners." },
    { keywords: ['who pays taxes on my earnings', 'do i pay tax', 'tax obligations'],
      reply: "You do. Each party is solely responsible for their own tax obligations on amounts paid or received under the agreement. Starkworth doesn't withhold taxes on your behalf unless required to by applicable law, and nothing on this site is tax advice." },
    { keywords: ['what if starkworth breaches the agreement', 'starkworth breach', 'starkworth failed to pay'],
      reply: "If either party materially breaches the agreement and, where curable, fails to fix it within 10 Business Days of written notice, that's grounds for termination under Section 5. Section 16 also covers indemnification for losses from a material breach." },
    { keywords: ['what happens if there is a dispute', 'dispute resolution', 'legal dispute'],
      reply: "Disputes first go through 30 days of good-faith negotiation between both parties. If unresolved, they fall under the exclusive jurisdiction of Alabama's state and federal courts — except where consumer-protection law in your own country of residence provides otherwise." },
    { keywords: ['force majeure', 'platform outage', 'internet outage', 'act of god'],
      reply: "Neither party is liable for delays caused by events outside their reasonable control — platform outages, internet or banking infrastructure failures, or governmental action — under the agreement's Force Majeure clause (Section 17)." },
    { keywords: ['confidentiality', 'can i share my earnings', 'can i share agreement terms'],
      reply: "No — both parties agree to keep the agreement's terms, earnings figures, account details, and operational methods confidential, and not disclose them to third parties without written consent, except where required by law." },

    // ===== Guides & support =====
    { keywords: ['where can i learn more', 'more information', 'learn more about starkworth'],
      reply: "Start with the <a href=\"guides.html\">Guides</a> library or the <a href=\"faq.html\">FAQ</a> — both cover getting started, payments, security, and compliance in plain language." },
    { keywords: ['how many guides do you have', 'guide library', 'list of guides'],
      reply: "70 guides in total, organized into Getting Started, For Annotators, For Account Owners, Payments & Security, and Compliance & Reference — see the full index on the <a href=\"guides.html\">Guides page</a>." },
    { keywords: ['glossary', 'define terms', 'what does that word mean'],
      reply: "Check the <a href=\"guides/glossary.html\">Starkworth Glossary</a> for plain-English definitions of terms like Account Owner, Annotator, Net Earnings, and payout." },
    { keywords: ['talk to a human', 'talk to a person', 'speak to someone', 'real person', 'human agent'],
      reply: "Of course — reach a real person any time via our <a href=\"contact.html\">Contact page</a>." },
    { keywords: ['how do i contact support', 'contact starkworth', 'support email'],
      reply: "Use the <a href=\"contact.html\">Contact page</a> for a direct message to the team, or write to contact@starkworth.org for formal notices under the agreement." },
    { keywords: ['phone number', 'call starkworth', 'is there a phone line'],
      reply: "No phone number is published on this site — use the <a href=\"contact.html\">Contact page</a> to reach the team directly." },
    { keywords: ['support hours', 'when is support available', 'are you available 24/7'],
      reply: "I'm available anytime since I'm automated and reply instantly — but I only cover a fixed set of topics. Messages sent through <a href=\"contact.html\">Contact</a> are handled by real people during their normal working hours." },

    // ===== Ending / termination =====
    { keywords: ['how do i end my agreement', 'end my agreement', 'quit starkworth', 'leave starkworth'],
      reply: "Give at least 7 days' written notice to end your agreement. Full process, including what happens to outstanding earnings: <a href=\"guides/end-your-agreement.html\">How to End Your Starkworth Agreement the Right Way</a>." },
    { keywords: ['what happens after i give notice', 'after termination notice', 'notice period'],
      reply: "Your account is wound down and any Net Earnings owed up to the termination date are paid on the next scheduled payment date. Confidentiality, data protection, liability limits, and governing-law clauses all survive termination." },
    { keywords: ['does my agreement expire automatically', 'automatic termination', 'inactive account agreement'],
      reply: "Yes — if there are no active or pending tasks on your account for 30 continuous days, the agreement ends automatically under Section 5, without either party needing to give notice." },
    { keywords: ['mistakes before signing', 'what to check before signing', 'before i sign'],
      reply: "See <a href=\"guides/mistakes-before-signing.html\">7 Mistakes to Avoid Before Signing Your Agreement</a> — it covers the most common errors people make before committing." },

    // ===== Misc / specific =====
    { keywords: ['can you sign the agreement for me', 'sign on my behalf', 'auto sign agreement'],
      reply: "No — you must read, tick the acknowledgement checkbox, and draw your own signature on the <a href=\"client-agreement.html\">agreement page</a> yourself. I can't submit anything on your behalf." },
    { keywords: ['mobile app', 'is there an app', 'download the app'],
      reply: "No — there's no dedicated mobile app. Starkworth is a responsive website, so the Account Owner Portal, Annotator Dashboard, and registration forms all work from a mobile browser." },
    { keywords: ['how do i know my registration was successful', 'registration confirmation', 'did my application go through'],
      reply: "You'll see a success confirmation on screen right after submitting, and a confirmation copy is sent to your email — for the agreement specifically, within 24 hours." },
    { keywords: ['multiple annotator accounts', 'more than one account', 'second account'],
      reply: "This isn't addressed publicly on the site — for a direct answer about registering more than one account, use the <a href=\"contact.html\">Contact page</a>." },
    { keywords: ['is there a fee to join', 'signup fee', 'joining cost', 'is it free to register'],
      reply: "There's no publicized signup fee to register as an Annotator or apply as an Account Owner. Starkworth's share comes from its cut of Net Earnings under the profit-sharing agreement, not an upfront charge." },
    { keywords: ['can i change my mind before signing', 'not sure if i should sign', 'can i back out before signing'],
      reply: "Yes — nothing is binding until you tick the acknowledgement checkbox and submit your signature. You can close the page at any point before that without any obligation." },
    { keywords: ['maximize my earnings', 'increase my earnings', 'earn more', 'how to earn more'],
      reply: "Practical, honest strategies — consistency, accuracy, and good account hygiene — are in <a href=\"guides/maximize-earnings.html\">How to Maximize Your Earnings as an Annotator</a>." },
    { keywords: ['what is ai data annotation', 'what is data annotation', 'what is annotation'],
      reply: "It's the process of labeling raw data — images, text, audio, or video — so machine learning models can learn to recognize patterns. See <a href=\"guides/what-is-ai-data-annotation.html\">What Is AI Data Annotation and Why Does It Matter?</a> for the full plain-language explanation." },

    // ===== Legacy short-form matches (kept for quick-reply buttons) =====
    { keywords: ['how do payouts work', 'payout', 'payment', 'paid', 'money', 'earn'],
      reply: "Payouts go out every Wednesday by 3:00 PM (CST). Account Owners receive a percentage of that week's Net Earnings, set in their individual signed agreement; Annotators are paid based on task performance and input. See <a href=\"guides/how-payouts-are-calculated.html\">How Are Weekly Payouts Calculated?</a> for the full breakdown." },
    { keywords: ['password', 'reset', 'forgot', 'locked out'],
      reply: "You can reset your password from the <a href=\"client-portal.html\">Account Owner</a> or <a href=\"worker-login.html\">Annotator</a> login pages using \"Forgot password?\"." },
    { keywords: ['register', 'annotator', 'join', 'sign up', 'apply'],
      reply: "You can register as an Annotator here: <a href=\"worker-register.html\">Annotator Registration</a>. Applications are reviewed within 48 hours." },
    { keywords: ['account owner', 'client portal', 'owner login'],
      reply: "Account Owners sign in or get started here: <a href=\"client-portal.html\">Account Owner Portal</a>." },
    { keywords: ['agreement', 'contract', 'terms', 'sign'],
      reply: "The profit-sharing agreement sets out your exact split and payment schedule. You can review it here: <a href=\"client-agreement.html\">Profit-Sharing Agreement</a>." },
    { keywords: ['privacy', 'data', 'secure', 'security', 'safe'],
      reply: "We never collect bank details, PayPal emails, or wallet addresses on a public form — only after approval, inside your authenticated dashboard. Full details: <a href=\"privacy-policy.html\">Privacy Policy</a>." },
    { keywords: ['fee', 'commission', 'percentage', 'share', 'split', 'cut'],
      reply: "Your exact profit share is set out in your individual signed agreement — there's no single fixed percentage. Reach out via <a href=\"contact.html\">Contact</a> for specifics." },
    { keywords: ['human', 'agent', 'person', 'someone', 'representative', 'talk'],
      reply: "Of course — reach a real person any time via our <a href=\"contact.html\">Contact page</a>." },
  ];

  const FALLBACK = 'I\'m Mena, an automated assistant with a fixed set of direct answers — I don\'t have one for that yet. Browse the full <a href="guides.html">Guides</a> library, check the <a href="faq.html">FAQ</a>, or reach a real person via <a href="contact.html">Contact</a>.';

  // Score every KB entry by the total length of its matched keywords, so a
  // specific multi-word phrase (e.g. "how is my payout calculated") always
  // outranks a generic single-word overlap (e.g. "payout"). The entry with
  // the highest score wins; ties go to whichever appears first in the KB.
  function findReply(text) {
    const lower = text.toLowerCase();
    let best = null;
    let bestScore = 0;
    for (const entry of KB) {
      let score = 0;
      for (const k of entry.keywords) {
        if (lower.includes(k)) score += k.length;
      }
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }
    return best ? best.reply : FALLBACK;
  }

  window.StarkworthBot = { findReply, name: 'Mena' };
})();
