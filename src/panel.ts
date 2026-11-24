// A side panel of rows of choices, driven by the arrow keys (Enter / Space picks) or the mouse.
// Used for the hangar (before a run) and the shop (in a run's pause). Its content is rebuilt on every
// render from a function, so it always shows the current state.

export interface PanelItem { name: string; desc: string; tag?: string; selected?: boolean; off?: boolean; swatch?: string; pick: () => boolean }
export interface PanelRow { title: string; focus?: string; items: PanelItem[] }
export interface PanelView { title: string; right: string; rows: PanelRow[]; note?: string; help: string }

export class Panel {
  private row = 0; private col = 0;

  constructor(private el: HTMLElement, private build: () => PanelView, private onFocus?: (focus: string | undefined) => void) {}

  reset() { this.row = 0; this.col = 0; }

  move(dr: number, dc: number) {
    const rows = this.build().rows;
    if (dr) this.row = (this.row + dr + rows.length) % rows.length;
    this.row = Math.min(this.row, rows.length - 1);
    const n = rows[this.row].items.length;
    this.col = dr ? Math.min(this.col, n - 1) : (this.col + dc + n) % n;
    this.onFocus?.(rows[this.row].focus);
    this.render();
  }

  /** Picks the item under the cursor (or the given one). False if it can't be picked (locked, too dear, ...). */
  pick(row = this.row, col = this.col): boolean {
    this.row = row; this.col = col;
    const it = this.build().rows[row]?.items[col];
    const ok = it ? it.pick() : false;
    this.render();
    return ok;
  }

  render() {
    const v = this.build();
    this.row = Math.min(this.row, v.rows.length - 1);
    this.col = Math.min(this.col, v.rows[this.row].items.length - 1);
    let html = `<div class="hhead"><div class="gtitle">${v.title}<span id="gcount">${v.right}</span></div><div class="hdesc"></div></div>`;
    v.rows.forEach((r, ri) => {
      html += `<div class="hrow"><div class="htitle">${r.title}</div>`;
      r.items.forEach((it, ci) => {
        const cls = ["hchip", it.selected ? "sel" : "", it.off ? "off" : "", ri === this.row && ci === this.col ? "cur" : ""].join(" ");
        const sw = it.swatch ? `<span class="hsw" style="background:${it.swatch}; box-shadow:0 0 8px ${it.swatch}"></span>` : "";
        html += `<span class="${cls}" data-r="${ri}" data-c="${ci}">${sw}${it.name}${it.tag ? ` <small>${it.tag}</small>` : ""}</span>`;
      });
      html += `</div>`;
    });
    if (v.note) html += `<div class="hnote">${v.note}</div>`;
    html += `<div class="ghelp">${v.help}</div>`;
    this.el.innerHTML = html;
    // Keep the cursor in view (scrolling only the panel).
    const cur = this.el.querySelector<HTMLElement>(".hchip.cur");
    if (cur) {
      const top = cur.offsetTop, bot = top + cur.offsetHeight, pad = 110;
      if (top < this.el.scrollTop + pad) this.el.scrollTop = top - pad;
      else if (bot > this.el.scrollTop + this.el.clientHeight - 40) this.el.scrollTop = bot - this.el.clientHeight + 40;
    }
    this.showDesc(v);
    this.el.querySelectorAll<HTMLElement>(".hchip").forEach((c) => {
      c.onclick = () => this.pick(Number(c.dataset.r), Number(c.dataset.c));
      c.onmouseenter = () => {
        this.row = Number(c.dataset.r); this.col = Number(c.dataset.c);
        const vv = this.build();
        this.onFocus?.(vv.rows[this.row].focus);
        this.showDesc(vv);
        this.el.querySelectorAll<HTMLElement>(".hchip").forEach((x) => x.classList.toggle("cur", Number(x.dataset.r) === this.row && Number(x.dataset.c) === this.col));
      };
    });
  }

  private showDesc(v: PanelView) {
    const it = v.rows[this.row]?.items[this.col];
    const d = this.el.querySelector(".hdesc");
    if (d && it) d.innerHTML = `<b>${it.name}</b>: ${it.desc}`;
  }
}
