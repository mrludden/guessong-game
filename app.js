import { auth, db, firebaseConfigured, signInGuest } from "./firebase.js";
import { ref, set, get, update, onValue, onDisconnect, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";

const $ = id => document.getElementById(id);
let currentRoom = null;
let isHost = false;
let stopRoomListener = null;
let playerId = null;
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
async function requireFirebase() {
  if (!firebaseConfigured) throw new Error("Add your Firebase web app settings in firebase.js first.");
  if (!auth.currentUser) await signInGuest();
  playerId = auth.currentUser.uid;
}
function watchRoom() {
  if (stopRoomListener) stopRoomListener();
  stopRoomListener = onValue(ref(db, `rooms/${currentRoom}`), snapshot => {
    const room = snapshot.val();
    if (!room) { status("This room no longer exists.", true); show("home"); return; }
    $("room-title").textContent = room.game?.phase === "lobby" ? "Waiting room" : "Game room";
    $("room-code-display").textContent = currentRoom;
    const players = Object.entries(room.players || {});
    $("player-count").textContent = `${players.length} / ${MAX_PLAYERS}`;
    $("players").innerHTML = "";
    for (const [uid, player] of players) {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = player.name || "Player";
      const label = document.createElement("span");
      label.className = "host-label";
      label.textContent = uid === room.hostId ? "HOST" : "";
      li.append(name,label); $("players").append(li);
    }
    const hostView = isHost && room.game?.phase === "lobby";
    $("host-settings").classList.toggle("hidden", !hostView);
    $("player-waiting").classList.toggle("hidden", isHost || room.game?.phase !== "lobby");
    if (hostView) {
      $("topic").value = room.settings?.topic || "";
      $("clip-length").value = String(room.settings?.clipLength || 10);
      $("guess-time").value = String(room.settings?.guessTime || 45);
    }
    if (room.game?.phase !== "lobby") status("Game setup is saved. Song selection and synchronized playback are the next build stage.");
  });
}
async function createRoom() {
  await requireFirebase();
  const name = cleanName($("host-name").value);
  if (!name) throw new Error("Enter a nickname.");
  let code, existing;
  do { code = makeCode(); existing = await get(ref(db, `rooms/${code}`)); } while (existing.exists());
  const room = {
    hostId: playerId,
    createdAt: serverTimestamp(),
    settings: {topic:"", clipLength:10, guessTime:45},
    game: {phase:"lobby", round:0},
    players: {[playerId]: {name, joinedAt:serverTimestamp(), connected:true}}
  };
  await set(ref(db, `rooms/${code}`), room);
  currentRoom = code; isHost = true;
  await onDisconnect(ref(db, `rooms/${code}/players/${playerId}/connected`)).set(false);
  show("room"); watchRoom(); status("Room created. Share the code with your players.");
}
async function joinRoom() {
  await requireFirebase();
  const name = cleanName($("join-name").value);
  const code = $("room-code").value.trim().toUpperCase();
  if (!name) throw new Error("Enter a nickname.");
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw new Error("Enter a valid six-character room code.");
  const roomRef = ref(db, `rooms/${code}`);
  const snapshot = await get(roomRef);
  if (!snapshot.exists()) throw new Error("Room not found. Check the code.");
  const room = snapshot.val();
  const players = Object.keys(room.players || {});
  if (!room.players?.[playerId] && players.length >= MAX_PLAYERS) throw new Error("This room is full (15 players maximum).");
  if (room.game?.phase !== "lobby" && !room.players?.[playerId]) throw new Error("This game has already started.");
  await set(ref(db, `rooms/${code}/players/${playerId}`), {name, joinedAt:serverTimestamp(), connected:true});
  await onDisconnect(ref(db, `rooms/${code}/players/${playerId}/connected`)).set(false);
  currentRoom = code; isHost = room.hostId === playerId;
  show("room"); watchRoom(); status("You're in. Waiting for the host.");
}
async function saveSettings() {
  const topic = $("topic").value.trim();
  if (!topic) throw new Error("Choose a topic before starting.");
  await update(ref(db, `rooms/${currentRoom}/settings`), {
    topic, clipLength:Number($("clip-length").value), guessTime:Number($("guess-time").value)
  });
  status("Game settings saved.");
}
async function startGame() {
  await saveSettings();
  await update(ref(db, `rooms/${currentRoom}/game`), {phase:"song-selection", round:1, startedAt:serverTimestamp()});
  status("Game started. Song selection is the next feature to add.");
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
$("copy-code").addEventListener("click", async () => {if(currentRoom){await navigator.clipboard.writeText(currentRoom);status("Room code copied.");}});
$("leave-room").addEventListener("click", async () => {
  if (stopRoomListener) stopRoomListener();
  if (currentRoom && playerId) await update(ref(db, `rooms/${currentRoom}/players/${playerId}`), {connected:false});
  currentRoom=null;isHost=false;show("home");status("");
});

if (!firebaseConfigured) {
  $("status").textContent = "Setup needed: add your Firebase web app config in firebase.js, then enable Anonymous Authentication and Realtime Database.";
  $("status").style.color = "#fbbf24";
}
