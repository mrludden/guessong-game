import { auth, db, firebaseConfigured, signInGuest, youtubeApiKey } from "./firebase.js";
import { ref, set, get, update, onValue, onDisconnect, serverTimestamp, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";

const $ = id => document.getElementById(id);
let currentRoom = null;
let isHost = false;
let stopRoomListener = null;
let playerId = null;
let ytPlayer = null;
let ytReady = false;
let loadedVideoKey = null;
let selectedVideo = null;
let currentGame = null;
const MAX_PLAYERS = 15;

function status(message, isError = false) {
  $("status").textContent = message;
  $("status").style.color = isError ? "#fca5a5" : "var(--good)";
}
function show(which) {
  $("home").classList.toggle("hidden", which !== "home");
  $("room").classList.toggle("hidden", which !== "room");
}
function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({length:6}, () => chars[Math.floor(Math.random()*chars.length)]).join("");
}
function cleanName(value) {
  return value.trim().replace(/[<>]/g, "").slice(0,18);
}
function nameKey(name) {
  return encodeURIComponent(name.trim().toLowerCase()).replace(/\./g, "%2E");
}
async function claimName(roomCode, name) {
  const claimRef = ref(db, "rooms/" + roomCode + "/nameClaims/" + nameKey(name));
  const result = await runTransaction(claimRef, current => {
    if (current === null || current === playerId) return playerId;
    return;
  });
  if (!result.committed) throw new Error("Another player is already using this username.");
}
async function requireFirebase() {
  if (!firebaseConfigured) throw new Error("Add your Firebase web app settings in firebase.js first.");
  if (!auth.currentUser) await signInGuest();
  playerId = auth.currentUser.uid;
}
function renderSearchResults(items) {
  const container = $("youtube-results");
  container.replaceChildren();
  if (!items.length) {
    container.textContent = "No matching videos found.";
    return;
  }
  for (const item of items) {
    const videoId = item.id.videoId;
    const snippet = item.snippet;
    const row = document.createElement("article");
    row.className = "youtube-result";
    const thumb = document.createElement("img");
    thumb.src = snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || "";
    thumb.alt = "";
    const details = document.createElement("div");
    details.className = "youtube-result-details";
    const title = document.createElement("strong");
    title.textContent = snippet.title;
    const channel = document.createElement("span");
    channel.textContent = snippet.channelTitle;
    const link = document.createElement("a");
    link.href = "https://www.youtube.com/watch?v=" + encodeURIComponent(videoId);
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "View on YouTube";
    const choose = document.createElement("button");
    choose.className = "button secondary small-button";
    choose.textContent = "Use this song";
    choose.addEventListener("click", () => run(async () => {
      choose.disabled = true;
      choose.textContent = "Checking…";
      try {
        const params = new URLSearchParams({part:"status", id:videoId, key:youtubeApiKey});
        const response = await fetch("https://www.googleapis.com/youtube/v3/videos?" + params);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "Could not check this video's settings.");
        const video = data.items?.[0];
        if (!video) throw new Error("YouTube did not return details for that video.");
        if (video.status?.madeForKids === true) {
          throw new Error("This video is marked Made for Kids, so Guessong won't embed it.");
        }
        selectedVideo = {id:videoId, title:snippet.title, channel:snippet.channelTitle};
        $("selected-song").textContent = snippet.title + " — " + snippet.channelTitle;
        $("selected-song-card").classList.remove("hidden");
        status("Song selected. Set the starting position, then press Play Next Song.");
      } finally {
        choose.disabled = false;
        choose.textContent = "Use this song";
      }
    }));
    details.append(title, channel, link, choose);
    row.append(thumb, details);
    container.append(row);
  }
}
async function searchYouTube() {
  const query = $("song-search").value.trim();
  if (!query) throw new Error("Enter a song title and artist to search.");
  if (!youtubeApiKey) throw new Error("Add a YouTube Data API key in firebase.js first.");
  $("search-youtube").disabled = true;
  $("youtube-results").textContent = "Searching YouTube…";
  try {
    const params = new URLSearchParams({
      part:"snippet", type:"video", maxResults:"10", q:query,
      videoEmbeddable:"true", key:youtubeApiKey
    });
    const response = await fetch("https://www.googleapis.com/youtube/v3/search?" + params);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "YouTube search failed.");
    renderSearchResults(data.items || []);
  } finally {
    $("search-youtube").disabled = false;
  }
}
function createYouTubePlayer() {
  if (ytPlayer || !window.YT || !window.YT.Player) return;
  ytPlayer = new YT.Player("youtube-player", {
    width: "320",
    height: "200",
    playerVars: {playsinline: 1, controls: 1, rel: 0, origin: window.location.origin},
    events: {
      onReady: () => {
        ytReady = true;
        if (currentGame && currentGame.currentVideoId) cueCurrentVideo();
      },
      onStateChange: event => {
        if (event.data === YT.PlayerState.CUED) $("start-listening").disabled = false;
        if (event.data === YT.PlayerState.PLAYING) $("playback-message").textContent = "Playback is running. If your audio is out of sync, press Start listening again.";
        if (event.data === YT.PlayerState.BUFFERING) $("playback-message").textContent = "Buffering…";
      },
      onError: event => {
        const messages = {
          2: "That YouTube video ID is not valid.",
          5: "This video cannot be played in the embedded player.",
          100: "This video is unavailable or private.",
          101: "The video owner does not allow embedded playback.",
          150: "The video owner does not allow embedded playback.",
          153: "YouTube could not verify the embedded player request. Try reloading the page."
        };
        $("playback-message").textContent = messages[event.data] || "YouTube playback error (" + event.data + ").";
      },
      onAutoplayBlocked: () => {
        $("playback-message").textContent = "Your browser blocked playback. Press Start listening to begin.";
      }
    }
  });
}
function loadYouTubeAPI() {
  if (window.YT && window.YT.Player) {
    createYouTubePlayer();
    return;
  }
  if (document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) return;
  window.onYouTubeIframeAPIReady = createYouTubePlayer;
  const script = document.createElement("script");
  script.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(script);
}
function cueCurrentVideo() {
  if (!ytReady || !ytPlayer || !currentGame?.currentVideoId) return;
  const offset = Math.max(0, Number(currentGame.playbackOffsetSeconds) || 0);
  const videoKey = currentGame.currentVideoId + ":" + offset;
  if (loadedVideoKey === videoKey) return;
  loadedVideoKey = videoKey;
  $("start-listening").disabled = true;
  ytPlayer.cueVideoById({videoId:currentGame.currentVideoId, startSeconds:offset});
  $("playback-message").textContent = "Song is ready. Press Start listening when you're ready.";
}
function startLocalPlayback() {
  if (!ytReady || !ytPlayer || !currentGame?.currentVideoId) {
    $("playback-message").textContent = "The YouTube player is still loading. Try again in a moment.";
    return;
  }
  const startedAt = Number(currentGame.playbackStartedAt);
  if (!startedAt) {
    $("playback-message").textContent = "Waiting for the playback start time from the room.";
    return;
  }
  const offset = Math.max(0, Number(currentGame.playbackOffsetSeconds) || 0);
  const elapsed = Math.max(0, (Date.now() - startedAt) / 1000);
  ytPlayer.seekTo(offset + elapsed, true);
  ytPlayer.playVideo();
  $("playback-message").textContent = "Starting at the shared game time…";
}
function watchRoom() {
  if (stopRoomListener) stopRoomListener();
  stopRoomListener = onValue(ref(db, "rooms/" + currentRoom), snapshot => {
    const room = snapshot.val();
    if (!room) { status("This room no longer exists.", true); show("home"); return; }
    currentGame = room.game || {};
    const phase = currentGame.phase || "lobby";
    $("room-title").textContent = phase === "lobby" ? "Waiting room" : "Game room";
    $("room-code-display").textContent = currentRoom;
    const players = Object.entries(room.players || {});
    $("player-count").textContent = players.length + " / " + MAX_PLAYERS;
    $("players").innerHTML = "";
    for (const [uid, player] of players) {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = player.name || "Player";
      const label = document.createElement("span");
      label.className = "host-label";
      label.textContent = uid === room.hostId ? "HOST" : "";
      li.append(name,label);
      $("players").append(li);
    }
    const hostView = isHost && phase === "lobby";
    $("host-settings").classList.toggle("hidden", !hostView);
    $("host-song-controls").classList.toggle("hidden", !isHost || phase === "lobby");
    $("player-waiting").classList.toggle("hidden", isHost || phase !== "lobby");
    $("playback-card").classList.toggle("hidden", phase !== "playing" || !currentGame.currentVideoId);
    $("now-playing-title").textContent = currentGame.currentVideoTitle || "Selected song";
    $("now-playing-channel").textContent = currentGame.currentVideoChannel || "";
    if (hostView) {
      if (document.activeElement !== $("topic")) $("topic").value = room.settings?.topic || "";
      $("clip-length").value = String(room.settings?.clipLength || 10);
      $("guess-time").value = String(room.settings?.guessTime || 45);
    }
    if (phase === "waiting-for-song") {
      status(isHost ? "Search for a song, select a result, and play it when ready." : "Waiting for the host to choose a song.");
    }
    if (phase === "playing" && currentGame.currentVideoId) {
      loadYouTubeAPI();
      cueCurrentVideo();
      $("playback-message").textContent = $("playback-message").textContent || "Press Start listening to join the song.";
    }
  });
}
async function createRoom() {
  await requireFirebase();
  const name = cleanName($("host-name").value);
  if (!name) throw new Error("Enter a nickname.");
  let code, existing;
  do { code = makeCode(); existing = await get(ref(db, "rooms/" + code)); } while (existing.exists());
  const room = {
    hostId: playerId,
    createdAt: serverTimestamp(),
    settings: {topic:"", clipLength:10, guessTime:45},
    game: {phase:"lobby", round:0},
    players: {}
  };
  await set(ref(db, "rooms/" + code), room);
  await claimName(code, name);
  await set(ref(db, "rooms/" + code + "/players/" + playerId), {
    name, nameKey:nameKey(name), joinedAt:serverTimestamp(), connected:true
  });
  currentRoom = code; isHost = true;
  await onDisconnect(ref(db, "rooms/" + code + "/players/" + playerId + "/connected")).set(false);
  show("room"); watchRoom(); status("Room created. Share the code with your players.");
}
async function joinRoom() {
  await requireFirebase();
  const name = cleanName($("join-name").value);
  const code = $("room-code").value.trim().toUpperCase();
  if (!name) throw new Error("Enter a nickname.");
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw new Error("Enter a valid six-character room code.");
  const roomRef = ref(db, "rooms/" + code);
  const snapshot = await get(roomRef);
  if (!snapshot.exists()) throw new Error("Room not found. Check the code.");
  const room = snapshot.val();
  const players = Object.keys(room.players || {});
  if (!room.players?.[playerId] && players.length >= MAX_PLAYERS) throw new Error("This room is full (15 players maximum).");
  if (room.game?.phase !== "lobby" && !room.players?.[playerId]) throw new Error("This game has already started.");
  await claimName(code, name);
  await set(ref(db, "rooms/" + code + "/players/" + playerId), {
    name, nameKey:nameKey(name), joinedAt:serverTimestamp(), connected:true
  });
  await onDisconnect(ref(db, "rooms/" + code + "/players/" + playerId + "/connected")).set(false);
  currentRoom = code; isHost = room.hostId === playerId;
  show("room"); watchRoom(); status("You're in. Waiting for the host.");
}
async function saveSettings() {
  const topic = $("topic").value.trim();
  if (!topic) throw new Error("Choose a topic before starting.");
  await update(ref(db, "rooms/" + currentRoom + "/settings"), {
    topic, clipLength:Number($("clip-length").value), guessTime:Number($("guess-time").value)
  });
  status("Game settings saved.");
}
async function startGame() {
  await saveSettings();
  await update(ref(db, "rooms/" + currentRoom + "/game"), {phase:"waiting-for-song", round:1, startedAt:serverTimestamp()});
  status("Game started. Search for the first song.");
}
async function playNextSong() {
  if (!selectedVideo) throw new Error("Search for a song and choose one of the results first.");
  const offset = Math.max(0, Number($("start-position").value) || 0);
  const snapshot = await get(ref(db, "rooms/" + currentRoom + "/game"));
  const game = snapshot.val() || {};
  await update(ref(db, "rooms/" + currentRoom + "/game"), {
    phase:"playing",
    round:(Number(game.round) || 0) + (game.phase === "waiting-for-song" ? 0 : 1),
    currentVideoId:selectedVideo.id,
    currentVideoTitle:selectedVideo.title,
    currentVideoChannel:selectedVideo.channel,
    playbackOffsetSeconds:offset,
    playbackStartedAt:serverTimestamp()
  });
  status("Song sent to the room. Each player should press Start listening.");
}
function run(action) {
  action().catch(error => status(error.message || "Something went wrong.", true));
}
$("show-create").addEventListener("click", () => {$("create-form").classList.remove("hidden");$("join-form").classList.add("hidden");});
$("show-join").addEventListener("click", () => {$("join-form").classList.remove("hidden");$("create-form").classList.add("hidden");});
$("create-room").addEventListener("click", () => run(createRoom));
$("join-room").addEventListener("click", () => run(joinRoom));
$("save-settings").addEventListener("click", () => run(saveSettings));
$("start-game").addEventListener("click", () => run(startGame));
$("play-next-song").addEventListener("click", () => run(playNextSong));
$("search-youtube").addEventListener("click", () => run(searchYouTube));
$("song-search").addEventListener("keydown", event => {if(event.key === "Enter") run(searchYouTube);});
$("start-listening").addEventListener("click", startLocalPlayback);
$("copy-code").addEventListener("click", async () => {if(currentRoom){await navigator.clipboard.writeText(currentRoom);status("Room code copied.");}});
$("leave-room").addEventListener("click", async () => {
  if (stopRoomListener) stopRoomListener();
  if (currentRoom && playerId) await update(ref(db, "rooms/" + currentRoom + "/players/" + playerId), {connected:false});
  currentRoom=null;isHost=false;currentGame=null;loadedVideoKey=null;selectedVideo=null;show("home");status("");
});

if (!firebaseConfigured) {
  $("status").textContent = "Setup needed: add your Firebase web app config in firebase.js, then enable Anonymous Authentication and Realtime Database.";
  $("status").style.color = "#fbbf24";
}