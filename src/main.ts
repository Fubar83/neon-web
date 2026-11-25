// NEON in the browser: renderer + bloom, the level selector, the game loop, HUD, music and sound.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { setLineResolution } from "./neon";
import { NeonWorld } from "./world";
import { Game, LEVELS, HALF_H, UPGRADES, WEAPONS, type LevelDef } from "./game";
import { ADDONS, loadLoadout, saveLoadout, type Loadout } from "./loadout";
import { Panel } from "./panel";
import { hangarRows } from "./hangar";
import { shopRows } from "./shop";
import { Music } from "./music";
import { initAudio, ctx, setRoom, sfx, musicBus } from "./audio";
import { Input } from "./util";
import { TouchControls } from "./touch";
import { enterFullscreen, fullscreenSupported, setupFullscreen } from "./fullscreen";
import { GALLERY, GALLERY_LEVEL, GALLERY_NOTE } from "./gallery";

// --- Renderer: a fixed 16:9 frame, letterboxed, looking straight down at the play field ---
const frame = document.getElementById("frame")!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setClearColor(0x000000);
frame.prepend(renderer.domElement);
const scene = new THREE.Scene();
const FOV = 50;
const camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 10, 8000);
camera.position.set(0, 0, HALF_H / Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
camera.lookAt(0, 0, 0);
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(1280, 720), 0.85, 0.32, 0.45);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const fw = Math.min(w, (h * 16) / 9), fh = (fw * 9) / 16;
  frame.style.width = `${fw}px`; frame.style.height = `${fh}px`;
  renderer.setSize(fw, fh);
  composer.setSize(fw, fh);
  bloom.resolution.set(fw, fh);
  const pr = renderer.getPixelRatio();
  setLineResolution(fw * pr, fh * pr);
  frame.style.fontSize = `${fh / 720}em`;
}
window.addEventListener("resize", resize);

// --- State ---
const input = new Input();
const touch = new TouchControls(input);
if (touch.enabled) document.body.classList.add("touch");
// On-screen buttons in the menus and panels (BACK, NEXT, RESUME, ...) act as key taps.
document.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-key]");
  if (b?.dataset.key) input.tap(b.dataset.key);
});
let world: NeonWorld | null = null;
let game: Game | null = null;
let music: Music | null = null;
let musicMuted = localStorage.getItem("neon.muted") === "1";
let skill = Number(localStorage.getItem("neon.skill") ?? 1);
let menuIndex = Number(localStorage.getItem("neon.menu") ?? 1);
let inMenu = true;
let inGallery = false;
let inHangar = false;
let paused = false;
let galleryIndex = 0;
let endTimer = 0;

const $ = (id: string) => document.getElementById(id)!;
const menuEl = $("menu"), listEl = $("list");
// --- The set-up (hangar, before a run: hull, colour) and the shop (a run's pause: coins buy weapons,
// add-ons and their upgrades for that run) share one side panel ---
let loadout = loadLoadout();
function setLoadout(l: Loadout) {
  loadout = l;
  saveLoadout(l);
  if (game && inHangar) game.applyLoadout(l, false);
}
const hangar = new Panel($("hangar"), () => ({
  title: "HANGAR", right: "",
  rows: hangarRows(loadout, setLoadout),
  note: "Weapons, add-ons and their upgrades are bought during a run in the shop (P), with coins from destroyed enemies; they last for that run.",
  help: `<span class="tapk" data-key="Escape">BACK</span> <span class="tapk" data-fs>FULL SCREEN</span> &nbsp; ARROWS move &nbsp; ENTER / SPACE pick &nbsp; ESC back`,
}));
const shop = new Panel($("hangar"), () => ({
  title: "PAUSED - SHOP", right: "COINS " + (game?.coins ?? 0).toLocaleString("en-US"),
  rows: game ? shopRows(game) : [],
  note: "Bought for this run only. Coins drop from destroyed enemies; fly close to collect them.",
  help: `<span class="tapk" data-key="KeyP">RESUME</span> <span class="tapk" data-key="Escape">MENU</span> <span class="tapk" data-fs>FULL SCREEN</span> &nbsp; ARROWS move &nbsp; ENTER / SPACE buy &nbsp; P resume &nbsp; ESC menu`,
}));
const ROOMS: Record<string, [number, number]> = { Clockwork: [1.4, 0.8], Circuit: [0.6, 0.9], Synthwave: [2.2, 0.7] };

function setWorld(level: LevelDef) {
  if (world) { scene.remove(world.root); world.dispose(); }
  world = new NeonWorld(level.theme, level.seed);
  scene.add(world.root);
  setRoom(...ROOMS[level.theme]);
}

function playMusic(style: Parameters<typeof startMusic>[0], seed: number) { startMusic(style, seed); }
function startMusic(style: ConstructorParameters<typeof Music>[0], seed: number) {
  music?.stop();
  music = null;
  if (!ctx) return;
  music = new Music(style, seed);
  music.start();
  musicBus.gain.value = musicMuted ? 0 : 0.5;
}

function renderMenu() {
  listEl.innerHTML = "";
  let group = "";
  LEVELS.forEach((l, i) => {
    if (l.group !== group) { group = l.group; const g = document.createElement("div"); g.className = "group"; g.textContent = group; listEl.appendChild(g); }
    const d = document.createElement("div");
    d.className = "item" + (i === menuIndex ? " sel" : "");
    const b = best(l.id, skill);
    d.innerHTML = `${l.name.toUpperCase()}<span style="float:right; color:#7ab; margin-left:30px">${b > 0 ? "BEST " + pts(b) : ""}</span>`;
    d.onclick = () => { menuIndex = i; startLevel(); };
    d.onmouseenter = () => { if (menuIndex !== i) { menuIndex = i; renderMenu(); previewTheme(); } };
    listEl.appendChild(d);
  });
  // Extras: the hangar (loadout) and the gallery of enemies and the ship.
  const g = document.createElement("div"); g.className = "group"; g.textContent = "EXTRAS"; listEl.appendChild(g);
  ["HANGAR: SHIP SET-UP", "GALLERY: ENEMIES & SHIP"].forEach((name, k) => {
    const idx = LEVELS.length + k;
    const d = document.createElement("div");
    d.className = "item" + (menuIndex === idx ? " sel" : "");
    d.textContent = name;
    d.onclick = () => { menuIndex = idx; startLevel(); };
    d.onmouseenter = () => { if (menuIndex !== idx) { menuIndex = idx; renderMenu(); } };
    listEl.appendChild(d);
  });
  const names = ["EASY", "NORMAL", "HARD"], colors = ["#5f8", "#ffd860", "#f54"];
  const desc = ["5 lives - less damage - calmer waves", "3 lives - the intended challenge", "2 lives - more damage - faster, tougher waves"];
  $("skill").innerHTML = `<span class="tapk" data-key="ArrowLeft">&lt;</span>&nbsp;&nbsp; ${names[skill]} &nbsp;&nbsp;<span class="tapk" data-key="ArrowRight">&gt;</span>`;
  ($("skill") as HTMLElement).style.color = colors[skill];
  $("skilldesc").textContent = desc[skill];
}

// Best score per level and difficulty (the run is the same for everyone, so these compare).
const bestKey = (id: string, s: number) => `neon.bestscore.${id}.${s}`;
const pts = (n: number) => Math.floor(n).toLocaleString("en-US");
const best = (id: string, s: number) => Number(localStorage.getItem(bestKey(id, s)) ?? 0);
const fmt = (m: number) => Math.floor(m).toLocaleString("en-US") + " m";

let previewId = "";
function previewTheme() {
  const l = LEVELS[menuIndex];
  if (l && l.theme + l.seed !== previewId) { previewId = l.theme + l.seed; setWorld(l); }
}

function openMenu() {
  inMenu = true;
  inGallery = false;
  inHangar = false;
  paused = false;
  $("gallery").style.display = "none";
  $("hangar").style.display = "none";
  $("msg").style.right = "0";
  if (game) { scene.remove(game.root); game.dispose(); game = null; }
  menuEl.style.display = "flex";
  for (const id of ["score", "lives", "coins", "hull", "weapons", "cdbar", "upgrades", "level", "dist", "bossbar"]) $(id).style.visibility = "hidden";
  renderMenu();
  previewId = "";
  previewTheme();
  playMusic("Menu", 7);
  if (music) music.energy = 0.2;
}

function startLevel() {
  if (menuIndex === LEVELS.length) { openHangar(); return; }
  if (menuIndex > LEVELS.length) { openGallery(); return; }
  initAudio();
  ctx?.resume();
  const l = LEVELS[menuIndex];
  localStorage.setItem("neon.menu", String(menuIndex));
  sfx("menuSelect");
  inMenu = false;
  inGallery = false;
  inHangar = false;
  paused = false;
  $("gallery").style.display = "none";
  $("hangar").style.display = "none";
  $("msg").style.right = "0";
  menuEl.style.display = "none";
  for (const id of ["score", "lives", "coins", "hull", "weapons", "cdbar", "upgrades", "level", "dist"]) $(id).style.visibility = "visible";
  saved = false;
  previewId = "";
  setWorld(l);
  if (game) { scene.remove(game.root); game.dispose(); }
  loadout = loadLoadout();
  game = new Game(l, skill, loadout);
  scene.add(game.root);
  playMusic(l.music, l.seed);
  // Phones: go full screen (and sideways, where the browser allows it) when a level is tapped.
  if (touch.enabled) enterFullscreen();
  endTimer = 0;
}

// --- Hangar: the loadout panel on the right, the ship flying it on the left ---
function openHangar() {
  initAudio();
  ctx?.resume();
  sfx("menuSelect");
  inMenu = false;
  inHangar = true;
  menuEl.style.display = "none";
  for (const id of ["score", "lives", "coins", "hull", "weapons", "cdbar", "upgrades", "level", "dist", "bossbar"]) $(id).style.visibility = "hidden";
  $("msg").style.right = "38%";
  previewId = "";
  setWorld(GALLERY_LEVEL);
  if (game) { scene.remove(game.root); game.dispose(); }
  loadout = loadLoadout();
  game = new Game(GALLERY_LEVEL, 1, loadout);
  game.setDemo("hangar");
  game.applyLoadout(loadout, false);
  scene.add(game.root);
  $("hangar").style.display = "block";
  hangar.reset();
  hangar.render();
}

/** Pause a run: the shop comes up. */
function setPaused(on: boolean) {
  paused = on;
  $("hangar").style.display = on ? "block" : "none";
  if (on) shop.render();
  sfx("menuMove");
}

/** Arrow keys and Enter / Space in the side panel (hangar or shop). */
function hangarKeys() {
  const p = inHangar ? hangar : shop;
  if (input.hit("ArrowUp", "KeyW")) p.move(-1, 0);
  if (input.hit("ArrowDown", "KeyS")) p.move(1, 0);
  if (input.hit("ArrowLeft", "KeyA")) p.move(0, -1);
  if (input.hit("ArrowRight", "KeyD")) p.move(0, 1);
  if (input.hit("Enter", "NumpadEnter", "Space")) { if (p.pick()) sfx("menuMove"); else sfx("hurt", 0, 0.3); }
}

// --- Gallery: one entry at a time, shown live on the left, described in the panel on the right ---
function openGallery() {
  initAudio();
  ctx?.resume();
  sfx("menuSelect");
  inMenu = false;
  inGallery = true;
  menuEl.style.display = "none";
  $("gallery").style.display = "block";
  for (const id of ["score", "lives", "coins", "hull", "weapons", "cdbar", "upgrades", "level", "dist", "bossbar"]) $(id).style.visibility = "hidden";
  $("msg").style.right = "31%";
  previewId = "";
  setWorld(GALLERY_LEVEL);
  if (game) { scene.remove(game.root); game.dispose(); }
  game = new Game(GALLERY_LEVEL, 1);
  scene.add(game.root);
  showEntry(galleryIndex);
}

function showEntry(i: number) {
  galleryIndex = (i + GALLERY.length) % GALLERY.length;
  const e = GALLERY[galleryIndex];
  game?.setDemo(e.kind);
  const tabs = $("gtabs");
  tabs.innerHTML = "";
  GALLERY.forEach((t, j) => {
    const c = document.createElement("span");
    c.className = "gtab" + (j === galleryIndex ? " sel" : "");
    c.textContent = t.name.replace("Mini-Boss: ", "");
    c.style.color = t.color;
    c.onclick = () => { sfx("menuMove"); showEntry(j); };
    tabs.appendChild(c);
  });
  $("gname").textContent = e.name.toUpperCase();
  ($("gname") as HTMLElement).style.color = e.color;
  ($("gname") as HTMLElement).style.textShadow = `0 0 12px ${e.color}`;
  $("gcount").textContent = `${galleryIndex + 1} / ${GALLERY.length}`;
  $("gstats").innerHTML = e.stats.map(([k, v]) => `<div><span>${k}</span>${v}</div>`).join("");
  $("gabil").innerHTML = e.abilities.map((a) => `<li>${a}</li>`).join("");
  $("gnote").textContent = ["ship", "weapons", "fortress", "dreadnought"].includes(e.kind) ? "" : GALLERY_NOTE;
}

// --- HUD ---
let shownMsg = "";
let saved = false;
function updateHud() {
  if (!game) return;
  $("score").textContent = "SCORE " + pts(game.score);
  $("lives").textContent = game.level.gentle?.endless ? "LIVES  ∞" : "LIVES  " + "▲ ".repeat(Math.max(0, game.lives));
  const hp = game.hull / game.maxHull;
  ($("hullfill") as HTMLElement).style.width = `${Math.max(0, hp) * 100}%`;
  ($("hullfill") as HTMLElement).style.background = hp > 0.35 ? "#5df" : "#f54";
  $("coins").textContent = `COINS ${pts(game.coins)}   (P SHOP)`;
  const sec = game.secondary;
  const cd = game.secCool > 0 ? game.secCool.toFixed(1) + "s" : "READY";
  const adds = game.addons.map((a) => ADDONS[a].name).join(" + ");
  $("weapons").textContent = `${game.primaries.map((p) => WEAPONS[p].name).join(" + ")} LV ${game.weapon}   |   ` + (sec ? `${WEAPONS[sec].name} ${cd}` : "NO SECONDARY") + (adds ? `   |   ${adds}` : "");
  $("cdbar").style.visibility = sec ? "visible" : "hidden";
  if (sec) {
    ($("cdfill") as HTMLElement).style.width = `${Math.max(0, 1 - game.secCool / game.cooldown(sec)) * 100}%`;
    ($("cdfill") as HTMLElement).style.background = game.secCool > 0 ? "#a85" : "#ffd860";
  }
  $("upgrades").textContent = `FIRE x${game.fireRate.toFixed(2)}   DMG x${game.damage.toFixed(2)}` + (game.shieldHits > 0 ? `   SHIELD x${game.shieldHits}` : "");
  // The run: score (the result), the next bonus, the record; the bar shows the way to the finish line.
  const b = best(game.level.id, skill);
  const mins = Math.floor(game.runTime / 60), secs = Math.floor(game.runTime % 60);
  $("disttext").textContent = `NEXT BONUS ${pts(game.nextBonus)}: ${UPGRADES[game.nextUpgrade].name}     DANGER ${game.minute + 1}     ${mins}:${String(secs).padStart(2, "0")}     ${fmt(game.dist)} / ${fmt(game.level.finish)}` + (b > 0 ? `     BEST ${pts(b)}` : "");
  ($("distfill") as HTMLElement).style.width = `${game.progress * 100}%`;
  ($("distbest") as HTMLElement).style.display = "none";
  // Mini-boss health.
  $("bossbar").style.visibility = game.boss ? "visible" : "hidden";
  if (game.boss) { $("bossname").textContent = game.boss.name; ($("bossfill") as HTMLElement).style.width = `${game.bossHealth * 100}%`; }
  // Save the record when the run ends.
  if ((game.done || game.over) && !saved) {
    saved = true;
    if (game.score > b) { localStorage.setItem(bestKey(game.level.id, skill), String(game.score)); game.message += "   NEW BEST!"; game.messageT = 7; }
  }
  $("level").textContent = touch.enabled
    ? (game.tunnel ? `TUNNEL RUN   ${Math.round(game.tunnel.progress * 100)}%` : game.level.name.replace(/^\d+\s+/, "").toUpperCase())
    : game.tunnel
    ? `TUNNEL RUN   ${Math.round(game.tunnel.speed * 0.036)} km/h   ${Math.round(game.tunnel.progress * 100)}%   (LEFT / RIGHT steer, SHIFT brake)`
    : `${game.level.name.replace(/^\d+\s+/, "").toUpperCase()}   ${["EASY", "NORMAL", "HARD"][skill]}   (auto-fire, SPACE secondary, SHIFT precise, P shop, F full screen, ESC menu, M music, H hit boxes)`;
  const msg = game.messageT > 0 ? game.message : "";
  if (msg !== shownMsg) { shownMsg = msg; $("msg").textContent = msg; }
  ($("msg") as HTMLElement).style.opacity = game.messageT > 0 ? "1" : "0";
}

// --- Loop ---
let lastT = performance.now();
function frameLoop(now: number) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  tick(dt);
  input.endFrame();
  requestAnimationFrame(frameLoop);
}

/** One frame: input, menus or the game, HUD, touch controls, drawing. */
function tick(dt: number) {

  if (input.hit("KeyM")) {
    musicMuted = !musicMuted;
    localStorage.setItem("neon.muted", musicMuted ? "1" : "0");
    if (ctx) musicBus.gain.value = musicMuted ? 0 : 0.5;
  }
  if (inHangar && game) {
    if (input.hit("Escape", "Backspace")) { sfx("menuMove"); openMenu(); return; }
    hangarKeys();
    game.update(dt, input);
    world?.update(dt, 120);
    updateGalleryMsg();
  } else if (inGallery && game) {
    if (input.hit("Escape", "Backspace")) { sfx("menuMove"); openMenu(); return; }
    if (input.hit("ArrowRight", "KeyD", "ArrowDown", "KeyS")) { sfx("menuMove"); showEntry(galleryIndex + 1); }
    if (input.hit("ArrowLeft", "KeyA", "ArrowUp", "KeyW")) { sfx("menuMove"); showEntry(galleryIndex - 1); }
    if (input.hit("KeyH")) game.showHits = !game.showHits;
    game.update(dt, input);
    world?.update(dt, 120);
    updateGalleryMsg();
  } else if (inMenu) {
    const n = LEVELS.length + 2;
    if (input.hit("ArrowUp", "KeyW")) { menuIndex = (menuIndex + n - 1) % n; sfx("menuMove"); renderMenu(); previewTheme(); }
    if (input.hit("ArrowDown", "KeyS")) { menuIndex = (menuIndex + 1) % n; sfx("menuMove"); renderMenu(); previewTheme(); }
    if (input.hit("ArrowLeft", "KeyA")) { skill = Math.max(0, skill - 1); localStorage.setItem("neon.skill", String(skill)); sfx("menuMove"); renderMenu(); }
    if (input.hit("ArrowRight", "KeyD")) { skill = Math.min(2, skill + 1); localStorage.setItem("neon.skill", String(skill)); sfx("menuMove"); renderMenu(); }
    if (input.hit("Enter", "KeyJ", "NumpadEnter")) startLevel();
    world?.update(dt, 120);
  } else if (game) {
    if (input.hit("Escape")) { openMenu(); return; }
    if (input.hit("KeyP", "Tab") && !game.tunnel && !game.done && !game.over) setPaused(!paused);
    if (paused) { hangarKeys(); updateHud(); touch.update("hidden", null, 0); render(); return; }
    if (input.hit("KeyH")) game.showHits = !game.showHits;
    game.update(dt, input);
    if (!game.tunnel && !game.done && !game.over) world?.update(dt, game.level.speed * 10);
    if (music) {
      music.energy = game.over ? 0.25 : game.tunnel ? 1 : game.bigFight ? 0.95 : 0.55 + 0.25 * Math.min(game.difficulty, 1);
      music.tempoBoost = game.bigFight ? 0.1 : game.tunnel ? 0.06 : 0;
    }
    updateHud();
    if (game.done || game.over) { endTimer += dt; if (endTimer > 7) openMenu(); }
  }
  // Touch controls: shown while playing (steer + brake in tunnels), hidden in menus and the pause.
  const playing = !!game && !inMenu && !inGallery && !inHangar && !paused && !game.done && !game.over;
  const sec = game?.secondary ?? null;
  touch.update(!playing ? "hidden" : game!.tunnel ? "tunnel" : "play", sec ? WEAPONS[sec].name.replace(" CANNON", "") : null, sec && game ? 1 - game.secCool / game.cooldown(sec) : 0);
  render();
}

function updateGalleryMsg() {
  const msg = game && game.messageT > 0 ? game.message : "";
  if (msg !== shownMsg) { shownMsg = msg; $("msg").textContent = msg; }
  ($("msg") as HTMLElement).style.opacity = msg ? "1" : "0";
}

/** The tunnel's gap radar, drawn over the view while diving. */
const radar = document.createElement("canvas");
radar.id = "radar";
frame.appendChild(radar);
const radarCtx = radar.getContext("2d")!;

/** Draws the play field, or the tunnel when diving; a white flash on the way in and out. */
function render() {
  const t = game?.tunnel;
  radar.style.display = t ? "block" : "none";
  if (t) {
    const w = frame.clientWidth, h = frame.clientHeight;
    if (radar.width !== w || radar.height !== h) { radar.width = w; radar.height = h; }
    t.drawRadar(radarCtx, w, h);
  }
  if (game?.tunnel) { renderPass.scene = game.tunnel.scene; renderPass.camera = game.tunnel.camera; }
  else { renderPass.scene = scene; renderPass.camera = camera; }
  ($("flash") as HTMLElement).style.opacity = String(game ? game.flash * 0.8 : 0);
  composer.render();
}

/** For tests: run the game for some seconds at 60 steps a second, steering left and right and firing, then draw once. */
function simulate(seconds: number) {
  if (!game) return;
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    const t = game.runTime;
    const fake = { move: () => ({ x: Math.sin(t * 1.3), y: game!.debugShipY() > -280 ? -1 : 0 }), fire: () => true, fire2: () => true, down: () => false, hit: () => false, endFrame: () => {} } as unknown as Input;
    game.update(1 / 60, fake);
    if (!game.tunnel) world?.update(1 / 60, game.level.speed * 10);
  }
  updateHud();
  render();
}

// Audio needs a gesture first: the first key press or click starts it (and the menu music).
const unlock = () => {
  if (ctx) return;
  initAudio();
  ctx!.resume();
  if (inMenu) { playMusic("Menu", 7); if (music) music.energy = 0.2; }
};
window.addEventListener("keydown", unlock);
window.addEventListener("pointerdown", unlock);

setupFullscreen();
if (touch.enabled && !fullscreenSupported) $("fshint").textContent = "Full screen on iPhone: Share, then Add to Home Screen, and start NEON from there.";
resize();
openMenu();
requestAnimationFrame(frameLoop);

// For automated checks: window.neon exposes a little state.
(window as unknown as { neon: unknown }).neon = {
  get game() { return game; }, get inMenu() { return inMenu; }, startLevel: (i: number) => { menuIndex = i; startLevel(); }, simulate,
  gallery: (i: number) => { galleryIndex = i; openGallery(); },
  hangar: () => { menuIndex = LEVELS.length; startLevel(); },
  get loadout() { return loadout; },
  shop: () => shop, hangarPanel: () => hangar,
  get paused() { return paused; },
  /** For tests: what P does in a run. */
  togglePause: () => { if (game && !inMenu && !inGallery && !inHangar) setPaused(!paused); },
  /** For tests: one frame with the real keyboard input. */
  /** For tests: one whole frame (menus too) with the real input. */
  tick: (dt = 1 / 60) => { tick(dt); input.endFrame(); },
  step: () => { game?.update(1 / 60, input); input.endFrame(); if (!inGallery) updateHud(); },
  /** For tests: run the gallery demo for some seconds, then draw once. */
  galleryRun: (seconds: number) => { for (let i = 0; i < Math.round(seconds * 60); i++) game?.update(1 / 60, input); updateGalleryMsg(); render(); },
};
