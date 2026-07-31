// Fetches the latest public posts from the Eden Facebook page via the
// official Graph API and stores them (plus their images) in assets/data/,
// where the homepage renders them as native cards. Runs from the
// "Update Facebook feed" GitHub Action on a schedule.
//
// Requires the FB_PAGE_TOKEN environment variable (a Page access token
// with pages_read_engagement). Without it the script exits quietly so
// scheduled runs stay green until the token is configured.

const fs = require('fs');

const TOKEN = process.env.FB_PAGE_TOKEN;
const PAGE = 'EDENStudentService';
const OUT_DIR = 'assets/data';
const IMG_DIR = `${OUT_DIR}/fb`;
const MAX_POSTS = 3;

if (!TOKEN) {
  console.log('FB_PAGE_TOKEN not set - skipping feed update.');
  process.exit(0);
}

// Graph returns permalinks of the form facebook.com/{numeric-profile-id}/posts/{id}.
// The Facebook mobile app's link router often cannot resolve that numeric form and
// lands on a blank screen, while the same post opens fine from the page's vanity
// name. Rewrite to the vanity form; /reel/ and /share/ links already work as-is.
function normalizePermalink(url) {
  if (!url) return url;
  return url.replace(
    /facebook\.com\/\d+\/(posts|videos|photos)\//,
    'facebook.com/' + PAGE + '/$1/'
  );
}

(async () => {
  const fields = 'message,permalink_url,full_picture,created_time';
  const url = `https://graph.facebook.com/v21.0/${PAGE}/posts?fields=${fields}&limit=10&access_token=${TOKEN}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || !Array.isArray(data.data)) {
    console.error('Graph API error:', JSON.stringify(data).slice(0, 400));
    process.exit(1);
  }

  fs.mkdirSync(IMG_DIR, { recursive: true });
  for (const f of fs.readdirSync(IMG_DIR)) fs.unlinkSync(`${IMG_DIR}/${f}`);

  const posts = [];
  for (const p of data.data) {
    if (posts.length >= MAX_POSTS) break;
    if (!p.message && !p.full_picture) continue;

    let image = null;
    if (p.full_picture) {
      try {
        const r = await fetch(p.full_picture);
        if (r.ok) {
          image = `${IMG_DIR}/post-${posts.length}.jpg`;
          fs.writeFileSync(image, Buffer.from(await r.arrayBuffer()));
        }
      } catch (e) {
        console.warn('image fetch failed:', String(e).slice(0, 120));
      }
    }

    posts.push({
      message: (p.message || '').slice(0, 500),
      permalink: normalizePermalink(p.permalink_url),
      image,
      created: p.created_time,
    });
  }

  fs.writeFileSync(
    `${OUT_DIR}/fb-posts.json`,
    JSON.stringify({ updated: new Date().toISOString(), posts }, null, 1)
  );
  console.log(`Wrote ${posts.length} posts.`);
})();
