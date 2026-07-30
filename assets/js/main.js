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

// Facebook feed with a guaranteed fallback.
// Phones always get the native follow-card (the widget is unreliable on
// mobile); desktop tries the official widget and swaps to the card if
// Facebook has not rendered anything within a few seconds.
(function () {
  var box = document.getElementById('fb-embed');
  if (!box) return;

  function showCard() {
    if (box.dataset.fallback) return;
    box.dataset.fallback = '1';
    box.innerHTML =
      '<div class="fb-fallback">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.4h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12z"/></svg>' +
      '<h3>เรียนต่อออสเตรเลีย by Eden Student Service</h3>' +
      '<p>ผู้ติดตามกว่า 86,000 คน — ข่าววีซ่า โปรโมชัน และเรื่องราวนักเรียน อัปเดตทุกสัปดาห์</p>' +
      '<a class="btn btn--primary" href="https://www.facebook.com/EDENStudentService" rel="noopener" target="_blank">ดูโพสต์ล่าสุดบน Facebook</a>' +
      '</div>';
  }

  if (window.matchMedia('(max-width: 799px)').matches) {
    showCard();
    return;
  }

  var tries = 0;
  var timer = setInterval(function () {
    tries += 1;
    var frame = box.querySelector('iframe');
    var rect = frame && frame.getBoundingClientRect();
    if (rect && rect.width > 150 && rect.height > 150) {
      clearInterval(timer);
      return;
    }
    if (tries >= 8) {
      clearInterval(timer);
      showCard();
    }
  }, 1000);
})();
