// Mobile navigation toggle + footer year
(function () {
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');

  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  var year = document.getElementById('year');
  if (year) {
    year.textContent = new Date().getFullYear();
  }
})();

// Facebook feed: renders posts fetched by the "Update Facebook feed"
// GitHub Action into native cards. Until the feed data exists (or if it
// fails to load), a styled follow-card shows instead - never a blank box.
(function () {
  var box = document.getElementById('fb-embed');
  if (!box) return;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function showCard() {
    box.innerHTML =
      '<div class="fb-fallback">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.4h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12z"/></svg>' +
      '<h3>เรียนต่อออสเตรเลีย by Eden Student Service</h3>' +
      '<p>ผู้ติดตามกว่า 86,000 คน — ข่าววีซ่า โปรโมชัน และเรื่องราวนักเรียน อัปเดตทุกสัปดาห์</p>' +
      '<a class="btn btn--primary" href="https://www.facebook.com/EDENStudentService" rel="noopener" target="_blank">ดูโพสต์ล่าสุดบน Facebook</a>' +
      '</div>';
  }

  fetch('assets/data/fb-posts.json', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) {
      if (!d.posts || !d.posts.length) { showCard(); return; }
      var v = encodeURIComponent(d.updated || '');
      box.innerHTML = '<div class="fb-posts">' + d.posts.map(function (p) {
        var img = p.image
          ? '<img src="' + esc(p.image) + '?v=' + v + '" alt="ภาพจากโพสต์ Facebook" loading="lazy">'
          : '';
        var msg = p.message || '';
        if (msg.length > 200) msg = msg.slice(0, 200) + '\u2026';
        var date = '';
        if (p.created) {
          try {
            date = new Date(p.created).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
          } catch (e) { /* ignore */ }
        }
        return '<a class="fb-post" href="' + esc(p.permalink) + '" rel="noopener" target="_blank">' +
          img +
          '<div class="fb-post__body"><p>' + esc(msg) + '</p>' +
          '<span>' + esc(date) + (date ? ' \u00b7 ' : '') + 'ดูบน Facebook</span></div></a>';
      }).join('') + '</div>';
    })
    .catch(showCard);
})();
