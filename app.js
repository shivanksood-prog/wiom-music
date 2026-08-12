/* Wiom Music — swipeable vibe radio.
 * Visible YouTube player framed as an in-scene CRT (compliant: ≥200px, never
 * hidden or covered during playback). Pseudo-live clock sync per channel. */

const ANCHOR = Date.UTC(2026, 7, 10, 0, 0, 0) / 1000;
let CHANNELS = [];
let active = -1;
let player = null;
let playerReady = false;
let started = false;
let userQueue = null;
const $ = (id) => document.getElementById(id);

/* ---------- pseudo-live schedule ---------- */
function livePosition(ch) {
  const now = Date.now() / 1000;
  let off = (now - ANCHOR) % ch.totalSec;
  if (off < 0) off += ch.totalSec;
  for (let i = 0; i < ch.tracks.length; i++) {
    const d = ch.tracks[i].durationSec;
    if (off < d) return { idx: i, sec: Math.floor(off) };
    off -= d;
  }
  return { idx: 0, sec: 0 };
}

/* ---------- feed ---------- */
function buildFeed() {
  const feed = $("feed");
  CHANNELS.forEach((ch, i) => {
    const sec = document.createElement("section");
    sec.className = "channel";
    sec.dataset.i = i;
    sec.id = ch.slug;
    sec.innerHTML = `
      <img class="scene" src="scenes/${ch.slug}.svg" alt="" ${i > 1 ? 'loading="lazy"' : ""}>
      <div class="scrim-top"></div><div class="scrim-bottom"></div>
      <div class="lockup"><h1>${ch.hindiName}</h1><p>${ch.tagline}</p></div>`;
    feed.appendChild(sec);
  });
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting && e.intersectionRatio >= 0.6) {
        setActive(parseInt(e.target.dataset.i, 10));
      }
    }
  }, { root: feed, threshold: 0.6 });
  document.querySelectorAll(".channel").forEach((s) => io.observe(s));
}

function setActive(i) {
  if (i === active) return;
  active = i;
  userQueue = null;
  const ch = CHANNELS[i];
  document.body.dataset.daypart = ch.daypart || "any";
  document.body.dataset.channel = ch.slug;
  document.querySelectorAll(".channel.active").forEach((s) => s.classList.remove("active"));
  document.getElementById(ch.slug).classList.add("active");
  history.replaceState(null, "", "#" + ch.slug);
  $("yt-pill").href = "https://www.youtube.com/watch_videos?video_ids=" +
    ch.tracks.slice(0, 50).map((t) => t.ytId).join(",");
  updatePresence(true);
  if (started) {
    tuneIn();
    dismissCoach("coach-swipe");
  }
}

/* ---------- player ---------- */
function tuneIn() {
  const ch = CHANNELS[active];
  const pos = userQueue || livePosition(ch);
  const t = ch.tracks[pos.idx];
  setNowPlaying(t);
  endSkipped = false;
  curTrackDur = t.durationSec || 0;
  if (playerReady) player.loadVideoById({ videoId: t.ytId, startSeconds: pos.sec || 0 });
}

/* an ad reports a much shorter duration than the real track — detect, never skip it */
function isAd(dur) {
  return curTrackDur > 0 && dur > 0 && dur < Math.min(70, curTrackDur * 0.5);
}

function setNowPlaying(t) {
  $("np-title").textContent = t.title;
  $("np-sub").textContent = `${t.artist}${t.film ? " · " + t.film : ""} · ${t.uploader}`;
  $("disc").src = `https://i.ytimg.com/vi/${t.ytId}/hqdefault.jpg`;
  $("np").onclick = () =>
    window.open(`https://www.youtube.com/watch?v=${t.ytId}`, "_blank", "noopener");
}

function currentIdx() {
  return (userQueue || livePosition(CHANNELS[active])).idx;
}

function step(delta) {
  const ch = CHANNELS[active];
  const n = ch.tracks.length;
  userQueue = { idx: (currentIdx() + delta + n) % n, sec: 0 };
  tuneIn();
}

function fmt(s) {
  s = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

let endSkipped = false, curTrackDur = 0;
function tick() {
  if (!playerReady || !started || !player.getDuration) return;
  const dur = player.getDuration(), cur = player.getCurrentTime();
  if (dur <= 0) return;
  if (isAd(dur)) {
    // an ad is playing — hold the pill, tell the user, and DO NOT skip it
    document.body.classList.add("ad");
    $("np-time").textContent = "▶ Ad chal raha hai · gaana aa raha hai…";
    return;
  }
  document.body.classList.remove("ad");
  $("bar-fill").style.width = (cur / dur) * 100 + "%";
  $("t-cur").textContent = fmt(cur);
  $("t-tot").textContent = fmt(dur);
  // jump to next ~9s early so YouTube's end-screen cards never appear (real track only)
  if (!endSkipped && dur - cur < 9 && cur > 5) { endSkipped = true; step(1); }
}
setInterval(tick, 1000);

function setPlayingUI(playing) {
  document.body.classList.toggle("playing", playing);
  $("ic-play").classList.toggle("hidden", playing);
  $("ic-pause").classList.toggle("hidden", !playing);
}

function onYTState(e) {
  if (e.data === YT.PlayerState.ENDED) step(1);
  else if (e.data === YT.PlayerState.PLAYING) setPlayingUI(true);
  else if (e.data === YT.PlayerState.PAUSED) setPlayingUI(false);
}

function onYTError() { step(1); }

window.onYouTubeIframeAPIReady = function () {
  player = new YT.Player("yt", {
    width: "100%", height: "100%",
    host: "https://www.youtube-nocookie.com",
    playerVars: {
      playsinline: 1, rel: 0, autoplay: 0,
      controls: 0, disablekb: 1, modestbranding: 1,
      iv_load_policy: 3, fs: 0, cc_load_policy: 0,
    },
    events: {
      onReady: () => {
        playerReady = true;
        // autoplay-by-default: muted playback is allowed without a gesture
        player.mute();
        startPlayback();
        $("unmute").classList.remove("hidden");
      },
      onStateChange: onYTState,
      onError: onYTError,
    },
  });
};

/* first gesture anywhere = sound on */
let unmuted = false;
function soundOn() {
  if (unmuted || !playerReady) return;
  unmuted = true;
  player.unMute();
  if (player.getPlayerState() !== YT.PlayerState.PLAYING) player.playVideo();
  $("unmute").classList.add("hidden");
  showCoach("coach-swipe");
}
document.addEventListener("pointerdown", soundOn, { capture: true });
$("unmute").onclick = soundOn;

/* ---------- presence + arrival toasts (local heuristic until PartyKit) ---------- */
function seedCount(slug) {
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) % 997;
  const hour = new Date().getHours();
  const curve = hour < 6 ? 0.4 : hour < 11 ? 0.9 : hour < 17 ? 0.7 : hour < 23 ? 1.3 : 0.6;
  return Math.max(3, Math.round((14 + (h % 38)) * curve));
}
let presenceBase = 0;
function updatePresence(reseed) {
  const ch = CHANNELS[active];
  if (!ch) return;
  if (reseed) presenceBase = seedCount(ch.slug);
  presenceBase = Math.max(3, presenceBase + (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.3 ? 1 : 0));
  $("presence-count").textContent = presenceBase;
  $("presence-noun").textContent = ch.counterNoun || "sun rahe hain";
}
setInterval(() => updatePresence(false), 8000);

const TOWNS = ["Meerut", "Rohtak", "Patna", "Kanpur", "Indore", "Jaipur", "Lucknow",
  "Bhopal", "Varanasi", "Agra", "Gwalior", "Prayagraj", "Ranchi", "Ludhiana", "Hisar"];
function arrivalToast() {
  if (!started) return;
  const t = $("toast");
  t.textContent = `${TOWNS[Math.floor(Math.random() * TOWNS.length)]} se koi jude 👋`;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 4200);
}
setInterval(() => { if (Math.random() < 0.5) arrivalToast(); }, 32000);


/* ---------- coach marks ---------- */
function showCoach(id) { if (!localStorage.getItem("wm_" + id)) $(id).classList.remove("hidden"); }
function dismissCoach(id) { localStorage.setItem("wm_" + id, "1"); $(id).classList.add("hidden"); }

/* ---------- share ---------- */
$("share-btn").onclick = () => {
  const ch = CHANNELS[active];
  const url = location.origin + location.pathname + "#" + ch.slug;
  const text = ch.shareLine || `${ch.name} sun raha hoon Wiom Tunes pe`;
  if (navigator.share) navigator.share({ text, url }).catch(() => {});
  else navigator.clipboard.writeText(text + " " + url);
};

/* ---------- boot ---------- */
function startPlayback() {
  if (started) return;
  started = true;
  setPlayingUI(true);
  $("wiom-cta").classList.add("show");
  tuneIn();
}

/* gestures on the feed:
 *  - vertical swipe (native snap-scroll) = channel
 *  - horizontal swipe = prev/next SONG
 *  - tap on left/right EDGE = prev/next CHANNEL (TV-remote zapping) */
function goChannel(delta) {
  const t = Math.min(CHANNELS.length - 1, Math.max(0, active + delta));
  if (t !== active) document.getElementById(CHANNELS[t].slug).scrollIntoView({ behavior: "smooth" });
}
function ripple(x, y) {
  const r = document.createElement("span");
  r.className = "tap-ripple";
  r.style.left = x + "px"; r.style.top = y + "px";
  document.body.appendChild(r);
  setTimeout(() => r.remove(), 500);
}
let tx = 0, ty = 0, tt = 0;
$("feed").addEventListener("touchstart", (e) => {
  tx = e.touches[0].clientX; ty = e.touches[0].clientY; tt = Date.now();
}, { passive: true });
$("feed").addEventListener("touchend", (e) => {
  const x = e.changedTouches[0].clientX, y = e.changedTouches[0].clientY;
  const dx = x - tx, dy = y - ty, dt = Date.now() - tt;
  if (Math.abs(dx) > 60 && Math.abs(dx) > 1.6 * Math.abs(dy)) { step(dx < 0 ? 1 : -1); return; }
  if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 350) {
    const w = window.innerWidth;
    if (x > w * 0.85) { ripple(x, y); goChannel(1); }
    else if (x < w * 0.15) { ripple(x, y); goChannel(-1); }
  }
}, { passive: true });
$("feed").addEventListener("click", (e) => {
  if (e.target.closest("#pill,#topbar,#yt-dock,#unmute,a,button")) return;
  const w = window.innerWidth;
  if (e.clientX > w * 0.85) { ripple(e.clientX, e.clientY); goChannel(1); }
  else if (e.clientX < w * 0.15) { ripple(e.clientX, e.clientY); goChannel(-1); }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") step(1);
  if (e.key === "ArrowLeft") step(-1);
});
$("pp").onclick = () => {
  if (!started) return startPlayback();
  if (!playerReady) return;
  const st = player.getPlayerState();
  if (st === YT.PlayerState.PLAYING) player.pauseVideo();
  else player.playVideo();
};
$("prev").onclick = () => started && step(-1);
$("next").onclick = () => started && step(1);

/* ---------- version toggle: A = audio-only, B (?tv) = embedded CRT ---------- */
function applyMode(tv) {
  document.body.classList.toggle("tv-mode", tv);
  $("mode-toggle").textContent = tv ? "🎵 Sirf audio" : "📺 TV dikhao";
  const u = new URL(location);
  if (tv) u.searchParams.set("tv", "1"); else u.searchParams.delete("tv");
  history.replaceState(null, "", u.pathname + u.search + u.hash);
}
applyMode(new URLSearchParams(location.search).has("tv"));
$("mode-toggle").onclick = () => applyMode(!document.body.classList.contains("tv-mode"));

window.__wm = () => ({
  ready: playerReady, started, active,
  state: player && player.getPlayerState ? player.getPlayerState() : null,
});

fetch("channels.json")
  .then((r) => r.json())
  .then((data) => {
    CHANNELS = data.channels.filter((c) => c.ready);
    if (!CHANNELS.length) {
      document.body.innerHTML =
        '<p style="padding:40vh 24px;text-align:center">Channels abhi ban rahe hain… (run merge.py)</p>';
      return;
    }
    buildFeed();
    const want = location.hash.slice(1);
    const idx = CHANNELS.findIndex((c) => c.slug === want);
    const start = idx === -1 ? 0 : idx;
    setActive(start);
    if (start > 0) document.getElementById(CHANNELS[start].slug).scrollIntoView();
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
