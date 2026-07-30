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

// Facebook page embed — built as a plain iframe sized to the real container
// width (Facebook's SDK measures too early on mobile and can render nothing).
(function () {
  var box = document.getElementById('fb-embed');
  if (!box) return;

  var current = 0;

  function render() {
    var w = Math.min(500, Math.max(220, Math.floor(box.clientWidth)));
    if (w === current) return;
    current = w;
    var h = 720;
    var src = 'https://www.facebook.com/plugins/page.php' +
      '?href=' + encodeURIComponent('https://www.facebook.com/EDENStudentService') +
      '&tabs=timeline&width=' + w + '&height=' + h +
      '&small_header=true&adapt_container_width=true&hide_cover=false&show_facepile=false&locale=th_TH';
    box.innerHTML = '<iframe title="โพสต์ล่าสุดจากเพจ Facebook ของ Eden Student Service" src="' + src +
      '" width="' + w + '" height="' + h + '" style="border:none;overflow:hidden;max-width:100%"' +
      ' scrolling="no" frameborder="0" allowfullscreen="true"' +
      ' allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share" loading="lazy"></iframe>';
  }

  render();

  var timer;
  window.addEventListener('resize', function () {
    clearTimeout(timer);
    timer = setTimeout(render, 300);
  });
})();
