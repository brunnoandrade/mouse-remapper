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

const sections = ['scrollUp', 'scrollDown', 'middleClick'];
let state = null;

function buildModifiersUI(container, mapping, onChange) {
  container.innerHTML = '';
  const names = [['command', '⌘'], ['option', '⌥'], ['control', '⌃'], ['shift', '⇧']];
  for (const [key, glyph] of names) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!(mapping.flags & FLAG[key]);
    cb.addEventListener('change', () => {
      mapping.flags = cb.checked ? (mapping.flags | FLAG[key]) : (mapping.flags & ~FLAG[key]);
      onChange();
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(glyph));
    container.appendChild(label);
  }
}

function renderSection(name) {
  const card = document.querySelector(`[data-section="${name}"]`);
  const mapping = state[name];
  const enabledCb = card.querySelector('.enabled');
  const keyBtn = card.querySelector('.capture-key');
  const modsContainer = card.querySelector('.modifiers');

  enabledCb.checked = mapping.enabled;
  enabledCb.onchange = () => { mapping.enabled = enabledCb.checked; };

  keyBtn.textContent = MAC_TO_LABEL[mapping.keyCode] || `código ${mapping.keyCode}`;
  keyBtn.onclick = () => {
    keyBtn.textContent = 'pressione uma tecla...';
    keyBtn.classList.add('capturing');
    const handler = (e) => {
      e.preventDefault();
      const mac = CODE_TO_MAC[e.code];
      if (mac !== undefined) {
        mapping.keyCode = mac;
        keyBtn.textContent = MAC_TO_LABEL[mac] || e.code;
      } else {
        keyBtn.textContent = MAC_TO_LABEL[mapping.keyCode] || `código ${mapping.keyCode}`;
        setStatus('Tecla não suportada, tente outra.', 'warn');
      }
      keyBtn.classList.remove('capturing');
      window.removeEventListener('keydown', handler, true);
    };
    window.addEventListener('keydown', handler, true);
  };

  buildModifiersUI(modsContainer, mapping, () => {});
}

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
}

const appSearchInput = document.getElementById('appSearch');
const appDropdown = document.getElementById('appDropdown');
appSearchInput.addEventListener('focus', () => renderDropdown(appSearchInput.value));
appSearchInput.addEventListener('input', () => renderDropdown(appSearchInput.value));
appSearchInput.addEventListener('blur', () => {
  setTimeout(() => { appDropdown.hidden = true; }, 100);
});

document.getElementById('refreshApps').addEventListener('click', renderAppList);

async function init() {
  state = await window.api.getConfig();
  for (const name of sections) renderSection(name);
  document.getElementById('threshold').value = state.scrollThreshold;
  document.getElementById('suppressScroll').checked = state.suppressOriginalScroll;
  document.getElementById('suppressMiddle').checked = state.suppressOriginalMiddleClick;
  await renderAppList();
}

document.getElementById('saveBtn').addEventListener('click', async () => {
  state.scrollThreshold = parseFloat(document.getElementById('threshold').value) || 4;
  state.suppressOriginalScroll = document.getElementById('suppressScroll').checked;
  state.suppressOriginalMiddleClick = document.getElementById('suppressMiddle').checked;
  await window.api.setConfig(state);
  setStatus('Salvo. As alterações já estão ativas.', 'ok');
  setTimeout(() => setStatus(''), 3000);
});

function openAccessibilityPrefs() {
  window.api.openAccessibilityPrefs();
}
window.openAccessibilityPrefs = openAccessibilityPrefs;

init();
