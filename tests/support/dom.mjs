// Lightweight DOM/Clipboard harness for view event handlers. Not a layout/browser test.
export class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.value = ''; this.textContent = ''; this.style = {}; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute(k, v) { this.attributes[k] = v; }
  scrollIntoView() {}
  focus() { this.focused = true; }
  select() { this.selected = true; }
  *walk() { yield this; for (const c of this.children) if (c instanceof Element) yield* c.walk(); }
}
export function harness(project) {
  const main = new Element('main'), copied = [], downloads = [], notices = [];
  const original = new Map(['document', 'navigator', 'confirm', 'location'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const set = (k, value) => Object.defineProperty(globalThis, k, { configurable: true, writable: true, value });
  set('document', { createElement: tag => new Element(tag), createTextNode: s => s });
  set('navigator', { clipboard: { async writeText(text) { copied.push(text); } } });
  set('confirm', () => true);
  set('location', { hash: '' });
  let saves = 0;
  const ui = {
    main, project, copied, downloads, notices,
    heading(a, title, desc) { main.replaceChildren(); const h = new Element('h1'); h.textContent = title; main.append(h); },
    row(parent = main) { const r = new Element('div'); parent.append(r); return r; },
    button(text, fn, cls = '') { const b = new Element('button'); b.textContent = text; b.className = cls; b.onclick = fn; return b; },
    field(parent, title, type, value, fn, attrs = {}) {
      const label = new Element('label'); label.textContent = title;
      const el = new Element(type === 'textarea' ? 'textarea' : 'input'); el.type = type; el.value = value; Object.assign(el, attrs);
      el.oninput = () => fn(el.value); label.append(el); parent.append(label); return el;
    },
    autosave() { saves++; }, async save() { saves++; }, notice(text) { notices.push(text); },
    download(blob, name) { downloads.push({ blob, name }); },
    findButton(text) { return [...main.walk()].find(el => el.tagName === 'button' && el.textContent === text); },
    fieldFor(text) { return [...main.walk()].find(el => el.tagName === 'label' && el.textContent === text)?.children.find(el => el instanceof Element && ['input', 'textarea', 'select'].includes(el.tagName)); },
    all(tag) { return [...main.walk()].filter(el => el.tagName === tag); },
    saves: () => saves,
    close() { for (const [k, desc] of original) { if (desc) Object.defineProperty(globalThis, k, desc); else delete globalThis[k]; } }
  };
  return ui;
}
