// Shows a one-time operational disclaimer on the legal and Annotator
// sign-up pages, once per browser session. Originally gated to visitors
// whose IP geolocated to Nigeria, but IP-based country detection is
// trivially bypassed with a VPN, so it now shows for every visitor
// instead of relying on a signal that doesn't hold up.
(function () {
  const SESSION_KEY = "sw_disclaimer_shown";

  if (sessionStorage.getItem(SESSION_KEY) === "1") return;

  function buildModal() {
    const overlay = document.createElement("div");
    overlay.className = "disclaimer-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "disclaimerTitle");

    overlay.innerHTML = `
      <div class="disclaimer-modal">
        <div class="disclaimer-modal-header">
          <div>
            <h2 id="disclaimerTitle">Operational Disclaimer</h2>
            <p>Starkworth LLC — General Disclaimer and Terms of Engagement</p>
          </div>
          <button type="button" class="disclaimer-modal-close" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="disclaimer-modal-body">
          <p><em>Based on the analysis of the operational structure of Starkworth LLC based on documents provided and information available on the official website of the company, Starkworth functions as a management layer between individual account holders and third-party AI freelance platforms, utilizing a profit-sharing model.</em></p>
          <p><em>To protect the interests of the company while maintaining the "transparent and fair" ethos described in your materials, I have drafted a comprehensive disclaimer. This statement addresses the inherent risks of third-party platform dependency, the nature of the profit-sharing relationship, and the jurisdictional boundaries of the entity.</em></p>

          <h3>1. Nature of Services</h3>
          <p>Starkworth LLC provides specialized management and operational services for AI data-annotation accounts. Starkworth acts as a service provider and manager under a profit-sharing framework and does not establish a direct employer-employee relationship with Account Owners.</p>

          <h3>2. No Guarantee of Earnings</h3>
          <p>While Starkworth strives to provide "consistent weekly earning opportunities" and manages accounts "professionally," all earnings are contingent upon the volume of work available on third-party AI freelance platforms and the successful completion of tasks. Testimonials regarding payout consistency represent individual experiences and do not constitute a guarantee of future performance or specific income levels for any participant.</p>

          <h3>3. Third-Party Platform Dependency and Risk</h3>
          <p>Starkworth's operations are conducted on external, third-party freelance platforms. Starkworth LLC is an independent entity and is not affiliated with, sponsored by, or endorsed by these platforms. Consequently, Starkworth cannot be held liable for actions taken by these third-party platforms, including but not limited to:</p>
          <ul>
            <li>Account suspensions or terminations.</li>
            <li>Changes in platform terms of service or algorithmic shifts.</li>
            <li>Technical outages or delays in payment processing originating from the platform.</li>
          </ul>

          <h3>4. Participant Responsibilities</h3>
          <p>Account Owners are responsible for the accuracy of the identification provided for verification and for their personal performance during required "live screening sessions" mandated by the AI platforms. Failure to pass platform-mandated screenings may prevent the commencement of the profit-sharing agreement.</p>

          <h3>5. Legal and Financial Advice</h3>
          <p>The information provided by Starkworth LLC, including guides and FAQ materials, is for operational purposes only and does not constitute legal, financial, or investment advice. All participants are encouraged to review the formal, legally binding profit-sharing agreement and terms of service before signing.</p>

          <h3>6. Jurisdiction</h3>
          <p>Starkworth LLC is a Limited Liability Company registered in Alabama, USA. Any disputes arising from the use of its services shall be governed by the laws of that jurisdiction and the specific terms outlined in the digitally signed Profit-Sharing Agreement.</p>

          <p><em>Note: While this disclaimer is based on the provided sources, I would also note that such a statement is standard practice for "Account Management as a Service" (AMaaS) models to mitigate liability regarding the volatility of the underlying freelance platforms.</em></p>
          <p><em>Also While this disclaimer is tailored based on the provided sources and my professional expertise, you may want to have it reviewed by a lawyer practicing in the state of Alabama (AL) to ensure it aligns with the most recent directives from the Common Access Card (CAC) regarding foreign entities operating digitally.</em></p>
        </div>
        <div class="disclaimer-modal-footer">
          <button type="button" class="btn btn-primary disclaimer-modal-ack">I Understand</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    return overlay;
  }

  function showModal() {
    const overlay = buildModal();
    const close = () => {
      overlay.classList.remove("open");
      sessionStorage.setItem(SESSION_KEY, "1");
      window.setTimeout(() => overlay.remove(), 250);
      document.removeEventListener("keydown", onKeydown);
    };
    function onKeydown(e) {
      if (e.key === "Escape") close();
    }

    overlay.querySelector(".disclaimer-modal-close").addEventListener("click", close);
    overlay.querySelector(".disclaimer-modal-ack").addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", onKeydown);

    // Next frame, so the transition actually animates in.
    requestAnimationFrame(() => overlay.classList.add("open"));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", showModal);
  } else {
    showModal();
  }
})();
