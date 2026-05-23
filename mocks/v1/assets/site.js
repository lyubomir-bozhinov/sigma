(() => {
  const toggle = document.querySelector('[data-search-toggle]');
  const drawer = document.getElementById('searchDrawer');
  if (!toggle || !drawer) return;

  const input = drawer.querySelector('input[type="search"]');
  const closeBtn = drawer.querySelector('.search-drawer-close');
  let hideTimer = null;

  const isOpen = () => drawer.classList.contains('is-open');

  const open = () => {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    drawer.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => {
      drawer.classList.add('is-open');
      input && input.focus({ preventScroll: true });
    });
  };

  const close = () => {
    drawer.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    hideTimer = setTimeout(() => {
      if (!drawer.classList.contains('is-open')) drawer.hidden = true;
      hideTimer = null;
    }, 220);
  };

  toggle.addEventListener('click', (e) => {
    e.preventDefault();
    isOpen() ? close() : open();
  });
  if (closeBtn) closeBtn.addEventListener('click', close);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
      close();
      toggle.focus();
    }
  });

  document.addEventListener('click', (e) => {
    if (!isOpen()) return;
    if (drawer.contains(e.target) || toggle.contains(e.target)) return;
    close();
  });
})();
