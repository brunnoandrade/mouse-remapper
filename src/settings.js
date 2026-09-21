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

const DIRECTIONS = [
  ['left', '← Esquerda', 123],
  ['right', '→ Direita', 124],
  ['up', '↑ Cima', 126],
  ['down', '↓ Baixo', 125],
];
const BUTTON_CHOICES = TRIGGERS.filter((t) => t.trigger.type === 'button');

function buttonLabel(button) {
  const known = BUTTON_CHOICES.find((t) => t.trigger.button === button);
  return known ? known.label : `Botão ${button}`;
}

function triggerValue(t) {
  if (t.type === 'scroll') return `scroll:${t.direction}`;
  if (t.type === 'gesture') return `gesture:${t.button}:${t.direction}`;
  return `button:${t.button}`;
}

function triggerLabel(t) {
  if (t.type === 'gesture') {
    const arrow = DIRECTIONS.find(([d]) => d === t.direction);
    return `Arrastar ${arrow ? arrow[1].split(' ')[0] : t.direction} · ${buttonLabel(t.button)}`;
  }
  const known = TRIGGERS.find((x) => x.value === triggerValue(t));
  return known ? known.label : `Botão ${t.button}`;
}

function defaultKeyFor(t) {
  if (t.type === 'gesture') {
    const dir = DIRECTIONS.find(([d]) => d === t.direction);
    return dir ? dir[2] : 49;
  }
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
let selectedProfile = 'default'; // 'default' or a bundle id

function profileOf(id) {
  return id === 'default' ? state.defaultProfile : state.appProfiles[id];
}

// The profile whose mappings the list and editor are showing.
function currentProfile() {
  if (!profileOf(selectedProfile)) selectedProfile = 'default';
  return profileOf(selectedProfile);
}

function actionValue(action) {
  if (action.type === 'system' || action.type === 'click') return `${action.type}:${action.id}`;
  return action.type; // 'key' | 'app' | 'none'
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
  if (value === 'none') return { type: 'none' };
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
  add(select, 'none', 'Comportamento original (não remapear)');
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
  if (action.type === 'none') return 'Original (sem remapear)';
  if (action.type === 'app') {
    const app = appById(action.bundleId);
    return `Abrir ${app ? app.name : action.bundleId || '(nenhum app)'}`;
  }
  return ACTION_LABELS[actionValue(action)] || actionValue(action);
}

function profileName(id) {
  if (id === 'default') return 'Global';
  const app = appById(id);
  return app ? app.name : id;
}

function renderProfileHeader() {
  const isDefault = selectedProfile === 'default';
  document.getElementById('profileTitle').textContent = `Mapeamentos · ${profileName(selectedProfile)}`;
  const hint = document.getElementById('profileHint');
  if (isDefault && !state.defaultProfile.enabled) {
    hint.textContent = 'Perfil global desativado: só os apps com perfil próprio são remapeados.';
    hint.className = 'small warn';
  } else {
    hint.textContent = isDefault
      ? 'Vale em todos os apps que não têm perfil próprio.'
      : 'Neste app, estas regras valem no lugar das globais para o mesmo gatilho. Os demais gatilhos continuam usando as globais.';
    hint.className = 'small';
  }
}

function renderMappings() {
  renderProfileHeader();
  renderProfiles(); // keeps the per-profile rule counts current
  const list = document.getElementById('mappings');
  list.innerHTML = '';
  if (currentProfile().mappings.length === 0) {
    list.appendChild(el('div', 'empty', 'Nenhum mapeamento ainda. Clique em "+ Adicionar" para criar o primeiro.'));
    return;
  }

  for (const mapping of currentProfile().mappings) {
    const rule = el('div', 'rule');

    const switchLabel = el('label', 'switch');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = mapping.enabled;
    cb.onchange = () => { mapping.enabled = cb.checked; rule.classList.toggle('disabled', !cb.checked); scheduleSave(); };
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
      const profile = currentProfile();
      profile.mappings = profile.mappings.filter((m) => m.id !== mapping.id);
      renderMappings();
      scheduleSave();
    };
    rule.appendChild(remove);

    rule.classList.toggle('disabled', !mapping.enabled);
    list.appendChild(rule);
  }
}

// ---- Editor dialog ----

const editorDialog = document.getElementById('editor');
let stopDetecting = null;

const GESTURE_OPTION = 'gesture';

function buildTriggerSelect(draft) {
  const select = document.createElement('select');
  const isGesture = draft.trigger.type === 'gesture';
  const options = TRIGGERS.map((t) => [t.value, t.label]);
  if (!isGesture && !TRIGGERS.some((t) => t.value === triggerValue(draft.trigger))) {
    options.push([triggerValue(draft.trigger), triggerLabel(draft.trigger)]); // e.g. a detected button 9
  }
  options.push([GESTURE_OPTION, 'Arrastar segurando um botão…']);
  for (const [value, label] of options) {
    const opt = el('option', '', label);
    opt.value = value;
    select.appendChild(opt);
  }
  select.value = isGesture ? GESTURE_OPTION : triggerValue(draft.trigger);
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
  const used = new Set(currentProfile().mappings.map((m) => triggerValue(m.trigger)));
  const firstFree = TRIGGERS.find((t) => !used.has(t.value)) || TRIGGERS[0];
  const draft = existing
    ? structuredClone(existing)
    : { id: crypto.randomUUID(), enabled: true, trigger: { ...firstFree.trigger }, action: { type: 'key', keyCode: firstFree.defaultKey, flags: 0 } };

  const form = document.getElementById('editorBody');
  const error = document.getElementById('editorError');
  error.textContent = '';
  document.getElementById('editorTitle').textContent = isNew ? 'Novo mapeamento' : 'Editar mapeamento';

  // Changing the trigger also moves an untouched default key (e.g. ← for a left gesture) along with it.
  function changeTrigger(mutate) {
    const untouchedKey = draft.action.type === 'key' && !draft.action.flags
      && draft.action.keyCode === defaultKeyFor(draft.trigger);
    mutate();
    if (untouchedKey) draft.action.keyCode = defaultKeyFor(draft.trigger);
    render();
  }

  function render() {
    form.innerHTML = '';

    const triggerRow = el('div', 'row field');
    triggerRow.appendChild(el('span', 'small', 'Gatilho:'));
    const triggerControls = el('div', 'inline');
    const triggerSelect = buildTriggerSelect(draft);
    triggerSelect.onchange = () => {
      changeTrigger(() => {
        if (triggerSelect.value === GESTURE_OPTION) {
          const button = draft.trigger.type === 'button' ? draft.trigger.button : 3;
          draft.trigger = { type: 'gesture', button, direction: 'left' };
        } else {
          draft.trigger = TRIGGERS.find((t) => t.value === triggerSelect.value).trigger;
        }
      });
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
        (button) => changeTrigger(() => {
          draft.trigger = draft.trigger.type === 'gesture' ? { ...draft.trigger, button } : { type: 'button', button };
        }),
        (message) => { error.textContent = message; render(); }
      );
    };
    triggerControls.appendChild(triggerSelect);
    triggerControls.appendChild(detectBtn);
    triggerRow.appendChild(triggerControls);
    form.appendChild(triggerRow);

    if (draft.trigger.type === 'gesture') {
      const buttonRow = el('div', 'row field');
      buttonRow.appendChild(el('span', 'small', 'Botão:'));
      const buttonSelect = document.createElement('select');
      const choices = BUTTON_CHOICES.map((t) => [t.trigger.button, t.label]);
      if (!choices.some(([n]) => n === draft.trigger.button)) choices.push([draft.trigger.button, buttonLabel(draft.trigger.button)]);
      for (const [n, label] of choices) {
        const opt = el('option', '', label);
        opt.value = n;
        buttonSelect.appendChild(opt);
      }
      buttonSelect.value = draft.trigger.button;
      buttonSelect.onchange = () => changeTrigger(() => { draft.trigger.button = Number(buttonSelect.value); });
      buttonRow.appendChild(buttonSelect);
      form.appendChild(buttonRow);

      const dirRow = el('div', 'row field');
      dirRow.appendChild(el('span', 'small', 'Direção:'));
      const dirSelect = document.createElement('select');
      for (const [value, label] of DIRECTIONS) {
        const opt = el('option', '', label);
        opt.value = value;
        dirSelect.appendChild(opt);
      }
      dirSelect.value = draft.trigger.direction;
      dirSelect.onchange = () => changeTrigger(() => { draft.trigger.direction = dirSelect.value; });
      dirRow.appendChild(dirSelect);
      form.appendChild(dirRow);

      form.appendChild(el('p', 'small hint', 'Segure o botão e arraste. Um clique simples nesse botão passa a disparar ao soltar, e o cursor fica parado durante o gesto.'));
    }

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
    const conflict = currentProfile().mappings.find((m) => m.id !== draft.id && triggerValue(m.trigger) === triggerValue(draft.trigger));
    if (conflict) {
      error.textContent = `Já existe um mapeamento para "${triggerLabel(draft.trigger)}". Edite ou remova o existente.`;
      return;
    }
    if (draft.action.type === 'app' && !draft.action.bundleId) {
      error.textContent = 'Escolha um aplicativo.';
      return;
    }
    const mappings = currentProfile().mappings;
    const index = mappings.findIndex((m) => m.id === draft.id);
    if (index >= 0) mappings[index] = draft;
    else mappings.push(draft);
    editorDialog.close();
    renderMappings();
    scheduleSave();
  };
  editorDialog.showModal();
}

editorDialog.addEventListener('close', () => { if (stopDetecting) stopDetecting(); });
document.getElementById('editorCancel').onclick = () => editorDialog.close();
document.getElementById('addMapping').addEventListener('click', () => openEditor(null));

let saveTimer = null;
let statusTimer = null;

// Every change funnels through here: a short debounce, then one write of the whole state.
function scheduleSave() {
  clearTimeout(saveTimer);
  setStatus('Salvando...');
  saveTimer = setTimeout(saveNow, 400);
}

async function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  await window.api.setConfig(state);
  setStatus('Salvo automaticamente. As alterações já estão ativas.', 'ok');
  statusTimer = setTimeout(() => setStatus(''), 2500);
}

// Closing the window inside the debounce window must not drop the last change.
window.addEventListener('beforeunload', () => {
  if (saveTimer) window.api.setConfig(state);
});

function setStatus(msg, kind) {
  clearTimeout(statusTimer); // a newer message must not be wiped by an older message's auto-clear
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

function profileItem({ id, name, iconApp, glyph, count, off }) {
  const item = el('div', 'profile');
  item.classList.toggle('selected', selectedProfile === id);
  item.classList.toggle('off', !!off);

  const main = el('button', 'profile-main');
  main.type = 'button';
  if (iconApp && iconApp.iconBase64) {
    const img = document.createElement('img');
    img.src = iconSrc(iconApp);
    main.appendChild(img);
  } else {
    main.appendChild(el('span', 'profile-glyph', glyph || '▫︎'));
  }
  main.appendChild(el('span', 'profile-name', name));
  main.appendChild(el('span', 'profile-count', count === 1 ? '1 regra' : `${count} regras`));
  main.onclick = () => selectProfile(id);
  item.appendChild(main);
  return item;
}

function selectProfile(id) {
  selectedProfile = id;
  renderProfiles();
  renderMappings();
}

function renderProfiles() {
  const list = document.getElementById('profileList');
  list.innerHTML = '';

  const global = profileItem({
    id: 'default', name: 'Global', glyph: '🌐',
    count: state.defaultProfile.mappings.length, off: !state.defaultProfile.enabled,
  });
  const switchLabel = el('label', 'switch');
  switchLabel.title = 'Ativar o perfil global';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!state.defaultProfile.enabled;
  cb.onchange = () => {
    state.defaultProfile.enabled = cb.checked;
    scheduleSave();
    renderProfiles();
    renderMappings();
  };
  switchLabel.appendChild(cb);
  switchLabel.appendChild(el('span', 'slider'));
  global.appendChild(switchLabel);
  list.appendChild(global);

  for (const bundleId of Object.keys(state.appProfiles)) {
    const app = appById(bundleId) || { name: bundleId, bundleIdentifier: bundleId };
    const item = profileItem({
      id: bundleId, name: app.name, iconApp: app, count: state.appProfiles[bundleId].mappings.length,
    });
    const remove = el('button', 'icon-btn', '✕');
    remove.type = 'button';
    remove.title = 'Remover perfil';
    remove.onclick = () => removeProfile(bundleId, app.name);
    item.appendChild(remove);
    list.appendChild(item);
  }
}

function removeProfile(bundleId, name) {
  const count = state.appProfiles[bundleId].mappings.length;
  if (count > 0 && !confirm(`Remover o perfil de ${name} e suas ${count} regras?`)) return;
  delete state.appProfiles[bundleId];
  if (selectedProfile === bundleId) selectedProfile = 'default';
  scheduleSave();
  renderProfiles();
  renderMappings();
  renderDropdown(document.getElementById('appSearch').value);
}

function renderDropdown(filterText) {
  const dropdown = document.getElementById('appDropdown');
  const query = (filterText || '').toLowerCase();
  const candidates = availableApps.filter(
    (a) => !(a.bundleIdentifier in state.appProfiles) && a.name.toLowerCase().includes(query)
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
        state.appProfiles[app.bundleIdentifier] = { mappings: [] };
        selectedProfile = app.bundleIdentifier;
        scheduleSave();
        document.getElementById('appSearch').value = '';
        renderProfiles();
        renderMappings();
        renderDropdown('');
      });
      dropdown.appendChild(item);
    }
  }
  dropdown.hidden = false;
}

async function renderAppList() {
  availableApps = await window.api.listApps();

  const missingIds = Object.keys(state.appProfiles).filter((id) => !appById(id));
  if (missingIds.length > 0) {
    const resolved = await window.api.resolveApps(missingIds);
    availableApps = availableApps.concat(resolved);
  }

  renderProfiles();
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

const thresholdInput = document.getElementById('threshold');
const suppressScrollInput = document.getElementById('suppressScroll');

thresholdInput.addEventListener('change', () => {
  const value = parseFloat(thresholdInput.value);
  state.scrollThreshold = Math.min(30, Math.max(0.5, Number.isFinite(value) ? value : 4));
  thresholdInput.value = state.scrollThreshold;
  scheduleSave();
});
suppressScrollInput.addEventListener('change', () => {
  state.suppressOriginalScroll = suppressScrollInput.checked;
  scheduleSave();
});

document.getElementById('resetBtn').addEventListener('click', () => {
  const ok = confirm('Restaurar padrões?\n\nRemove os mapeamentos de todos os perfis e volta a sensibilidade do scroll ao valor original. Os perfis de apps e a aparência são mantidos.');
  if (!ok) return;
  state.defaultProfile.mappings = [];
  for (const profile of Object.values(state.appProfiles)) profile.mappings = [];
  state.scrollThreshold = 4;
  state.suppressOriginalScroll = true;
  thresholdInput.value = state.scrollThreshold;
  suppressScrollInput.checked = state.suppressOriginalScroll;
  renderMappings();
  scheduleSave();
});

// ---- Accessibility permission ----

function renderPermission(granted) {
  const card = document.getElementById('perm-card');
  card.classList.toggle('granted', granted);
  document.getElementById('permTitle').textContent = granted ? '✓ Acessibilidade concedida' : 'Permissão de Acessibilidade';
  const text = document.getElementById('permText');
  text.textContent = granted
    ? 'O remapeamento está pronto para funcionar.'
    : 'Necessária para interceptar eventos do mouse. Sem ela, nenhum mapeamento funciona. O app detecta a permissão sozinho assim que você a conceder.';
  text.className = granted ? 'small ok' : 'small warn';
  document.getElementById('permBtn').hidden = granted;
}

async function refreshPermission() {
  if (document.hidden) return;
  renderPermission(await window.api.getPermission());
}

document.getElementById('permBtn').addEventListener('click', () => window.api.openAccessibilityPrefs());

// ---- Login item ----

async function initLoginItem() {
  const input = document.getElementById('loginItem');
  const { supported, enabled } = await window.api.getLogin();
  input.checked = enabled;
  if (!supported) {
    input.disabled = true;
    document.getElementById('loginHint').textContent = 'Disponível apenas no app empacotado (npm run dist).';
  }
  input.addEventListener('change', async () => {
    const ok = await window.api.setLogin(input.checked);
    if (!ok) input.checked = !input.checked;
  });
}

// ---- Mouse scroll adjustments ----

const scrollInvertInput = document.getElementById('scrollInvert');
const scrollSpeedInput = document.getElementById('scrollSpeed');
const scrollAccelInput = document.getElementById('scrollAccel');
const scrollSmoothInput = document.getElementById('scrollSmooth');

function renderScrollSettings() {
  scrollInvertInput.checked = state.scroll.invert;
  scrollSpeedInput.value = state.scroll.speed;
  scrollAccelInput.value = Math.round(state.scroll.acceleration * 100);
  document.getElementById('scrollSpeedValue').textContent = `${Number(state.scroll.speed).toFixed(1)}×`;
  document.getElementById('scrollAccelValue').textContent = `${Math.round(state.scroll.acceleration * 100)}%`;
  scrollSmoothInput.value = Math.round(state.scroll.smoothing * 100);
  document.getElementById('scrollSmoothValue').textContent = state.scroll.smoothing === 0 ? 'off' : `${Math.round(state.scroll.smoothing * 100)}%`;
}

scrollInvertInput.addEventListener('change', () => {
  state.scroll.invert = scrollInvertInput.checked;
  scheduleSave();
});
scrollSpeedInput.addEventListener('input', () => {
  state.scroll.speed = parseFloat(scrollSpeedInput.value);
  renderScrollSettings();
  scheduleSave();
});
scrollAccelInput.addEventListener('input', () => {
  state.scroll.acceleration = parseInt(scrollAccelInput.value, 10) / 100;
  renderScrollSettings();
  scheduleSave();
});

scrollSmoothInput.addEventListener('input', () => {
  state.scroll.smoothing = parseInt(scrollSmoothInput.value, 10) / 100;
  renderScrollSettings();
  scheduleSave();
});

// Fills the whole UI from a config; used at startup and after an import.
async function loadState(cfg) {
  state = cfg;
  state.scroll = { invert: false, speed: 1, acceleration: 0, smoothing: 0, ...state.scroll };
  selectedProfile = 'default';
  renderTheme();
  thresholdInput.value = state.scrollThreshold;
  suppressScrollInput.checked = state.suppressOriginalScroll;
  renderScrollSettings();
  renderProfiles();
  renderMappings();
  await renderAppList();
}

// ---- Export / import ----

document.getElementById('exportBtn').addEventListener('click', async () => {
  if (saveTimer) await saveNow(); // export what is on screen
  const res = await window.api.exportConfig();
  if (res.ok) setStatus(`Configuração exportada em ${res.path}`, 'ok');
});

document.getElementById('importBtn').addEventListener('click', async () => {
  const ok = confirm('Importar configuração?\n\nIsso substitui todos os perfis, mapeamentos e ajustes atuais (a aparência é mantida). Exporte antes se quiser guardar a configuração de agora.');
  if (!ok) return;
  clearTimeout(saveTimer); // a pending autosave must not overwrite what is about to be imported
  saveTimer = null;
  const res = await window.api.importConfig();
  if (res.canceled) return;
  if (res.error) {
    setStatus(`Não foi possível importar: ${res.error}`, 'warn');
    return;
  }
  await loadState(res.config);
  const note = res.dropped ? ` (${res.dropped} ${res.dropped === 1 ? 'item inválido ignorado' : 'itens inválidos ignorados'})` : '';
  setStatus(`Configuração importada${note}.`, 'ok');
});

async function init() {
  initLoginItem();
  refreshPermission();
  setInterval(refreshPermission, 2000);
  await loadState(await window.api.getConfig());
}

init();
