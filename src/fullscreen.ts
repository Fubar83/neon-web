// Full screen: F on a keyboard, or any element with a data-fs attribute (menu, pause, touch button).
// Browsers only allow it straight from a click / key / touch, so it's handled in those events, not in
// the game loop. On phones it also turns the screen sideways where the browser allows it. iPhones have
// no full-screen API for pages: there the game can be added to the home screen to run full screen.

type FsDoc = Document & { webkitFullscreenElement?: Element; webkitFullscreenEnabled?: boolean; webkitExitFullscreen?: () => void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };
const doc = document as FsDoc;

export const fullscreenSupported = !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
export const isFullscreen = () => !!(doc.fullscreenElement || doc.webkitFullscreenElement);

export function enterFullscreen() {
  if (!fullscreenSupported || isFullscreen()) return;
  const el = document.documentElement as FsEl;
  const done = () => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.("landscape").catch(() => {});
  if (el.requestFullscreen) el.requestFullscreen().then(done).catch(() => {});
  else el.webkitRequestFullscreen?.();
}

export function toggleFullscreen() {
  if (!isFullscreen()) { enterFullscreen(); return; }
  if (doc.exitFullscreen) doc.exitFullscreen().catch(() => {});
  else doc.webkitExitFullscreen?.();
}

/** Wires up the F key and every [data-fs] button, and keeps their labels in step. */
export function setupFullscreen() {
  const label = () => {
    document.querySelectorAll<HTMLElement>("[data-fs]").forEach((b) => {
      const show = fullscreenSupported ? "" : "none";
      if (b.style.display !== show) b.style.display = show;
      const t = b.dataset.fsIcon ? b.textContent : isFullscreen() ? "EXIT FULL SCREEN" : "FULL SCREEN";
      if (b.textContent !== t) b.textContent = t;
    });
  };
  window.addEventListener("keydown", (e) => { if (e.code === "KeyF" && !e.repeat) toggleFullscreen(); });
  document.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("[data-fs]")) toggleFullscreen(); });
  document.addEventListener("fullscreenchange", label);
  document.addEventListener("webkitfullscreenchange", label);
  // Panels are rebuilt often: label any new buttons as they appear.
  new MutationObserver(label).observe(document.body, { childList: true, subtree: true });
  label();
}
