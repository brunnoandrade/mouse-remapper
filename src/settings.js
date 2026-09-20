// KeyboardEvent.code -> macOS virtual keycode (kVK_*)
const CODE_TO_MAC = {
  KeyA: 0x00, KeyS: 0x01, KeyD: 0x02, KeyF: 0x03, KeyH: 0x04, KeyG: 0x05,
  KeyZ: 0x06, KeyX: 0x07, KeyC: 0x08, KeyV: 0x09, KeyB: 0x0B, KeyQ: 0x0C,
  KeyW: 0x0D, KeyE: 0x0E, KeyR: 0x0F, KeyY: 0x10, KeyT: 0x11,
  Digit1: 0x12, Digit2: 0x13, Digit3: 0x14, Digit4: 0x15, Digit6: 0x16,
  Digit5: 0x17, Equal: 0x18, Digit9: 0x19, Digit7: 0x1A, Minus: 0x1B,
  Digit8: 0x1C, Digit0: 0x1D, BracketRight: 0x1E, KeyO: 0x1F, KeyU: 0x20,
  BracketLeft: 0x21, KeyI: 0x22, KeyP: 0x23, KeyL: 0x25, KeyJ: 0x26,
  Quote: 0x27, KeyK: 0x28, Semicolon: 0x29, Backslash: 0x2A, Comma: 0x2B,
  Slash: 0x2C, KeyN: 0x2D, KeyM: 0x2E, Period: 0x2F, Backquote: 0x32,
  Tab: 0x30, Space: 0x31, Enter: 0x24, Backspace: 0x33, Escape: 0x35,
  ArrowLeft: 0x7B, ArrowRight: 0x7C, ArrowDown: 0x7D, ArrowUp: 0x7E,
  PageUp: 0x74, PageDown: 0x79, Home: 0x73, End: 0x77,
  F1: 0x7A, F2: 0x78, F3: 0x63, F4: 0x76, F5: 0x60, F6: 0x61,
  F7: 0x62, F8: 0x64, F9: 0x65, F10: 0x6D, F11: 0x67, F12: 0x6F,
};

const MAC_TO_LABEL = Object.fromEntries(
  Object.entries(CODE_TO_MAC).map(([code, mac]) => [mac, labelForCode(code)])
);

function labelForCode(code) {
  const specials = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Space: 'Espaço', Enter: 'Enter', Tab: 'Tab', Escape: 'Esc',
    Backspace: 'Delete', PageUp: 'Page Up', PageDown: 'Page Down',
    Home: 'Home', End: 'End',
  };
  if (specials[code]) return specials[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

const FLAG = { shift: 0x20000, control: 0x40000, option: 0x80000, command: 0x100000 };

// Trigger `button` numbers are CGEvent button numbers: 2 = middle, 3 = back, 4 = forward, 5+ = extras.
const TRIGGERS = [
  { value: 'scroll:up', label: 'Scroll para cima', trigger: { type: 'scroll', direction: 'up' }, defaultKey: 126 },
  { value: 'scroll:down', label: 'Scroll para baixo', trigger: { type: 'scroll', direction: 'down' }, defaultKey: 125 },
  { value: 'button:2', label: 'Clique do meio', trigger: { type: 'button', button: 2 }, defaultKey: 49 },
  { value: 'button:3', label: 'Botão lateral (voltar)', trigger: { type: 'button', button: 3 }, defaultKey: 123 },
  { value: 'button:4', label: 'Botão lateral (avançar)', trigger: { type: 'button', button: 4 }, defaultKey: 124 },
  ...[5, 6, 7, 8].map((n) => ({ value: `button:${n}`, label: `Botão extra ${n}`, trigger: { type: 'button', button: n }, defaultKey: 49 })),
];

function triggerValue(t) {
  return t.type === 'scroll' ? `scroll:${t.direction}` : `button:${t.button}`;
}

function triggerLabel(t) {
  const known = TRIGGERS.find((x) => x.value === triggerValue(t));
  return known ? known.label : `Botão ${t.button}`;
}

function defaultKeyFor(t) {
  const known = TRIGGERS.find((x) => x.value === triggerValue(t));
  return known ? known.defaultKey : 49;
}

// Ids must match performSystem() in native/MouseRemapHelper.swift.
const ACTION_GROUPS = [
  { label: 'Sistema', items: [
    ['system:mission_control', 'Mission Control'],
    ['system:space_left', 'Space à esquerda'],
    ['system:space_right', 'Space à direita'],
  ] },
  { label: 'Captura de tela', items: [
    ['system:screenshot_full', 'Tela inteira'],
    ['system:screenshot_area', 'Área selecionada'],
    ['system:screenshot_menu', 'Menu de captura'],
  ] },
  { label: 'Mídia', items: [
    ['system:play_pause', 'Play / Pause'],
    ['system:next_track', 'Próxima faixa'],
    ['system:previous_track', 'Faixa anterior'],
    ['system:volume_up', 'Volume +'],
    ['system:volume_down', 'Volume −'],
    ['system:mute', 'Mudo'],
  ] },
  { label: 'Clique', items: [
    ['click:left', 'Clique esquerdo'],
    ['click:right', 'Clique direito'],
    ['click:double', 'Duplo clique'],
  ] },
];

const ACTION_LABELS = Object.fromEntries(ACTION_GROUPS.flatMap((g) => g.items));

let state = null;

function actionValue(action) {
  if (action.type === 'system' || action.type === 'click') return `${action.type}:${action.id}`;
  return action.type; // 'key' | 'app'
}

function actionFromValue(value, trigger, previous) {
  if (value === 'key') {
    const keepPrevious = previous.type === 'key';
    return {
      type: 'key',
      keyCode: keepPrevious ? previous.keyCode : defaultKeyFor(trigger),
      flags: keepPrevious ? previous.flags : 0,
    };
  }
  if (value === 'app') return { type: 'app', bundleId: previous.type === 'app' ? previous.bundleId : '' };
  const [type, id] = value.split(':');
  return { type, id };
}

function buildModifiersUI(container, action) {
  container.innerHTML = '';
  const names = [['command', '⌘'], ['option', '⌥'], ['control', '⌃'], ['shift', '⇧']];
  for (const [key, glyph] of names) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!(action.flags & FLAG[key]);
    cb.addEventListener('change', () => {
      action.flags = cb.checked ? (action.flags | FLAG[key]) : (action.flags & ~FLAG[key]);
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(glyph));
    container.appendChild(label);
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildActionSelect(current) {
  const select = document.createElement('select');
  const add = (parent, value, label) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    parent.appendChild(opt);
  };
  add(select, 'key', 'Tecla / atalho');
  add(select, 'app', 'Abrir aplicativo');
  for (const group of ACTION_GROUPS) {
    const og = document.createElement('optgroup');
    og.label = group.label;
    for (const [value, label] of group.items) add(og, value, label);
    select.appendChild(og);
  }
  select.value = actionValue(current);
  return select;
}

function buildKeyRow(action) {
  const row = el('div', 'row field');
  row.appendChild(el('span', 'small', 'Tecla:'));
  const keyBtn = el('button', 'keybtn', MAC_TO_LABEL[action.keyCode] || `código ${action.keyCode}`);
  keyBtn.onclick = () => {
    keyBtn.textContent = 'pressione uma tecla...';
    keyBtn.classList.add('capturing');
    const handler = (e) => {
      e.preventDefault();
      const mac = CODE_TO_MAC[e.code];
      if (mac !== undefined) {
        action.keyCode = mac;
      } else {
        setStatus('Tecla não suportada, tente outra.', 'warn');
      }
      keyBtn.textContent = MAC_TO_LABEL[action.keyCode] || `código ${action.keyCode}`;
      keyBtn.classList.remove('capturing');
      window.removeEventListener('keydown', handler, true);
    };
    window.addEventListener('keydown', handler, true);
  };
  row.appendChild(keyBtn);
  return row;
}

function buildAppRow(action) {
  const row = el('div', 'row field');
  row.appendChild(el('span', 'small', 'Aplicativo:'));
  const select = document.createElement('select');
  const placeholder = el('option', '', 'Escolha um aplicativo...');
  placeholder.value = '';
  select.appendChild(placeholder);
  const apps = availableApps.slice();
  if (action.bundleId && !apps.some((a) => a.bundleIdentifier === action.bundleId)) {
    apps.push({ name: action.bundleId, bundleIdentifier: action.bundleId });
  }
  for (const app of apps.sort((a, b) => a.name.localeCompare(b.name))) {
    const opt = el('option', '', app.name);
    opt.value = app.bundleIdentifier;
    select.appendChild(opt);
  }
  select.value = action.bundleId || '';
  select.onchange = () => { action.bundleId = select.value; };
  row.appendChild(select);
  return row;
}

function actionLabel(action) {
  if (action.type === 'key') {
    const glyphs = [['control', '⌃'], ['option', '⌥'], ['shift', '⇧'], ['command', '⌘']]
      .filter(([name]) => action.flags & FLAG[name]).map(([, g]) => g).join('');
    return glyphs + (MAC_TO_LABEL[action.keyCode] || `código ${action.keyCode}`);
  }
  if (action.type === 'app') {
    const app = appById(action.bundleId);
    return `Abrir ${app ? app.name : action.bundleId || '(nenhum app)'}`;
  }
  return ACTION_LABELS[actionValue(action)] || actionValue(action);
}

function renderMappings() {
  const list = document.getElementById('mappings');
  list.innerHTML = '';
  if (state.mappings.length === 0) {
    list.appendChild(el('div', 'empty', 'Nenhum mapeamento ainda. Clique em "+ Adicionar" para criar o primeiro.'));
    return;
  }

  for (const mapping of state.mappings) {
    const rule = el('div', 'rule');

    const switchLabel = el('label', 'switch');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = mapping.enabled;
    cb.onchange = () => { mapping.enabled = cb.checked; rule.classList.toggle('disabled', !cb.checked); };
    switchLabel.appendChild(cb);
    switchLabel.appendChild(el('span', 'slider'));
    rule.appendChild(switchLabel);

    const body = el('button', 'rule-body');
    body.type = 'button';
    body.title = 'Editar';
    body.appendChild(el('span', 'rule-trigger', triggerLabel(mapping.trigger)));
    body.appendChild(el('span', 'rule-arrow', '→'));
    body.appendChild(el('span', 'rule-action', actionLabel(mapping.action)));
    body.onclick = () => openEditor(mapping);
    rule.appendChild(body);

    const edit = el('button', 'icon-btn', '✎');
    edit.type = 'button';
    edit.title = 'Editar';
    edit.onclick = () => openEditor(mapping);
    rule.appendChild(edit);

    const remove = el('button', 'icon-btn', '✕');
    remove.type = 'button';
    remove.title = 'Remover';
    remove.onclick = () => {
      state.mappings = state.mappings.filter((m) => m.id !== mapping.id);
      renderMappings();
    };
    rule.appendChild(remove);

    rule.classList.toggle('disabled', !mapping.enabled);
    list.appendChild(rule);
  }
}

// ---- Editor dialog ----

const editorDialog = document.getElementById('editor');
let stopDetecting = null;

function buildTriggerSelect(draft) {
  const select = document.createElement('select');
  const options = TRIGGERS.map((t) => [t.value, t.label]);
  if (!TRIGGERS.some((t) => t.value === triggerValue(draft.trigger))) {
    options.push([triggerValue(draft.trigger), triggerLabel(draft.trigger)]); // e.g. a detected button 9
  }
  for (const [value, label] of options) {
    const opt = el('option', '', label);
    opt.value = value;
    select.appendChild(opt);
  }
  select.value = triggerValue(draft.trigger);
  return select;
}

// Listens for the next mouse button press. DOM button numbers differ from CGEvent's:
// DOM 1 = middle (CG 2), DOM 3/4 = back/forward (CG 3/4). Left and right can't be remapped.
function detectButton(onDetected, onCancel) {
  const handler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    stop();
    if (e.button === 0 || e.button === 2) {
      onCancel('Botões esquerdo e direito não podem ser remapeados.');
      return;
    }
    onDetected(e.button === 1 ? 2 : e.button);
  };
  const stop = () => {
    window.removeEventListener('mousedown', handler, true);
    stopDetecting = null;
  };
  window.addEventListener('mousedown', handler, true);
  stopDetecting = stop;
}

function openEditor(existing) {
  const isNew = !existing;
  const used = new Set(state.mappings.map((m) => triggerValue(m.trigger)));
  const firstFree = TRIGGERS.find((t) => !used.has(t.value)) || TRIGGERS[0];
  const draft = existing
    ? structuredClone(existing)
    : { id: crypto.randomUUID(), enabled: true, trigger: { ...firstFree.trigger }, action: { type: 'key', keyCode: firstFree.defaultKey, flags: 0 } };

  const form = document.getElementById('editorBody');
  const error = document.getElementById('editorError');
  error.textContent = '';
  document.getElementById('editorTitle').textContent = isNew ? 'Novo mapeamento' : 'Editar mapeamento';

  function render() {
    form.innerHTML = '';

    const triggerRow = el('div', 'row field');
    triggerRow.appendChild(el('span', 'small', 'Gatilho:'));
    const triggerControls = el('div', 'inline');
    const triggerSelect = buildTriggerSelect(draft);
    triggerSelect.onchange = () => {
      const untouchedKey = draft.action.type === 'key' && !draft.action.flags
        && draft.action.keyCode === defaultKeyFor(draft.trigger);
      draft.trigger = TRIGGERS.find((t) => t.value === triggerSelect.value).trigger;
      if (untouchedKey) draft.action.keyCode = defaultKeyFor(draft.trigger);
      render();
    };
    const detectBtn = el('button', 'keybtn', 'Detectar');
    detectBtn.type = 'button';
    detectBtn.style.width = 'auto';
    detectBtn.onclick = () => {
      if (stopDetecting) stopDetecting();
      detectBtn.textContent = 'Pressione um botão...';
      detectBtn.classList.add('capturing');
      error.textContent = '';
      detectButton(
        (button) => { draft.trigger = { type: 'button', button }; render(); },
        (message) => { error.textContent = message; render(); }
      );
    };
    triggerControls.appendChild(triggerSelect);
    triggerControls.appendChild(detectBtn);
    triggerRow.appendChild(triggerControls);
    form.appendChild(triggerRow);

    const actionRow = el('div', 'row field');
    actionRow.appendChild(el('span', 'small', 'Ação:'));
    const actionSelect = buildActionSelect(draft.action);
    actionSelect.onchange = () => {
      draft.action = actionFromValue(actionSelect.value, draft.trigger, draft.action);
      render();
    };
    actionRow.appendChild(actionSelect);
    form.appendChild(actionRow);

    if (draft.action.type === 'key') {
      form.appendChild(buildKeyRow(draft.action));
      const mods = el('div', 'modifiers');
      buildModifiersUI(mods, draft.action);
      form.appendChild(mods);
    } else if (draft.action.type === 'app') {
      form.appendChild(buildAppRow(draft.action));
    }
  }
  render();

  document.getElementById('editorSave').onclick = () => {
    const conflict = state.mappings.find((m) => m.id !== draft.id && triggerValue(m.trigger) === triggerValue(draft.trigger));
    if (conflict) {
      error.textContent = `Já existe um mapeamento para "${triggerLabel(draft.trigger)}". Edite ou remova o existente.`;
      return;
    }
    if (draft.action.type === 'app' && !draft.action.bundleId) {
      error.textContent = 'Escolha um aplicativo.';
      return;
    }
    const index = state.mappings.findIndex((m) => m.id === draft.id);
    if (index >= 0) state.mappings[index] = draft;
    else state.mappings.push(draft);
    editorDialog.close();
    renderMappings();
  };
  editorDialog.showModal();
}

editorDialog.addEventListener('close', () => { if (stopDetecting) stopDetecting(); });
document.getElementById('editorCancel').onclick = () => editorDialog.close();
document.getElementById('addMapping').addEventListener('click', () => openEditor(null));

function setStatus(msg, kind) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = kind || '';
}

let availableApps = [];

function iconSrc(app) {
  return app.iconBase64 ? `data:image/png;base64,${app.iconBase64}` : '';
}

function appById(bundleId) {
  return availableApps.find((a) => a.bundleIdentifier === bundleId);
}

function renderChips() {
  const chipsEl = document.getElementById('selectedApps');
  const emptyEl = document.getElementById('appListEmpty');
  chipsEl.innerHTML = '';
  if (!state.targetApps) state.targetApps = [];

  for (const bundleId of state.targetApps) {
    const app = appById(bundleId) || { name: bundleId, bundleIdentifier: bundleId };
    const chip = document.createElement('div');
    chip.className = 'chip';
    if (app.iconBase64) {
      const img = document.createElement('img');
      img.src = iconSrc(app);
      chip.appendChild(img);
    }
    const label = document.createElement('span');
    label.textContent = app.name;
    chip.appendChild(label);
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.title = 'Remover';
    removeBtn.addEventListener('click', () => {
      state.targetApps = state.targetApps.filter((id) => id !== bundleId);
      renderChips();
      renderDropdown(document.getElementById('appSearch').value);
    });
    chip.appendChild(removeBtn);
    chipsEl.appendChild(chip);
  }

  emptyEl.style.display = state.targetApps.length === 0 ? 'block' : 'none';
}

function renderDropdown(filterText) {
  const dropdown = document.getElementById('appDropdown');
  const query = (filterText || '').toLowerCase();
  const candidates = availableApps.filter(
    (a) => !state.targetApps.includes(a.bundleIdentifier) && a.name.toLowerCase().includes(query)
  );

  dropdown.innerHTML = '';
  if (candidates.length === 0) {
    dropdown.innerHTML = '<div class="dropdown-empty">Nenhum app encontrado.</div>';
  } else {
    for (const app of candidates) {
      const item = document.createElement('div');
      item.className = 'dropdown-item';
      if (app.iconBase64) {
        const img = document.createElement('img');
        img.src = iconSrc(app);
        item.appendChild(img);
      }
      const label = document.createElement('span');
      label.textContent = app.name;
      item.appendChild(label);
      item.addEventListener('mousedown', (e) => {
        e.preventDefault(); // avoid losing focus before click registers
        if (!state.targetApps.includes(app.bundleIdentifier)) state.targetApps.push(app.bundleIdentifier);
        document.getElementById('appSearch').value = '';
        renderChips();
        renderDropdown('');
      });
      dropdown.appendChild(item);
    }
  }
  dropdown.hidden = false;
}

async function renderAppList() {
  availableApps = await window.api.listApps();
  if (!state.targetApps) state.targetApps = [];

  const missingIds = state.targetApps.filter((id) => !appById(id));
  if (missingIds.length > 0) {
    const resolved = await window.api.resolveApps(missingIds);
    availableApps = availableApps.concat(resolved);
  }

  renderChips();
  renderMappings(); // app names in the list need the app list
}

const appSearchInput = document.getElementById('appSearch');
const appDropdown = document.getElementById('appDropdown');
appSearchInput.addEventListener('focus', () => renderDropdown(appSearchInput.value));
appSearchInput.addEventListener('input', () => renderDropdown(appSearchInput.value));
appSearchInput.addEventListener('blur', () => {
  setTimeout(() => { appDropdown.hidden = true; }, 100);
});

document.getElementById('refreshApps').addEventListener('click', renderAppList);

function renderTheme() {
  const current = state.theme || 'system';
  for (const btn of document.querySelectorAll('#themeSelect button')) {
    const selected = btn.dataset.theme === current;
    btn.classList.toggle('selected', selected);
    btn.setAttribute('aria-checked', selected);
  }
}

document.getElementById('themeSelect').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-theme]');
  if (!btn) return;
  state.theme = btn.dataset.theme;
  renderTheme();
  await window.api.setTheme(state.theme); // applies immediately and persists
});

async function init() {
  state = await window.api.getConfig();
  renderTheme();
  renderMappings();
  document.getElementById('threshold').value = state.scrollThreshold;
  document.getElementById('suppressScroll').checked = state.suppressOriginalScroll;
  await renderAppList();
}

document.getElementById('saveBtn').addEventListener('click', async () => {
  state.scrollThreshold = parseFloat(document.getElementById('threshold').value) || 4;
  state.suppressOriginalScroll = document.getElementById('suppressScroll').checked;
  await window.api.setConfig(state);
  setStatus('Salvo. As alterações já estão ativas.', 'ok');
  setTimeout(() => setStatus(''), 3000);
});

function openAccessibilityPrefs() {
  window.api.openAccessibilityPrefs();
}
window.openAccessibilityPrefs = openAccessibilityPrefs;

init();
