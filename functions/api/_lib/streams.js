// Live stream links for Lobi Stars home games (Matchday Live "Watch Live").
// Staff paste a normal YouTube or Facebook link; only links to those two
// sites are accepted, and the embed URLs are built from them here so a page
// never embeds an arbitrary address.

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** YouTube video/live id from watch, youtu.be, /live/, /embed/ and /shorts/ links, or null. */
export function youtubeId(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = u.pathname.match(/^\/(?:live|embed|shorts|v)\/([^/?#]+)/);
      if (m) id = m[1];
    }
  }
  return id && YT_ID.test(id) ? id : null;
}

/** A cleaned Facebook video/live link, or null. */
export function facebookUrl(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  if (host === 'fb.watch') return `https://fb.watch${u.pathname}`;
  if (!/^(www\.|m\.|web\.)?facebook\.com$/.test(host)) return null;
  if (u.pathname.length < 2) return null;
  // Keep only what identifies the video (e.g. ?v=123 on /watch links).
  const v = u.searchParams.get('v');
  return `https://www.facebook.com${u.pathname}${v ? `?v=${encodeURIComponent(v)}` : ''}`;
}

/** Validates the two optional stream fields from the admin form. */
export function parseStreams(b) {
  const yt = typeof b?.youtube_url === 'string' ? b.youtube_url.trim() : '';
  const fb = typeof b?.facebook_url === 'string' ? b.facebook_url.trim() : '';
  const out = { youtube_url: null, facebook_url: null };
  if (yt) {
    const id = youtubeId(yt);
    if (!id) return { error: 'The YouTube link is not a YouTube video or live stream link (e.g. https://www.youtube.com/live/...).' };
    out.youtube_url = `https://www.youtube.com/watch?v=${id}`;
  }
  if (fb) {
    const clean = facebookUrl(fb);
    if (!clean) return { error: 'The Facebook link is not a Facebook video or live link (e.g. https://www.facebook.com/.../videos/...).' };
    out.facebook_url = clean;
  }
  return { value: out };
}

/** What the public pages need to show the player. */
export function publicStream(centre) {
  const c = centre || {};
  const id = youtubeId(c.youtube_url);
  const fb = facebookUrl(c.facebook_url);
  return {
    youtube: id ? { url: `https://www.youtube.com/watch?v=${id}`, embed: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1&modestbranding=1` } : null,
    facebook: fb ? { url: fb, embed: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(fb)}&show_text=false&autoplay=true&allowfullscreen=true` } : null,
  };
}
