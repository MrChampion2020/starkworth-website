// Mobile hamburger menu
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobileMenu');

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