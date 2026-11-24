// NEON in the browser: renderer + bloom, the level selector, the game loop, HUD, music and sound.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { setLineResolution } from "./neon";
import { NeonWorld } from "./world";
import { Game, LEVELS, HALF_H, UPGRADES, type LevelDef } from "./game";
import { Music } from "./music";
import { initAudio, ctx, setRoom, sfx, musicBus } from "./audio";
import { Input } from "./util";

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
let world: NeonWorld | null = null;
let game: Game | null = null;
let music: Music | null = null;
let musicMuted = localStorage.getItem("neon.muted") === "1";
let skill = Number(localStorage.getItem("neon.skill") ?? 1);
let menuIndex = Number(localStorage.getItem("neon.menu") ?? 1);
let inMenu = true;
let endTimer = 0;

const $ = (id: string) => document.getElementById(id)!;
const menuEl = $("menu"), listEl = $("list");
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
  const names = ["EASY", "NORMAL", "HARD"], colors = ["#5f8", "#ffd860", "#f54"];
  const desc = ["5 lives - less damage - calmer waves", "3 lives - the intended challenge", "2 lives - more damage - faster, tougher waves"];
  $("skill").innerHTML = `&lt;&nbsp;&nbsp; ${names[skill]} &nbsp;&nbsp;&gt;`;
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
  if (l.theme + l.seed !== previewId) { previewId = l.theme + l.seed; setWorld(l); }
}

function openMenu() {
  inMenu = true;
  if (game) { scene.remove(game.root); game.dispose(); game = null; }
  menuEl.style.display = "flex";
  for (const id of ["score", "lives", "hull", "weapons", "level", "dist", "bossbar"]) $(id).style.visibility = "hidden";
  for (const el of offerLabels) el.style.display = "none";
  renderMenu();
  previewId = "";
  previewTheme();
  playMusic("Menu", 7);
  if (music) music.energy = 0.2;
}

function startLevel() {
  initAudio();
  ctx?.resume();
  const l = LEVELS[menuIndex];
  localStorage.setItem("neon.menu", String(menuIndex));
  sfx("menuSelect");
  inMenu = false;
  menuEl.style.display = "none";
  for (const id of ["score", "lives", "hull", "weapons", "level", "dist"]) $(id).style.visibility = "visible";
  saved = false;
  previewId = "";
  setWorld(l);
  if (game) { scene.remove(game.root); game.dispose(); }
  game = new Game(l, skill);
  scene.add(game.root);
  playMusic(l.music, l.seed);
  endTimer = 0;
}

// --- HUD ---
let shownMsg = "";
let saved = false;
const offerLabels = [0, 1, 2].map(() => { const d = document.createElement("div"); d.className = "hud offer"; frame.appendChild(d); return d; });
const v = new THREE.Vector3();
function updateHud() {
  if (!game) return;
  $("score").textContent = "SCORE " + pts(game.score);
  $("lives").textContent = game.level.gentle?.endless ? "LIVES  ∞" : "LIVES  " + "▲ ".repeat(Math.max(0, game.lives));
  ($("hullfill") as HTMLElement).style.width = `${Math.max(0, game.hull)}%`;
  ($("hullfill") as HTMLElement).style.background = game.hull > 35 ? "#5df" : "#f54";
  $("weapons").textContent = `GUNS ${game.weapon}   FIRE x${game.fireRate.toFixed(2)}   DMG x${game.damage.toFixed(2)}` + (game.shieldHits > 0 ? `   SHIELD x${game.shieldHits}` : "");
  // The run: score (the result), the next bonus, the record; the bar shows the way to the finish line.
  const b = best(game.level.id, skill);
  const mins = Math.floor(game.runTime / 60), secs = Math.floor(game.runTime % 60);
  $("disttext").textContent = `NEXT BONUS ${pts(game.nextBonus)}     DANGER ${game.minute + 1}     ${mins}:${String(secs).padStart(2, "0")}     ${fmt(game.dist)} / ${fmt(game.level.finish)}` + (b > 0 ? `     BEST ${pts(b)}` : "");
  ($("distfill") as HTMLElement).style.width = `${game.progress * 100}%`;
  ($("distbest") as HTMLElement).style.display = "none";
  // Mini-boss health.
  $("bossbar").style.visibility = game.boss ? "visible" : "hidden";
  if (game.boss) { $("bossname").textContent = game.boss.name; ($("bossfill") as HTMLElement).style.width = `${game.bossHealth * 100}%`; }
  // Upgrade labels under their pods.
  offerLabels.forEach((el, i) => {
    const p = game!.pods[i];
    if (!p || game!.tunnel) { el.style.display = "none"; return; }
    v.set(p.x, p.y - 62, 0).project(camera);
    el.style.display = "block";
    el.style.left = `${(v.x * 0.5 + 0.5) * 100}%`;
    el.style.top = `${(-v.y * 0.5 + 0.5) * 100}%`;
    el.textContent = UPGRADES[p.kind].name;
    el.style.color = "#" + UPGRADES[p.kind].color.toString(16).padStart(6, "0");
  });
  // Save the record when the run ends.
  if ((game.done || game.over) && !saved) {
    saved = true;
    if (game.score > b) { localStorage.setItem(bestKey(game.level.id, skill), String(game.score)); game.message += "   NEW BEST!"; game.messageT = 7; }
  }
  $("level").textContent = game.tunnel
    ? `TUNNEL RUN   ${Math.round(game.tunnel.speed * 0.036)} km/h   ${Math.round(game.tunnel.progress * 100)}%   (LEFT / RIGHT steer, SPACE boost, SHIFT brake)`
    : `${game.level.name.replace(/^\d+\s+/, "").toUpperCase()}   ${["EASY", "NORMAL", "HARD"][skill]}   (ESC menu, M music, H hit boxes)`;
  const msg = game.messageT > 0 ? game.message : "";
  if (msg !== shownMsg) { shownMsg = msg; $("msg").textContent = msg; }
  ($("msg") as HTMLElement).style.opacity = game.messageT > 0 ? "1" : "0";
}

// --- Loop ---
let lastT = performance.now();
function frameLoop(now: number) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  if (input.hit("KeyM")) {
    musicMuted = !musicMuted;
    localStorage.setItem("neon.muted", musicMuted ? "1" : "0");
    if (ctx) musicBus.gain.value = musicMuted ? 0 : 0.5;
  }
  if (inMenu) {
    const n = LEVELS.length;
    if (input.hit("ArrowUp", "KeyW")) { menuIndex = (menuIndex + n - 1) % n; sfx("menuMove"); renderMenu(); previewTheme(); }
    if (input.hit("ArrowDown", "KeyS")) { menuIndex = (menuIndex + 1) % n; sfx("menuMove"); renderMenu(); previewTheme(); }
    if (input.hit("ArrowLeft", "KeyA")) { skill = Math.max(0, skill - 1); localStorage.setItem("neon.skill", String(skill)); sfx("menuMove"); renderMenu(); }
    if (input.hit("ArrowRight", "KeyD")) { skill = Math.min(2, skill + 1); localStorage.setItem("neon.skill", String(skill)); sfx("menuMove"); renderMenu(); }
    if (input.hit("Enter", "KeyJ", "NumpadEnter")) startLevel();
    world?.update(dt, 120);
  } else if (game) {
    if (input.hit("Escape")) { openMenu(); input.endFrame(); requestAnimationFrame(frameLoop); return; }
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
  render();
  input.endFrame();
  requestAnimationFrame(frameLoop);
}

/** Draws the play field, or the tunnel when diving; a white flash on the way in and out. */
function render() {
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
    const fake = { move: () => ({ x: Math.sin(t * 1.3), y: game!.debugShipY() > -280 ? -1 : 0 }), fire: () => true, down: () => false, hit: () => false, endFrame: () => {} } as unknown as Input;
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

resize();
openMenu();
requestAnimationFrame(frameLoop);

// For automated checks: window.neon exposes a little state.
(window as unknown as { neon: unknown }).neon = { get game() { return game; }, get inMenu() { return inMenu; }, startLevel: (i: number) => { menuIndex = i; startLevel(); }, simulate };
