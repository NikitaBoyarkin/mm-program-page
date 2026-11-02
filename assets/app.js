/* Программа Матемаркетинг 2026 — статическая копия: табы дней, чипы треков,
   сетка «время × залы», карточки, модалка, избранное, экспорт .ics.
   Обычный script без зависимостей (работает из file://).
   Отладочные query-параметры: ?day=<id|дата|номер>&track=<название|id>. */
(function () {
  'use strict';

  const FAV_KEY = 'mm-program:favorites';
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const STAR = 'M12 3.1l2.72 5.51 6.08.88-4.4 4.29 1.04 6.06L12 16.98l-5.44 2.86 1.04-6.06-4.4-4.29 6.08-.88z';

  const pick = (sel) => document.querySelector(sel);
  const refs = {
    tabs: pick('[data-tabs]'), tracks: pick('[data-tracks]'), count: pick('[data-viewers-count]'),
    label: pick('[data-viewers-label]'), header: pick('[data-grid-header]'), grid: pick('[data-grid]'),
    root: pick('[data-grid-root]'), empty: pick('[data-empty]'), sidebar: pick('[data-sidebar]'),
    exportIcs: pick('[data-export-ics]'), favCount: pick('[data-favorites-count]'), modal: pick('[data-modal]'),
    backdrop: pick('[data-modal-backdrop]'), dialog: pick('[data-modal-dialog]'), close: pick('[data-modal-close]'),
    media: pick('[data-modal-media]'), meta: pick('[data-modal-meta]'), title: pick('[data-modal-title]'),
    speakers: pick('[data-modal-speakers]'), text: pick('[data-modal-text]'), modalFav: pick('[data-modal-fav]'),
  };
  if (!refs.grid || !refs.tabs || !refs.tracks) return;

  const state = { dayId: null, track: null, talks: [], halls: [] };
  let badIds = [], warned = false, modalTalk = null, opener = null;
  let backdrop = null, savedOverflow = '', sidebarOpen = false;

  /* ── Помощники ────────────────────────────────────────────────── */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null && text !== '') node.textContent = text;
    return node;
  }

  // Внешние картинки приходят из чужого API: пропускаем только https,
  // чтобы поле из payload не превратилось в beacon на произвольный хост.
  function safeUrl(value) {
    if (typeof value !== 'string' || !value) return '';
    try {
      const url = new URL(value, window.location.href);
      return url.protocol === 'https:' ? url.href : '';
    } catch (error) {
      return '';
    }
  }

  function program() {
    return window.MM_PROGRAM && typeof window.MM_PROGRAM === 'object' ? window.MM_PROGRAM : {};
  }

  function days() {
    const list = program().days;
    return Array.isArray(list) ? list.filter((d) => d && typeof d === 'object' && d.id != null) : [];
  }

  function minutes(value) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(value == null ? '' : value));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  const isTime = (value) => TIME_RE.test(String(value == null ? '' : value));

  function firstParagraph(text) {
    const raw = String(text == null ? '' : text).replace(/\r\n/g, '\n').trim();
    return raw ? raw.split(/\n\s*\n/)[0].trim() : '';
  }

  function initials(name) {
    const words = String(name == null ? '' : name).trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map((w) => Array.from(w)[0] || '').join('').toUpperCase() || '•';
  }

  function star() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    const path = document.createElementNS(ns, 'path');
    Object.entries({ viewBox: '0 0 24 24', width: '24', height: '24', 'aria-hidden': 'true' })
      .forEach(([k, v]) => svg.setAttribute(k, v));
    Object.entries({ d: STAR, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linejoin': 'round' })
      .forEach(([k, v]) => path.setAttribute(k, v));
    svg.appendChild(path);
    return svg;
  }

  /* ── Данные дня ───────────────────────────────────────────────── */

  const currentDay = () => days().find((day) => String(day.id) === String(state.dayId));

  function talksOfDay(day) {
    const talks = program().talks;
    return !day || !Array.isArray(talks) ? [] : talks.filter((t) => t && typeof t === 'object' && String(t.dayId) === String(day.id));
  }

  function hallsOfDay(day, raw) {
    const own = Array.isArray(day.halls) ? day.halls.filter((h) => typeof h === 'string' && h.trim()) : [];
    if (own.length) return own;
    const order = new Map();
    (Array.isArray(program().halls) ? program().halls : []).forEach((hall, i) => {
      if (hall && typeof hall.name === 'string') order.set(hall.name, Number.isFinite(hall.order) ? hall.order : i);
    });
    const names = Array.from(new Set(raw.map((t) => t && t.hall).filter((h) => typeof h === 'string' && h)));
    return names.sort((a, b) => (order.get(a) == null ? 999 : order.get(a)) - (order.get(b) == null ? 999 : order.get(b)));
  }

  // Пустой трек — не поломка: карточка показывается с меткой «Без трека»,
  // просто не попадает ни в один чип.
  const trackText = (talk) => (typeof talk.track === 'string' && talk.track.trim() ? talk.track : 'Без трека');

  function validTalk(talk, halls) {
    const ok = !!talk && typeof talk === 'object'
      && typeof talk.title === 'string' && talk.title.trim() !== ''
      && isTime(talk.start) && isTime(talk.end) && halls.includes(talk.hall)
      && minutes(talk.end) > minutes(talk.start);
    if (!ok) badIds.push(talk && talk.id != null ? talk.id : '(без id)');
    return ok;
  }

  function warnBad() {
    if (warned || !badIds.length) return;
    warned = true;
    console.warn('[mm-program] пропущены некорректные доклады:', badIds.slice());
    badIds = [];
  }

  function startsOf(talks) {
    const map = new Map();
    talks.forEach((t) => { const m = minutes(t.start); if (m != null) map.set(t.start, m); });
    return Array.from(map.keys()).sort((a, b) => map.get(a) - map.get(b));
  }

  function spanOf(talk, rows, index) {
    const end = minutes(talk.end);
    let span = 1;
    for (let i = index + 1; i < rows.length; i += 1) {
      const next = minutes(rows[i]);
      if (end != null && next != null && next < end) span += 1;
      else break;
    }
    return span;
  }

  // Оригинал показывает все треки программы независимо от дня: чип, у которого
  // в этот день нет докладов, просто даёт пустую сетку с сообщением.
  function tracksOfDay() {
    const known = (Array.isArray(program().tracks) ? program().tracks : [])
      .map((t) => t && t.name).filter((name) => typeof name === 'string' && name);
    const present = new Set(state.talks.map((t) => t.track).filter(Boolean));
    present.forEach((name) => { if (!known.includes(name)) known.push(name); });
    return known;
  }

  const matching = () => state.talks.filter((t) => !state.track || t.track === state.track);

  /* ── Табы дней ────────────────────────────────────────────────── */

  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
    'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  // "2026-11-26" -> "(26 ноября)", как в оригинале
  function dayLabel(date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
    if (!m) return '';
    const day = Number(m[3]);
    const month = MONTHS[Number(m[2]) - 1] || '';
    return '(' + day + ' ' + month + ')';
  }

  function refocusTab(id) {
    const fresh = Array.from(refs.tabs.querySelectorAll('[role="tab"]'))
      .find((tab) => tab.dataset.dayId === String(id));
    if (fresh) fresh.focus();
  }

  function renderTabs() {
    refs.tabs.textContent = '';
    days().forEach((day, i) => {
      const active = String(day.id) === String(state.dayId);
      const label = [day.name || 'День ' + (i + 1), day.date ? dayLabel(day.date) : '']
        .filter(Boolean).join(' ');
      const tab = el('button', 'program-tab', label);
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(active));
      tab.setAttribute('aria-controls', 'program-panel');
      tab.id = 'program-tab-' + day.id;
      tab.dataset.dayId = String(day.id);
      tab.tabIndex = active ? 0 : -1;
      if (active) tab.classList.add('program-tab--active');
      tab.addEventListener('click', () => {
        const keyboard = tab === document.activeElement;
        selectDay(day.id);
        if (keyboard) refocusTab(day.id);
      });
      refs.tabs.appendChild(tab);
    });
    const panel = document.getElementById('program-panel');
    if (panel) panel.setAttribute('aria-labelledby', 'program-tab-' + state.dayId);
  }

  function selectDay(id) {
    if (String(id) === String(state.dayId)) return;
    state.dayId = String(id);
    state.track = null; // фильтр трека относится к конкретному дню
    renderAll();
  }

  function onTabKey(event) {
    const tabs = Array.from(refs.tabs.querySelectorAll('[role="tab"]'));
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    let next = -1;
    if (event.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const id = tabs[next].dataset.dayId;
    selectDay(id);
    refocusTab(id);
  }

  /* ── Чипы треков ──────────────────────────────────────────────── */

  function renderChips() {
    refs.tracks.textContent = '';
    tracksOfDay().forEach((name) => {
      const active = state.track === name;
      const chip = el('button', 'track-chip', name);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(active));
      if (active) chip.classList.add('track-chip--active');
      chip.addEventListener('click', () => {
        const keyboard = chip === document.activeElement;
        state.track = state.track === name ? null : name;
        renderChips();
        renderGrid();
        syncFavorites();
        if (keyboard) {
          const fresh = Array.from(refs.tracks.querySelectorAll('.track-chip'))
            .find((node) => node.textContent === name);
          if (fresh) fresh.focus();
        }
      });
      refs.tracks.appendChild(chip);
    });
  }

  /* ── Сетка ────────────────────────────────────────────────────── */

  function renderGrid() {
    refs.grid.textContent = '';
    refs.header.textContent = '';
    refs.empty.hidden = true;
    const rows = startsOf(state.talks);
    if (!state.halls.length || !rows.length) {
      renderMessage('В этом дне пока нет докладов.');
      return;
    }
    refs.root.style.setProperty('--mm-hall-count', String(state.halls.length));
    refs.header.appendChild(el('div', 'program-grid__time-label', 'Время'));
    state.halls.forEach((name) => refs.header.appendChild(el('div', 'program-grid__hall-name', name)));

    const slots = new Map();
    state.talks.forEach((talk) => {
      const col = state.halls.indexOf(talk.hall);
      const row = rows.indexOf(talk.start);
      if (col < 0 || row < 0) return;
      const key = row + ':' + col;
      if (slots.has(key)) {
        // Два доклада в одном зале и одно время: второй некуда поставить.
        badIds.push(talk.id);
        warnBad();
        return;
      }
      slots.set(key, { talk, span: spanOf(talk, rows, row), row: row + 1, col: col + 2 });
    });

    // В данных бывают пересечения в одном зале: если доклад начинается внутри
    // чужого слота, укорачиваем предыдущий, чтобы не потерять ни одну карточку.
    const byCol = new Map();
    slots.forEach((slot) => {
      const row = slot.row - 1;
      if (!byCol.has(slot.col)) byCol.set(slot.col, []);
      byCol.get(slot.col).push(row);
    });
    byCol.forEach((list) => list.sort((a, b) => a - b));
    slots.forEach((slot) => {
      const row = slot.row - 1;
      const next = byCol.get(slot.col).find((r) => r > row);
      if (next != null) slot.span = Math.min(slot.span, next - row);
    });

    const taken = new Set();
    slots.forEach((slot) => {
      for (let r = slot.row - 1; r < slot.row - 1 + slot.span; r += 1) taken.add(r + ':' + (slot.col - 2));
    });

    for (let r = 0; r < rows.length; r += 1) {
      const time = el('div', 'program-grid__time-cell', rows[r]);
      time.style.gridArea = (r + 1) + ' / 1';
      refs.grid.appendChild(time);
      for (let c = 0; c < state.halls.length; c += 1) {
        const slot = slots.get(r + ':' + c);
        if (!slot && taken.has(r + ':' + c)) continue;
        const cell = el('div', 'program-grid__talk-cell');
        if (slot) {
          cell.style.gridArea = slot.row + ' / ' + slot.col + ' / span ' + slot.span;
          if (slot.span > 1) cell.classList.add('program-grid__talk-cell--double');
          if (!state.track || slot.talk.track === state.track) cell.appendChild(buildCard(slot.talk, slot.span));
        } else {
          cell.style.gridArea = (r + 1) + ' / ' + (c + 2) + ' / span 1';
        }
        refs.grid.appendChild(cell);
      }
    }
    const total = matching().length;
    updateCounter(total);
    refs.empty.hidden = !(state.track && total === 0);
  }

  function renderMessage(text) {
    refs.header.textContent = '';
    refs.grid.textContent = '';
    refs.root.style.setProperty('--mm-hall-count', '1');
    const message = el('div', 'program-grid__message', text);
    message.style.cssText = 'grid-column:1 / -1;padding:48px 24px;font-size:14px;line-height:1.5;color:#6b7280;text-align:center';
    refs.grid.appendChild(message);
    refs.empty.hidden = true;
    updateCounter(0);
  }

  function pluralTalks(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'доклад';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'доклада';
    return 'докладов';
  }

  function updateCounter(total) {
    if (refs.count) refs.count.textContent = String(total);
    if (refs.label) refs.label.textContent = pluralTalks(total);
  }

  /* ── Карточка ─────────────────────────────────────────────────── */

  function buildCard(talk, span) {
    const card = el('article', 'talk-card');
    card.dataset.talkId = String(talk.id);
    card.tabIndex = 0;
    // role="button" на контейнере с вложенными кнопками делает их
    // "presentational" для скринридеров; article + tabindex достаточно.
    card.setAttribute('aria-haspopup', 'dialog');
    card.setAttribute('aria-label', talk.title);
    if (span > 1) card.classList.add('talk-card--double-slot', 'talk-card--multi-slot');
    if (talk.highlighted) card.classList.add('talk-card--highlighted');

    const image = safeUrl(talk.image);
    if (!image) card.classList.add('talk-card--text-only');
    const top = el('div', image ? 'talk-card__top talk-card__top--dark' : 'talk-card__top talk-card__top--light');
    const header = el('div', image ? 'talk-card__header talk-card__header--overlay' : 'talk-card__header');
    const time = el('span', 'talk-card__time', talk.start + ' - ' + talk.end);
    header.appendChild(time);
    // У карточки с баннером название и трек уже нарисованы на самой картинке,
    // поэтому в верхней оверлей-строке остаются только время и звезда —
    // как в оригинале.
    header.appendChild(favoriteButton(talk));
    top.appendChild(header);

    const media = el('div', 'talk-card__media');
    // Текстовая шапка карточки: используется, когда баннера нет или он не загрузился.
    const mediaText = () => {
      media.textContent = '';
      media.classList.add('talk-card__media--fallback');
      const box = el('div', 'talk-card__media-text');
      box.appendChild(el('h3', 'talk-card__topic-title', talk.title));
      const meta = el('div', 'talk-card__media-meta');
      meta.appendChild(el('span', 'talk-card__meta-item', trackText(talk)));
      box.appendChild(meta);
      media.appendChild(box);
    };
    if (image) {
      const img = el('img', 'talk-card__banner-img');
      Object.assign(img, { src: image, alt: talk.title, loading: 'lazy', decoding: 'async', referrerPolicy: 'no-referrer' });
      img.addEventListener('error', () => {
        // CDN первоисточника периодически отдаёт 403/404: карточка не должна
        // превращаться в тёмную дыру с alt-текстом.
        mediaText();
        top.classList.remove('talk-card__top--dark');
        top.classList.add('talk-card__top--light');
        const header = top.querySelector('.talk-card__header');
        if (header) header.classList.remove('talk-card__header--overlay');
      }, { once: true });
      media.appendChild(img);
    } else {
      mediaText();
    }
    top.appendChild(media);
    card.appendChild(top);

    const bottom = el('div', 'talk-card__bottom talk-card__bottom--light');
    const speakers = (Array.isArray(talk.lectors) ? talk.lectors : [])
      .filter((l) => l && typeof l.name === 'string' && l.name.trim());
    if (speakers.length) {
      const wrap = el('div', 'talk-card__speakers');
      speakers.forEach((lector) => wrap.appendChild(speaker(lector, 'talk-card')));
      bottom.appendChild(wrap);
    }

    const thesesText = talk.short || firstParagraph(talk.description) || '';
    const fullText = talk.description && talk.description !== thesesText ? talk.description : '';
    const content = el('div', 'talk-card__content');
    const theses = el('div', 'talk-card__theses');
    if (span > 1) theses.classList.add('talk-card__theses--double');
    else if (!image) theses.classList.add('talk-card__theses--short');
    if (thesesText) {
      theses.textContent = thesesText;
      content.appendChild(theses);
    }
    if (fullText) {
      const toggle = el('button', 'talk-card__toggle-btn', 'Подробнее');
      toggle.type = 'button';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        const open = card.classList.toggle('talk-card--expanded');
        theses.classList.toggle('talk-card__theses--expanded', open);
        theses.textContent = open ? fullText : thesesText;
        toggle.textContent = open ? 'Свернуть' : 'Подробнее';
        toggle.setAttribute('aria-expanded', String(open));
      });
      content.appendChild(toggle);
    }
    bottom.appendChild(content);
    card.appendChild(bottom);

    card.addEventListener('click', (event) => {
      if (event.target.closest('.talk-card__toggle-btn, .talk-card__favorite')) return;
      openModal(talk, card);
    });
    card.addEventListener('keydown', (event) => {
      if (event.target === card && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        openModal(talk, card);
      }
    });
    return card;
  }

  function speaker(lector, prefix) {
    const row = el('div', prefix + '__speaker');
    const photo = safeUrl(lector.photo);
    const fallbackAvatar = () => {
      const fallback = el('span', prefix + '__speaker-avatar-fallback', initials(lector.name));
      fallback.setAttribute('aria-hidden', 'true');
      fallback.style.cssText = 'background-color:#5c34f6;color:#fff';
      return fallback;
    };
    if (photo) {
      const img = el('img', prefix + '__speaker-photo');
      Object.assign(img, { src: photo, alt: lector.name, loading: 'lazy', decoding: 'async', width: 36, height: 36, referrerPolicy: 'no-referrer' });
      img.addEventListener('error', () => {
        if (img.parentNode === row) row.replaceChild(fallbackAvatar(), img);
      }, { once: true });
      row.appendChild(img);
    } else {
      row.appendChild(fallbackAvatar());
    }
    const info = el('div', prefix + '__speaker-info');
    info.appendChild(el('span', prefix + '__speaker-name', lector.name));
    if (typeof lector.role === 'string' && lector.role.trim()) {
      info.appendChild(el('span', prefix + '__speaker-desc', lector.role));
    }
    row.appendChild(info);
    return row;
  }

  /* ── Избранное ────────────────────────────────────────────────── */

  const favorites = (function () {
    let ids = new Set();
    let persistent = true;
    try {
      const raw = window.localStorage.getItem(FAV_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        // Только скаляры и не больше 500 записей: порченое/раздутое значение
        // из localStorage не должно ни ломать вид, ни вешать主 поток.
        ids = new Set(parsed
          .filter((id) => typeof id === 'string' || typeof id === 'number')
          .slice(0, 500)
          .map(String));
      }
    } catch (error) {
      persistent = false; // приватный режим — живём в памяти
    }
    const save = () => {
      if (!persistent) return;
      // В localStorage кладём числа, как id в данных, а не строки из dataset.
      const out = Array.from(ids).map((id) => (/^\d+$/.test(id) ? Number(id) : id));
      try { window.localStorage.setItem(FAV_KEY, JSON.stringify(out)); } catch (error) { persistent = false; }
    };
    return {
      has: (id) => ids.has(String(id)),
      size: () => ids.size,
      toggle(id) {
        const key = String(id);
        if (ids.has(key)) ids.delete(key);
        else ids.add(key);
        save();
        syncFavorites();
      },
    };
  })();

  function favoriteButton(talk) {
    const button = el('button', 'talk-card__favorite');
    button.type = 'button';
    button.dataset.fav = String(talk.id);
    button.appendChild(star());
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      favorites.toggle(talk.id);
    });
    return button;
  }

  function syncFavorites() {
    document.querySelectorAll('[data-fav]').forEach((button) => {
      const active = favorites.has(button.dataset.fav);
      button.classList.toggle('talk-card__favorite--active', active);
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('aria-label', active ? 'Убрать из избранного' : 'Добавить в избранное');
      button.title = active ? 'Убрать из избранного' : 'В избранное';
      const path = button.querySelector('path');
      if (path) path.setAttribute('fill', active ? 'currentColor' : 'none');
    });
    if (refs.favCount) refs.favCount.textContent = favorites.size() ? String(favorites.size()) : '';
    if (modalTalk) syncModalFav(modalTalk);
  }

  function syncModalFav(talk) {
    if (!refs.modalFav) return;
    const active = favorites.has(talk.id);
    refs.modalFav.classList.toggle('talk-modal__fav--active', active);
    refs.modalFav.setAttribute('aria-pressed', String(active));
    refs.modalFav.textContent = active ? 'В избранном' : 'В избранное';
  }

  /* ── Модалка ──────────────────────────────────────────────────── */

  function openModal(talk, card) {
    if (!refs.modal || !refs.dialog) return;
    modalTalk = talk;
    opener = card || null;
    fillModal(talk);
    refs.modal.hidden = false;
    document.body.classList.add('is-modal-open');
    refs.dialog.scrollTop = 0;
    (refs.close || focusable(refs.dialog)[0] || refs.dialog).focus();
  }

  function closeModal() {
    if (!refs.modal || refs.modal.hidden) return;
    refs.modal.hidden = true;
    document.body.classList.remove('is-modal-open');
    modalTalk = null;
    if (opener && opener.isConnected) opener.focus();
    opener = null;
  }

  function modalPosterFallback(talk) {
    refs.media.textContent = '';
    const fallback = el('div', 'talk-modal__poster-fallback');
    fallback.style.cssText = 'display:flex;align-items:center;justify-content:center;min-height:180px;padding:28px;'
      + 'background:#f3f4f6;color:#111827;font-size:18px;font-weight:700;line-height:1.35;text-align:center';
    fallback.appendChild(el('div', 'talk-modal__poster-fallback-title', talk.title));
    refs.media.appendChild(fallback);
  }

  function fillModal(talk) {
    const image = safeUrl(talk.image);
    refs.media.textContent = '';
    if (image) {
      const img = el('img', 'talk-modal__poster-img');
      Object.assign(img, { src: image, alt: talk.title, loading: 'lazy', referrerPolicy: 'no-referrer' });
      // Тот же CDN отдаёт 403/404: модалка не должна показывать тёмную дыру.
      img.addEventListener('error', () => modalPosterFallback(talk), { once: true });
      refs.media.appendChild(img);
    } else {
      modalPosterFallback(talk);
    }

    refs.meta.textContent = '';
    refs.meta.appendChild(el('span', 'talk-modal__track-chip', trackText(talk)));
    refs.meta.appendChild(el('span', 'talk-modal__time-badge', talk.start + ' - ' + talk.end));
    refs.meta.appendChild(el('span', 'talk-modal__hall-badge', talk.hall));
    refs.title.textContent = talk.title;

    refs.speakers.textContent = '';
    (Array.isArray(talk.lectors) ? talk.lectors : [])
      .filter((l) => l && typeof l.name === 'string' && l.name.trim())
      .forEach((lector) => refs.speakers.appendChild(speaker(lector, 'talk-modal')));

    refs.text.textContent = '';
    const raw = String(talk.description || talk.short || '').replace(/\r\n/g, '\n');
    const parts = raw.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    (parts.length ? parts : ['Описание доклада пока не добавлено.'])
      .forEach((part) => {
        const p = el('p', null, part);
        p.style.margin = '0 0 10px';
        refs.text.appendChild(p);
      });
    syncModalFav(talk);
  }

  const focusable = (root) => Array.from(root.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  ));

  function onDialogKey(event) {
    if (event.key !== 'Tab') return;
    const items = focusable(refs.dialog);
    if (!items.length) return event.preventDefault();
    const first = items[0], last = items[items.length - 1], active = document.activeElement;
    if (!refs.dialog.contains(active) || active === refs.dialog) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /* ── Экспорт .ics ─────────────────────────────────────────────── */

  const icsEscape = (value) => String(value == null ? '' : value)
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
    .replace(/\r\n|\n|\r/g, '\\n');

  // RFC 5545: строки длиннее 75 октетов переносятся с ведущим пробелом.
  // Режем по октетам UTF-8, чтобы не разорвать кириллический символ.
  function foldLine(line) {
    const bytes = new TextEncoder().encode(line);
    if (bytes.length <= 75) return line;
    const out = [];
    let current = '';
    let width = 0;
    Array.from(line).forEach((char) => {
      const size = new TextEncoder().encode(char).length;
      const limit = out.length ? 74 : 75;
      if (width + size > limit) { out.push(current); current = ''; width = 0; }
      current += char;
      width += size;
    });
    out.push(current);
    return out.join('\r\n ');
  }

  const VTIMEZONE = [
    'BEGIN:VTIMEZONE', 'TZID:Europe/Moscow',
    'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0300', 'TZOFFSETTO:+0300',
    'TZNAME:MSK', 'END:STANDARD', 'END:VTIMEZONE',
  ];
  const icsDate = (date, time) => String(date).replace(/-/g, '') + 'T' + String(time).replace(':', '') + '00';

  function icsStamp(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return date.getUTCFullYear() + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate())
      + 'T' + pad(date.getUTCHours()) + pad(date.getUTCMinutes()) + pad(date.getUTCSeconds()) + 'Z';
  }

  function buildCalendar(day, talks) {
    const stamp = icsStamp(new Date());
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//mm-program-page//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'X-WR-CALNAME:' + icsEscape('Матемаркетинг 2026 — ' + (day.name || day.date)), 'X-WR-TIMEZONE:Europe/Moscow']
      .concat(VTIMEZONE);
    talks.forEach((talk) => {
      lines.push('BEGIN:VEVENT', 'UID:' + icsEscape(talk.id) + '@mm-program-page', 'DTSTAMP:' + stamp,
        'DTSTART;TZID=Europe/Moscow:' + icsDate(day.date, talk.start),
        'DTEND;TZID=Europe/Moscow:' + icsDate(day.date, talk.end),
        'SUMMARY:' + icsEscape(talk.title), 'LOCATION:' + icsEscape(talk.hall));
      const description = talk.short || firstParagraph(talk.description);
      if (description) lines.push('DESCRIPTION:' + icsEscape(description));
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.map(foldLine).join('\r\n') + '\r\n';
  }

  function downloadIcs(filename, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportIcs() {
    const day = currentDay();
    const talks = matching();
    if (!day || !DATE_RE.test(String(day.date)) || !talks.length) {
      toast('Нет докладов для экспорта в выбранном дне.');
      return;
    }
    downloadIcs('matemarketing-' + day.date + '.ics', buildCalendar(day, talks));
    toast('В календарь: ' + talks.length + ' докладов');
  }

  /* ── Сайдбар и тост ───────────────────────────────────────────── */

  function ensureBackdrop() {
    if (backdrop) return;
    backdrop = el('div', 'sidebar-backdrop');
    backdrop.hidden = true;
    backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:95;display:none';
    backdrop.addEventListener('click', closeSidebar);
    document.body.appendChild(backdrop);
  }

  function lockScroll(locked) {
    if (locked) {
      if (!document.body.classList.contains('is-scroll-locked')) savedOverflow = document.body.style.overflow;
      document.body.classList.add('is-scroll-locked');
      document.body.style.overflow = 'hidden';
    } else {
      document.body.classList.remove('is-scroll-locked');
      document.body.style.overflow = savedOverflow || '';
    }
  }

  function openSidebar() {
    if (!refs.sidebar) return;
    ensureBackdrop();
    sidebarOpen = true;
    refs.sidebar.classList.add('sidebar--open');
    backdrop.hidden = false;
    backdrop.style.display = 'block';
    lockScroll(true);
  }

  function closeSidebar() {
    if (!refs.sidebar) return;
    sidebarOpen = false;
    refs.sidebar.classList.remove('sidebar--open');
    if (backdrop) {
      backdrop.hidden = true;
      backdrop.style.display = 'none';
    }
    if (!refs.modal || refs.modal.hidden) lockScroll(false);
  }

  function toast(message) {
    document.querySelectorAll('.mm-toast').forEach((node) => node.remove());
    const node = el('div', 'mm-toast', message);
    node.setAttribute('role', 'status');
    node.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:min(92vw,420px);'
      + 'padding:12px 18px;border-radius:12px;background:#111827;color:#fff;font:500 14px/1.4 system-ui,sans-serif;'
      + 'box-shadow:0 12px 30px rgba(15,23,42,.35);z-index:300;text-align:center';
    document.body.appendChild(node);
    window.setTimeout(() => node.remove(), 3000);
  }

  /* ── События и запуск ─────────────────────────────────────────── */

  function onEscape(event) {
    if (event.key !== 'Escape') return;
    if (refs.modal && !refs.modal.hidden) closeModal();
    else if (sidebarOpen) closeSidebar();
  }

  function resolveDay(raw) {
    const list = days();
    if (!list.length) return null;
    if (!raw) return list[0];
    return list.find((d) => String(d.id) === String(raw))
      || list.find((d) => String(d.date) === String(raw))
      || list[Number(raw) - 1] || list[0];
  }

  function resolveTrack(raw) {
    if (!raw) return null;
    const available = new Set(talksOfDay(currentDay()).map((t) => t.track));
    const match = (Array.isArray(program().tracks) ? program().tracks : []).find((t) => t
      && (String(t.id) === String(raw) || String(t.name).toLowerCase() === String(raw).toLowerCase()));
    const name = match ? match.name : raw;
    return available.has(name) ? name : null;
  }

  function renderAll() {
    const day = currentDay();
    if (!day) {
      renderTabs();
      renderMessage('Не удалось загрузить программу: данные не найдены.');
      return;
    }
    const raw = talksOfDay(day);
    state.halls = hallsOfDay(day, raw);
    state.talks = raw.filter((talk) => validTalk(talk, state.halls));
    renderTabs();
    renderChips();
    renderGrid();
    syncFavorites();
    warnBad();
  }

  function bindEvents() {
    refs.tabs.addEventListener('keydown', onTabKey);
    document.querySelectorAll('[data-sidebar-open]').forEach((b) => b.addEventListener('click', openSidebar));
    document.querySelectorAll('[data-sidebar-close]').forEach((b) => b.addEventListener('click', closeSidebar));
    document.querySelectorAll('[data-open-auth]').forEach((b) => b.addEventListener('click', () => {
      closeSidebar();
      toast('Это статическая копия: авторизации нет');
    }));
    if (refs.sidebar) refs.sidebar.addEventListener('click', (e) => { if (e.target.closest('a')) closeSidebar(); });
    if (refs.exportIcs) refs.exportIcs.addEventListener('click', exportIcs);
    if (refs.backdrop) refs.backdrop.addEventListener('click', closeModal);
    if (refs.close) refs.close.addEventListener('click', closeModal);
    if (refs.dialog) refs.dialog.addEventListener('keydown', onDialogKey);
    if (refs.modalFav) refs.modalFav.addEventListener('click', () => { if (modalTalk) favorites.toggle(modalTalk.id); });
    document.addEventListener('keydown', onEscape);
  }

  function init() {
    // [data-modal-text] — <p>; для абзацев нужен контейнер, поэтому меняем тег.
    if (refs.text && refs.text.tagName === 'P') {
      const div = document.createElement('div');
      div.className = refs.text.className;
      div.setAttribute('data-modal-text', '');
      refs.text.replaceWith(div);
      refs.text = div;
    }
    ensureBackdrop();
    bindEvents();
    if (!days().length) {
      renderTabs();
      renderMessage('Не удалось загрузить программу: данных о днях нет.');
      syncFavorites();
      return;
    }
    let query = new URLSearchParams('');
    try { query = new URLSearchParams(window.location.search); } catch (error) { /* живём без параметров */ }
    const day = resolveDay(query.get('day'));
    state.dayId = day.id;
    state.track = resolveTrack(query.get('track'));
    renderAll();
  }

  init();
})();
