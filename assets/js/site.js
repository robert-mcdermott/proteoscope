// Proteoscope website: theme, navigation, install tabs, copy buttons, table of contents, lightbox.

const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
};

const ICON_COPY = '<svg class="icon-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
const ICON_CHECK = '<svg class="icon-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';

// Theme: the saved choice, else the system's. The button flips between light and dark.
function currentTheme() {
  const saved = document.documentElement.dataset.theme;
  if (saved) return saved;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
document.querySelectorAll('.theme-toggle').forEach((button) => {
  button.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    storage.set('proteoscope-theme', next);
  });
});

// Mobile navigation and the documentation menu.
document.querySelectorAll('.nav-toggle').forEach((button) => {
  const nav = document.getElementById(button.getAttribute('aria-controls'));
  button.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    button.setAttribute('aria-expanded', String(open));
  });
});
document.querySelectorAll('.docs-menu-toggle').forEach((button) => {
  const sidebar = button.closest('.docs-sidebar');
  button.addEventListener('click', () => {
    const open = sidebar.classList.toggle('is-open');
    button.setAttribute('aria-expanded', String(open));
  });
});

// Tabs. Tab groups marked data-os pick the visitor's operating system first.
function detectOS() {
  const platform = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '').toLowerCase();
  if (platform.includes('win')) return 'windows';
  if (platform.includes('mac') || platform.includes('iphone') || platform.includes('ipad')) return 'macos';
  return 'linux';
}
function selectTab(tab) {
  const list = tab.closest('[role="tablist"]');
  list.querySelectorAll('[role="tab"]').forEach((other) => {
    const selected = other === tab;
    other.setAttribute('aria-selected', String(selected));
    other.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(other.getAttribute('aria-controls'));
    if (panel) panel.hidden = !selected;
  });
}
document.querySelectorAll('[role="tablist"]').forEach((list) => {
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      const next = tabs[(index + step + tabs.length) % tabs.length];
      next.focus();
      selectTab(next);
    });
  });
  if (list.dataset.os !== undefined) {
    const os = detectOS();
    const match = tabs.find((tab) => (tab.dataset.os || '').split(' ').includes(os));
    if (match) selectTab(match);
  }
});

// Copy buttons on code blocks.
// Illustrations (a transcript) are marked data-no-copy.
document.querySelectorAll('.code:not([data-no-copy])').forEach((block) => {
  const pre = block.querySelector('pre');
  if (!pre || block.querySelector('.copy-button')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy-button';
  button.setAttribute('aria-label', 'Copy to clipboard');
  button.innerHTML = ICON_COPY + ICON_CHECK;
  button.addEventListener('click', async () => {
    const text = [...pre.querySelectorAll('code')].map((code) => {
      const clone = code.cloneNode(true);
      clone.querySelectorAll('.prompt, .comment').forEach((node) => node.remove());
      return clone.textContent;
    }).join('\n').replace(/\s+$/, '');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    button.classList.add('is-copied');
    setTimeout(() => button.classList.remove('is-copied'), 1600);
  });
  block.append(button);
});

// Documentation: heading anchors and the "On this page" list, highlighted while scrolling.
const doc = document.querySelector('.doc');
const toc = document.querySelector('.toc ul');
if (doc) {
  const headings = [...doc.querySelectorAll('h2[id], h3[id]')];
  headings.forEach((heading) => {
    const anchor = document.createElement('a');
    anchor.className = 'anchor';
    anchor.href = `#${heading.id}`;
    anchor.setAttribute('aria-label', `Link to ${heading.textContent}`);
    anchor.textContent = '#';
    heading.append(anchor);
  });
  if (toc) {
    const links = new Map();
    headings.filter((heading) => heading.tagName === 'H2').forEach((heading) => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = `#${heading.id}`;
      link.textContent = heading.firstChild.textContent.trim();
      item.append(link);
      toc.append(item);
      links.set(heading, link);
    });
    if (!links.size) toc.closest('.toc').hidden = true;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!visible) return;
      links.forEach((link) => link.classList.remove('is-active'));
      links.get(visible.target)?.classList.add('is-active');
    }, { rootMargin: '-72px 0px -70% 0px' });
    links.forEach((_, heading) => observer.observe(heading));
  }
}

// Lightbox: screenshots open at full size.
const lightbox = document.createElement('dialog');
lightbox.className = 'lightbox';
lightbox.innerHTML = '<img alt="" /><p></p>';
document.body.append(lightbox);
lightbox.addEventListener('click', () => lightbox.close());
document.querySelectorAll('.shot img').forEach((image) => {
  image.addEventListener('click', () => {
    if (!lightbox.showModal) return;
    const full = lightbox.querySelector('img');
    full.src = image.currentSrc || image.src;
    full.alt = image.alt;
    lightbox.querySelector('p').textContent = image.closest('figure')?.querySelector('figcaption')?.textContent || '';
    lightbox.showModal();
  });
});
