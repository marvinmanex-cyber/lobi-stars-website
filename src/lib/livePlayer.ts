// Lobi Stars FC Live: the one audio engine behind every commentary player on
// a page (/commentary, the Matchday Live tab, the homepage banner, the
// pop-out mini player). There is a single <audio> per page, so two players
// can never play at once; a BroadcastChannel also pauses other tabs/windows.
//
// - The stream address comes from /api/commentary, which only hands it out
//   while a match's commentary window is open (so nothing else is played).
// - Every Play reconnects to the live point (no seek, no stale buffer).
// - On errors/stalls: "Reconnecting…" with 2s, 5s, 10s, then 15s retries for
//   up to 5 minutes, switching to the backup stream after 2 failures.
// - Lock screen / notification shows "Lobi Stars vs X – Live" via Media Session.

export type LiveFixture = {
  id: string; slug: string; home_team: string; away_team: string; competition: string; venue: string; event_date: string;
  is_home: boolean; status: string; home_score: number | null; away_score: number | null; commentaryStart: string | null; commentaryEnd: string | null;
};
export type LiveInfo = {
  enabled: boolean; brand: string; state: 'live' | 'today' | 'off'; fixture: LiveFixture | null;
  streamUrl: string | null; backupUrl: string | null; commentators: string | null; upcoming: LiveFixture[]; serverTime: string;
};
export type LiveStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'offair' | 'error';

type Listener = () => void;
const RETRY_S = [2, 5, 10];
const RETRY_EVERY_S = 15;
const GIVE_UP_MS = 5 * 60_000;
const STALL_MS = 8000;
const HEARTBEAT_MS = 60_000;

const opponentOf = (f: LiveFixture) => (/lobi stars/i.test(f.home_team) ? f.away_team : f.home_team);

class LiveEngine {
  info: LiveInfo | null = null;
  status: LiveStatus = 'idle';
  playing = false;
  volumeSupported = true;
  private audio: HTMLAudioElement;
  private listeners = new Set<Listener>();
  private clockOffset = 0;
  private failures = 0;
  private firstFailureAt = 0;
  private useBackup = false;
  private retryTimer = 0;
  private stallTimer = 0;
  private heartbeatTimer = 0;
  private refreshTimer = 0;
  private wantPlay = false;
  private sid = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
  private channel: BroadcastChannel | null = null;
  private hls: { destroy(): void } | null = null;

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'none';
    // iPhone/iPad ignore volume changes (hardware buttons only), so hide the slider there.
    const probe = new Audio(); probe.volume = 0.5; this.volumeSupported = probe.volume === 0.5;
    this.audio.addEventListener('playing', () => this.onPlaying());
    this.audio.addEventListener('waiting', () => this.armStall());
    this.audio.addEventListener('stalled', () => this.armStall());
    this.audio.addEventListener('error', () => { if (this.wantPlay) this.onFailure(); });
    this.audio.addEventListener('ended', () => { if (this.wantPlay) this.onFailure(); });
    try {
      this.channel = new BroadcastChannel('lobi-stars-live');
      this.channel.onmessage = e => { if (e.data?.type === 'playing' && e.data.sid !== this.sid && this.wantPlay) this.pause(false); };
    } catch { /* older browsers: one player per tab still applies */ }
    this.refresh();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.refresh(); });
  }

  subscribe(fn: Listener) { this.listeners.add(fn); fn(); return () => this.listeners.delete(fn); }
  private emit() { this.listeners.forEach(fn => fn()); }
  serverNow() { return Date.now() + this.clockOffset; }
  private track(name: string) { (window as any).lsTrack?.(name, this.info?.fixture?.id || ''); }

  async refresh() {
    clearTimeout(this.refreshTimer);
    try {
      const res = await fetch('/api/commentary', { cache: 'no-store' });
      if (res.ok) {
        this.info = await res.json();
        this.clockOffset = new Date(this.info!.serverTime).getTime() - Date.now();
        // Off air now: stop rather than play anything that isn't Lobi Stars commentary.
        if (this.wantPlay && !this.info!.streamUrl) this.stop('offair');
        if (!this.wantPlay) this.status = this.info!.streamUrl ? 'idle' : 'offair';
      }
    } catch { /* keep the last known state */ }
    this.emit();
    this.refreshTimer = window.setTimeout(() => this.refresh(), this.info?.state === 'off' ? 60_000 : 20_000);
  }

  toggle() { this.wantPlay ? this.pause() : this.play(); }

  play() {
    if (!this.info?.streamUrl) { this.status = 'offair'; this.emit(); this.refresh(); return; }
    this.wantPlay = true;
    this.failures = 0; this.firstFailureAt = 0; this.useBackup = false;
    this.status = 'connecting'; this.emit();
    this.channel?.postMessage({ type: 'playing', sid: this.sid });
    this.setMediaSession();
    this.track('commentary_play');
    this.connect();
  }

  pause(track = true) {
    if (track && this.wantPlay) this.track('commentary_pause');
    this.stop('idle');
  }

  private stop(status: LiveStatus) {
    this.wantPlay = false; this.playing = false;
    clearTimeout(this.retryTimer); clearTimeout(this.stallTimer); clearInterval(this.heartbeatTimer); this.heartbeatTimer = 0;
    this.teardown();
    this.status = status === 'idle' && !this.info?.streamUrl ? 'offair' : status;
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    this.emit();
  }

  /** Drops the connection and anything buffered, so the next Play starts at the live point. */
  private teardown() {
    this.hls?.destroy(); this.hls = null;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
  }

  private async connect() {
    clearTimeout(this.stallTimer);
    const base = (this.useBackup && this.info?.backupUrl) || this.info?.streamUrl;
    if (!base) { this.stop('offair'); return; }
    this.teardown();
    const url = `${base}${base.includes('?') ? '&' : '?'}t=${Date.now()}`;
    try {
      if (/\.m3u8(\?|$)/i.test(base) && !this.audio.canPlayType('application/vnd.apple.mpegurl')) {
        const Hls = await loadHls();
        const hls = new Hls({ liveSyncDurationCount: 3, lowLatencyMode: true });
        hls.on(Hls.Events.ERROR, (_e: unknown, d: { fatal: boolean }) => { if (d.fatal && this.wantPlay) this.onFailure(); });
        hls.loadSource(url); hls.attachMedia(this.audio);
        this.hls = hls;
      } else {
        this.audio.src = url;
      }
      this.audio.volume = this.volume; this.audio.muted = this.muted;
      await this.audio.play();
    } catch (err) {
      // NotAllowedError = the browser blocked playback (no tap); anything else = connection problem.
      if ((err as Error)?.name === 'NotAllowedError') { this.stop('idle'); return; }
      if (this.wantPlay) this.onFailure();
    }
  }

  private onPlaying() {
    if (!this.wantPlay) return;
    clearTimeout(this.stallTimer);
    this.failures = 0; this.firstFailureAt = 0;
    this.playing = true; this.status = 'live';
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    if (!this.heartbeatTimer) { this.heartbeat(); this.heartbeatTimer = window.setInterval(() => this.heartbeat(), HEARTBEAT_MS); }
    this.emit();
  }

  private armStall() {
    if (!this.wantPlay) return;
    clearTimeout(this.stallTimer);
    this.stallTimer = window.setTimeout(() => { if (this.wantPlay && (this.audio.paused || this.audio.readyState < 3)) this.onFailure(); }, STALL_MS);
  }

  private async onFailure() {
    clearTimeout(this.retryTimer); clearTimeout(this.stallTimer);
    clearInterval(this.heartbeatTimer); this.heartbeatTimer = 0;
    this.playing = false;
    if (!this.firstFailureAt) { this.firstFailureAt = Date.now(); this.track('commentary_error'); }
    this.failures += 1;
    if (Date.now() - this.firstFailureAt > GIVE_UP_MS) { this.teardown(); this.stop('error'); return; }
    if (this.failures >= 2 && this.info?.backupUrl && !this.useBackup) this.useBackup = true;
    this.status = 'reconnecting'; this.emit();
    const wait = (RETRY_S[this.failures - 1] ?? RETRY_EVERY_S) * 1000;
    this.retryTimer = window.setTimeout(async () => {
      await this.refresh();
      if (this.wantPlay) this.connect();
    }, wait);
  }

  private async heartbeat() {
    try {
      const r = await fetch('/api/commentary/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid: this.sid }) });
      const d = await r.json().catch(() => ({}));
      if (d.state && d.state !== 'live') { await this.refresh(); if (!this.info?.streamUrl) this.stop('offair'); }
    } catch { /* the audio itself decides whether we're still connected */ }
  }

  volume = 1;
  muted = false;
  setVolume(v: number) { this.volume = Math.min(1, Math.max(0, v)); this.audio.volume = this.volume; if (this.volume > 0 && this.muted) this.setMuted(false); this.emit(); }
  setMuted(m: boolean) { this.muted = m; this.audio.muted = m; this.emit(); }

  private setMediaSession() {
    if (!('mediaSession' in navigator) || !this.info) return;
    const f = this.info.fixture;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: f ? `Lobi Stars vs ${opponentOf(f)} – Live` : this.info.brand,
      artist: this.info.brand,
      album: 'Match Commentary',
      artwork: [192, 512].map(s => ({ src: `/images/icon-${s}.png`, sizes: `${s}x${s}`, type: 'image/png' })),
    });
    navigator.mediaSession.setActionHandler('play', () => this.play());
    navigator.mediaSession.setActionHandler('pause', () => this.pause());
    navigator.mediaSession.setActionHandler('stop', () => this.pause());
    for (const a of ['seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'] as MediaSessionAction[]) {
      try { navigator.mediaSession.setActionHandler(a, null); } catch { /* not supported */ }
    }
  }
}

let hlsPromise: Promise<any> | null = null;
function loadHls() {
  // Only needed for HLS (.m3u8) streams on browsers without built-in HLS (Chrome/Firefox on desktop & Android).
  hlsPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';
    s.onload = () => resolve((window as any).Hls);
    s.onerror = reject;
    document.head.append(s);
  });
  return hlsPromise;
}

/** The page's single engine (created on first use). */
export function liveEngine(): LiveEngine {
  const w = window as any;
  return (w.__lobiStarsLive ??= new LiveEngine());
}

export { opponentOf };
