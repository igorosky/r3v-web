import type { SceneElement, SceneState, Viewer } from '../index.js';

/** The viewer members the list uses. All are public, so an application can build the same UI. */
export type SceneListViewer = Pick<Viewer, 'onSceneChange' | 'onSceneError' | 'onStatus' | 'setVisibility' | 'focusCamera'>;

export interface SceneListTexts {
  /** Heading of the list, also its accessible name. */
  readonly title: string;
  /** Summary next to the heading; not shown for an empty scene. */
  readonly count: (visible: number, total: number) => string;
  /** Shown while the scene has no elements, e.g. before the first renderer snapshot. */
  readonly empty: string;
  /** Marks a request to show an element that awaits the renderer. */
  readonly showing: string;
  /** Marks a request to hide an element that awaits the renderer. */
  readonly hiding: string;
  /** Marks an element whose last request got no answer in time. */
  readonly timeout: string;
  /** Tooltip of the visibility switch of a hidden element. */
  readonly show: (label: string) => string;
  /** Tooltip of the visibility switch of a visible element. */
  readonly hide: (label: string) => string;
  /** Accessible name and tooltip of the camera button. */
  readonly focus: (label: string) => string;
}

export interface SceneListOptions {
  /** Replaces the default English texts. */
  texts?: Partial<SceneListTexts>;
}

const TEXTS: SceneListTexts = {
  title: 'Scene',
  count: (visible, total) => `${visible} of ${total} visible`,
  empty: 'No scene elements',
  showing: 'Showing…',
  hiding: 'Hiding…',
  timeout: 'No answer',
  show: (label) => `Show ${label}`,
  hide: (label) => `Hide ${label}`,
  focus: (label) => `Focus camera on ${label}`,
};

/** Icon outlines on a 24-unit grid, stroked with the text colour. */
const ICONS = {
  visible: [
    'M2 12c2.3-4.3 5.7-7 10-7s7.7 2.7 10 7c-2.3 4.3-5.7 7-10 7s-7.7-2.7-10-7Z',
    'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  ],
  // A closed eye.
  hidden: [
    'M2 10c2.3 3.7 5.7 6 10 6s7.7-2.3 10-6',
    'm4.7 13.3-1.6 2.3', 'm9.2 15.6-.6 2.7', 'm14.8 15.6.6 2.7', 'm19.3 13.3 1.6 2.3',
  ],
  // A viewfinder.
  focus: [
    'M4 8.5V6a2 2 0 0 1 2-2h2.5', 'M15.5 4H18a2 2 0 0 1 2 2v2.5',
    'M20 15.5V18a2 2 0 0 1-2 2h-2.5', 'M8.5 20H6a2 2 0 0 1-2-2v-2.5',
    'M14.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
  ],
};

/** Ids for accessible names, unique within the page. */
let lastId = 0;

interface Row {
  readonly element: HTMLLIElement;
  readonly toggle: HTMLButtonElement;
  readonly label: HTMLSpanElement;
  readonly status: HTMLSpanElement;
  readonly focus: HTMLButtonElement;
  readonly visibleIcon: SVGSVGElement;
  readonly hiddenIcon: SVGSVGElement;
}

/**
 * Optional UI: a panel listing the viewer's scene elements, each with a visibility switch and a
 * camera focus button. It only renders the viewer's state and turns input into viewer requests;
 * commands still reach the renderer through the application's `onCommand` listener.
 */
export class SceneList {
  readonly #viewer: SceneListViewer;
  readonly #texts: SceneListTexts;
  readonly #document: Document;
  readonly #root: HTMLDivElement;
  readonly #count: HTMLSpanElement;
  readonly #items: HTMLUListElement;
  readonly #empty: HTMLParagraphElement;
  readonly #rows = new Map<string, Row>();
  /** Elements whose last request timed out, until the next request for them. */
  readonly #timedOut = new Set<string>();
  readonly #unsubscribe: (() => void)[] = [];
  #elements: readonly SceneElement[] = [];
  #destroyed = false;

  /** Appends the list to `container`; the container's other content is left alone. */
  constructor(container: HTMLElement, viewer: SceneListViewer, options: SceneListOptions = {}) {
    this.#viewer = viewer;
    this.#texts = { ...TEXTS, ...options.texts };
    this.#document = container.ownerDocument;
    this.#root = this.#create('div', 'r3v-scene-list');
    const header = this.#create('div', 'r3v-scene-list__header');
    const title = this.#create('span', 'r3v-scene-list__title', this.#texts.title);
    title.id = `r3v-scene-list-${++lastId}`;
    this.#count = this.#create('span', 'r3v-scene-list__count');
    header.append(title, this.#count);
    this.#items = this.#create('ul', 'r3v-scene-list__items');
    this.#items.setAttribute('aria-labelledby', title.id);
    this.#empty = this.#create('p', 'r3v-scene-list__empty', this.#texts.empty);
    this.#root.append(header, this.#items, this.#empty);

    // A destroyed viewer throws here, before anything reaches the page.
    this.#unsubscribe.push(viewer.onSceneChange((scene) => this.#render(scene)));
    this.#unsubscribe.push(viewer.onSceneError(({ id }) => this.#timeout(id)));
    // Requests to a destroyed viewer throw, so its controls stop accepting input.
    this.#unsubscribe.push(viewer.onStatus(({ state }) => { if (state === 'destroyed') this.#disable(); }));
    container.append(this.#root);
  }

  /** Removes the list from the page and stops following the viewer. Safe to call repeatedly. */
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#unsubscribe.splice(0).forEach((unsubscribe) => unsubscribe());
    this.#root.remove();
  }

  #render({ elements }: SceneState): void {
    this.#elements = elements;
    const ids = new Set(elements.map(({ id }) => id));
    for (const [id, row] of this.#rows) {
      if (ids.has(id)) continue;
      row.element.remove();
      this.#rows.delete(id);
      this.#timedOut.delete(id);
    }
    // Rows already in place are not moved, which would drop keyboard focus.
    let next = this.#items.firstElementChild;
    for (const element of elements) {
      if (element.requested !== null) this.#timedOut.delete(element.id);
      const row = this.#rows.get(element.id) ?? this.#createRow(element.id);
      this.#update(row, element);
      if (row.element === next) next = next.nextElementSibling;
      else this.#items.insertBefore(row.element, next);
    }
    const visible = elements.filter((element) => element.visible).length;
    this.#count.textContent = elements.length ? this.#texts.count(visible, elements.length) : '';
    this.#empty.hidden = elements.length > 0;
  }

  #timeout(id: string): void {
    const element = this.#elements.find((item) => item.id === id);
    const row = this.#rows.get(id);
    if (!element || !row) return;
    this.#timedOut.add(id);
    this.#update(row, element);
  }

  #createRow(id: string): Row {
    const element = this.#create('li', 'r3v-scene-list__item');
    element.dataset.id = id;
    // A switch named by the element's label; it shows the renderer's value.
    const toggle = this.#create('button', 'r3v-scene-list__toggle');
    toggle.type = 'button';
    toggle.setAttribute('role', 'switch');
    const label = this.#create('span', 'r3v-scene-list__label');
    label.id = `r3v-scene-list-${++lastId}`;
    toggle.setAttribute('aria-labelledby', label.id);
    const status = this.#create('span', 'r3v-scene-list__status');
    status.setAttribute('aria-live', 'polite');
    const main = this.#create('span', 'r3v-scene-list__main');
    main.append(label, status);
    const focus = this.#create('button', 'r3v-scene-list__focus');
    focus.type = 'button';
    focus.append(this.#icon(ICONS.focus));
    element.append(toggle, main, focus);

    // Requests the opposite of what the renderer shows; while pending that resends the request.
    toggle.addEventListener('click', () => this.#viewer.setVisibility(id, toggle.getAttribute('aria-checked') !== 'true'));
    focus.addEventListener('click', () => this.#viewer.focusCamera(id));
    const row = { element, toggle, label, status, focus, visibleIcon: this.#icon(ICONS.visible), hiddenIcon: this.#icon(ICONS.hidden) };
    this.#rows.set(id, row);
    return row;
  }

  #update(row: Row, { id, label, visible, requested }: SceneElement): void {
    const timedOut = this.#timedOut.has(id);
    row.element.dataset.visible = String(visible);
    row.element.toggleAttribute('data-pending', requested !== null);
    row.element.toggleAttribute('data-timeout', timedOut);
    row.label.textContent = label;
    row.toggle.setAttribute('aria-checked', String(visible));
    row.toggle.title = visible ? this.#texts.hide(label) : this.#texts.show(label);
    const icon = visible ? row.visibleIcon : row.hiddenIcon;
    if (row.toggle.firstChild !== icon) row.toggle.replaceChildren(icon);
    const focus = this.#texts.focus(label);
    row.focus.setAttribute('aria-label', focus);
    row.focus.title = focus;
    const status = requested !== null
      ? requested ? this.#texts.showing : this.#texts.hiding
      : timedOut ? this.#texts.timeout : '';
    // Rewriting an unchanged live region could announce it again.
    if (row.status.textContent !== status) row.status.textContent = status;
  }

  #disable(): void {
    this.#root.toggleAttribute('data-disabled', true);
    for (const row of this.#rows.values()) row.toggle.disabled = row.focus.disabled = true;
  }

  #create<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
    const element = this.#document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  #icon(paths: readonly string[]): SVGSVGElement {
    const svg = this.#document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'r3v-scene-list__icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.75');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of paths) {
      const path = this.#document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    return svg;
  }
}
