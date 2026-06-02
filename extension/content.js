// ============================================================
//  NEXTRA CRM — WhatsApp Web Content Script
// ============================================================

const STAGES = [
  { id: 'novo',       label: 'Novo Lead',   emoji: '🆕', color: '#6b7280' },
  { id: 'contato',    label: 'Em Contato',  emoji: '💬', color: '#6172f3' },
  { id: 'proposta',   label: 'Proposta',    emoji: '📄', color: '#fbbf24' },
  { id: 'negociando', label: 'Negociando',  emoji: '🤝', color: '#f97316' },
  { id: 'fechado',    label: 'Fechado',     emoji: '✅', color: '#34d399' },
  { id: 'perdido',    label: 'Perdido',     emoji: '❌', color: '#ef4444' },
];

let db = { contacts: {}, columns: [], settings: {} };
let currentContactId   = null; // ID permanente (telefone ou fallback)
let currentContactName = null; // nome de exibição (pode mudar)
let panelOpen = false;
let S = null; // shadow root

// ── Storage ──────────────────────────────────────────────
function loadDB() {
  return new Promise(r => {
    chrome.storage.local.get(['nextra_db'], res => {
      if (res.nextra_db) db = res.nextra_db;
      if (!db.contacts) db.contacts = {};
      if (!db.columns)  db.columns  = [];
      if (!db.settings) db.settings = {};
      r();
    });
  });
}
function saveDB() { chrome.storage.local.set({ nextra_db: db }); }
function uid()    { return Math.random().toString(36).substr(2,9) + Date.now().toString(36); }

function ensureContact(id, name) {
  if (!db.contacts[id]) {
    db.contacts[id] = { id, name, stage: 'novo', tags: [], notes: [], addedAt: Date.now() };
    saveDB();
  } else if (name && db.contacts[id].name !== name) {
    // Nome mudou — atualiza sem criar novo registro!
    db.contacts[id].name = name;
    saveDB();
  }
  return db.contacts[id];
}
function updateContact(id, data) {
  db.contacts[id] = { ...ensureContact(id, currentContactName), ...data };
  if (data.stage === 'fechado') triggerWebhook('deal_fechado', db.contacts[id]);
  saveDB();
}
function triggerWebhook(event, contact) {
  const url = db.settings.webhookUrl;
  if (!url) return;
  fetch(url, { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ event, contact, agent: db.settings.agentName||'Agente', ts: Date.now() })
  }).catch(()=>{});
}

// ── Contact detection ─────────────────────────────────────
const NAME_SELECTORS = [
  'span[data-testid="conversation-info-header-chat-title"]',
  'div[data-testid="conversation-header"] span[dir="auto"]',
  'header span[dir="auto"]',
];

// Extrai o número de telefone do DOM (mensagens têm data-id com o número)
function detectPhoneFromDOM() {
  const msgs = document.querySelectorAll('[data-id]');
  for (const msg of msgs) {
    const id = msg.getAttribute('data-id') || '';
    // Formato: "true_5511999999999@c.us_MSGID" (individual) — ignora grupos (@g.us)
    const m = id.match(/(?:true|false)_([\d]{7,15})@c\.us_/);
    if (m) return m[1];
  }
  return null;
}

function detectContact() {
  for (const sel of NAME_SELECTORS) {
    const el = document.querySelector(sel);
    if (el && el.textContent.trim()) {
      const name = el.textContent.trim();
      const phone = detectPhoneFromDOM();
      // ID = telefone se disponível, senão usa nome normalizado como fallback
      const id = phone ? phone : 'n_' + name.trim().toLowerCase().replace(/\s+/g,'_').substring(0,40);

      if (id !== currentContactId || name !== currentContactName) {
        currentContactId   = id;
        currentContactName = name;
        ensureContact(id, name);
        refreshBadge();
      }
      return;
    }
  }
}

// ── Inject ────────────────────────────────────────────────
function inject() {
  if (document.getElementById('nxt-host')) return;

  const host = document.createElement('div');
  host.id = 'nxt-host';
  host.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;';
  document.body.prepend(host);
  S = host.attachShadow({ mode: 'open' });

  // Empurra o WhatsApp 48px pra baixo (altura da toolbar)
  setWaPadding(48);

  S.innerHTML = `
<style>
*{box-sizing:border-box;margin:0;padding:0;}
:host{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:block;}

/* ── TOOLBAR ── */
#bar{
  height:48px;background:#0d0d18;border-bottom:1px solid #1f2937;
  display:flex;align-items:center;padding:0 12px;gap:10px;
}
.logo{font-size:11px;font-weight:800;color:#6366f1;letter-spacing:1px;
  white-space:nowrap;display:flex;align-items:center;gap:6px;}
.dot{width:7px;height:7px;border-radius:50%;background:#6366f1;
  animation:p 2s infinite;}
@keyframes p{0%,100%{opacity:1}50%{opacity:.3}}

#badge{flex:1;display:flex;align-items:center;gap:8px;overflow:hidden;min-width:0;}
.bname{font-size:13px;font-weight:600;color:#f9fafb;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;max-width:180px;}
.bstage{padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;
  white-space:nowrap;border:1px solid currentColor;}
.bsel{background:#1a2234;border:1px solid #1f2937;border-radius:7px;color:#d1d5db;
  font-size:11px;padding:3px 6px;cursor:pointer;outline:none;}
.bsel:focus{border-color:#6366f1;}
.ghost{color:#4b5563;font-size:12px;}

.bar-actions{display:flex;gap:6px;align-items:center;margin-left:auto;flex-shrink:0;}
.btn{padding:5px 12px;border-radius:7px;font-size:11px;font-weight:700;
  cursor:pointer;border:none;transition:all .15s;white-space:nowrap;}
.btn-p{background:#6366f1;color:#fff;}.btn-p:hover{background:#4f46e5;}
.btn-g{background:transparent;color:#6b7280;border:1px solid #2d3748;}
.btn-g:hover{border-color:#6366f1;color:#818cf8;}
.btn-w{background:#92400e;color:#fcd34d;border:1px solid #d97706;}
.btn-w:hover{background:#b45309;}
.btn-teal{background:#0f4c4c;color:#5eead4;border:1px solid #0d9488;}
.btn-teal:hover{background:#134e4a;}
.agenda-badge{background:#ef4444;color:#fff;border-radius:20px;
  padding:1px 5px;font-size:9px;font-weight:800;margin-left:3px;}

/* inline add-col input */
#new-col-wrap{display:none;align-items:center;gap:6px;}
#new-col-wrap.show{display:flex;}
#new-col-input{background:#1a2234;border:1px solid #6366f1;border-radius:7px;
  color:#f9fafb;padding:5px 10px;font-size:12px;outline:none;width:160px;}
.btn-xs{padding:4px 10px;font-size:11px;border-radius:6px;border:none;
  cursor:pointer;font-weight:700;}
.btn-xs-ok{background:#6366f1;color:#fff;}
.btn-xs-ok:hover{background:#4f46e5;}
.btn-xs-cancel{background:#1f2937;color:#9ca3af;}
.btn-xs-cancel:hover{background:#374151;}

/* ── PANEL ── */
#panel{
  position:fixed;top:48px;left:0;right:0;
  background:#080812;border-bottom:2px solid #1f2937;
  box-shadow:0 12px 40px rgba(0,0,0,.7);
  overflow:hidden;
  max-height:0;opacity:0;pointer-events:none;
  transition:max-height .25s ease,opacity .2s ease;
  z-index:2147483646;
}
#panel.open{max-height:220px;opacity:1;pointer-events:all;}

#cols-scroll{
  display:flex;height:210px;
  overflow-x:auto;overflow-y:hidden;
  padding:10px 14px;gap:10px;
}
#cols-scroll::-webkit-scrollbar{height:4px;}
#cols-scroll::-webkit-scrollbar-thumb{background:#1f2937;border-radius:2px;}

/* ── COLUMN ── */
.col{min-width:175px;max-width:175px;background:#111827;
  border:1px solid #1f2937;border-radius:10px;
  display:flex;flex-direction:column;flex-shrink:0;overflow:hidden;}
.col-head{display:flex;align-items:center;gap:4px;padding:7px 8px;
  background:#1a2234;border-bottom:1px solid #1f2937;min-height:34px;}
.col-name{flex:1;background:transparent;border:none;outline:none;
  color:#f9fafb;font-size:12px;font-weight:700;cursor:pointer;min-width:0;}
.col-name:focus{color:#818cf8;cursor:text;}
.col-n{background:rgba(99,102,241,.2);color:#818cf8;border-radius:20px;
  padding:1px 6px;font-size:10px;font-weight:700;flex-shrink:0;}
.col-del{background:none;border:none;color:#374151;cursor:pointer;
  font-size:14px;line-height:1;flex-shrink:0;transition:color .15s;}
.col-del:hover{color:#ef4444;}

.col-body{flex:1;overflow-y:auto;padding:5px;}
.col-body::-webkit-scrollbar{width:3px;}
.col-body::-webkit-scrollbar-thumb{background:#1f2937;}
.empty-col{font-size:10px;color:#374151;text-align:center;padding:14px 0;}

.lead{background:#1a2234;border:1px solid #1f2937;border-radius:7px;
  padding:6px 8px;margin-bottom:5px;cursor:pointer;
  transition:border-color .15s;position:relative;}
.lead:hover{border-color:#6366f1;}
.lead:hover .lead-x{opacity:1;}
.lname{font-size:11px;font-weight:600;color:#f9fafb;margin-bottom:2px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.lstage{font-size:10px;}
.lead-x{position:absolute;top:3px;right:5px;background:none;border:none;
  color:#4b5563;cursor:pointer;font-size:12px;opacity:0;transition:all .15s;}
.lead-x:hover{color:#ef4444;}

.col-add{display:flex;align-items:center;justify-content:center;
  margin:5px;padding:4px;background:none;
  border:1px dashed #1f2937;border-radius:6px;
  color:#4b5563;font-size:11px;cursor:pointer;transition:all .15s;flex-shrink:0;}
.col-add:hover{border-color:#6366f1;color:#818cf8;}

/* add col card */
.new-col-card{min-width:150px;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:4px;
  background:transparent;border:2px dashed #1f2937;border-radius:10px;
  cursor:pointer;transition:all .2s;flex-shrink:0;
  color:#4b5563;font-size:12px;font-weight:600;}
.new-col-card:hover{border-color:#6366f1;color:#818cf8;}
.new-col-card span{font-size:24px;}

/* toast */
#toast{position:fixed;bottom:22px;right:22px;background:#111827;
  border:1px solid #374151;border-radius:10px;padding:10px 16px;
  font-size:13px;font-weight:600;color:#f9fafb;z-index:2147483647;
  transition:all .3s;transform:translateY(60px);opacity:0;pointer-events:none;}
#toast.show{transform:translateY(0);opacity:1;}
#toast.ok{border-color:#34d399;color:#34d399;}
#toast.warn{border-color:#fbbf24;color:#fbbf24;}
</style>

<!-- TOOLBAR -->
<div id="bar">
  <div class="logo"><div class="dot"></div>NEXTRA CRM</div>
  <div id="badge"><span class="ghost">Abra um chat para gerenciar o lead</span></div>

  <div class="bar-actions">
    <!-- inline new column input -->
    <div id="new-col-wrap">
      <input id="new-col-input" placeholder="Nome da coluna..." maxlength="30">
      <button class="btn-xs btn-xs-ok" id="new-col-ok">✓</button>
      <button class="btn-xs btn-xs-cancel" id="new-col-cancel">✕</button>
    </div>

    <button class="btn btn-g" id="btn-toggle">▼ Colunas</button>
    <button class="btn btn-teal" id="btn-agenda">⏰<span class="agenda-badge" id="agenda-badge" style="display:none"></span></button>
    <button class="btn btn-p" id="btn-add-col">+ Coluna</button>
    <button class="btn btn-w" id="btn-disparo">📢 Disparo</button>
    <!-- ✂️ REMOVER APÓS TESTE — início -->
    <button class="btn btn-g" id="btn-importar">📥 Importar</button>
    <input type="file" id="csv-input" accept=".csv,.xlsx,.xls" style="display:none">
    <!-- ✂️ REMOVER APÓS TESTE — fim -->
  </div>
</div>

<!-- OVERLAY PANEL -->
<div id="panel">
  <div id="cols-scroll"></div>
</div>

<!-- TOAST -->
<div id="toast"></div>
`;

  // ── Wire up toolbar buttons ──
  S.getElementById('btn-toggle').addEventListener('click', togglePanel);
  S.getElementById('btn-add-col').addEventListener('click', showNewColInput);
  S.getElementById('btn-disparo').addEventListener('click', showDisparoModal);
  S.getElementById('btn-agenda').addEventListener('click', showAgendaList);
  // ✂️ REMOVER APÓS TESTE — início
  S.getElementById('btn-importar').addEventListener('click', () => S.getElementById('csv-input').click());
  S.getElementById('csv-input').addEventListener('change', handleCSVImport);
  // ✂️ REMOVER APÓS TESTE — fim

  // inline new-col
  const input   = S.getElementById('new-col-input');
  const okBtn   = S.getElementById('new-col-ok');
  const cancelB = S.getElementById('new-col-cancel');

  okBtn.addEventListener('click', () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    db.columns.push({ id: uid(), name, contactIds: [] });
    saveDB();
    hideNewColInput();
    renderCols();
    if (!panelOpen) togglePanel();
    toast('Coluna "' + name + '" criada!', 'ok');
  });
  cancelB.addEventListener('click', hideNewColInput);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') okBtn.click(); if (e.key === 'Escape') hideNewColInput(); });

  renderCols();
  refreshBadge();
  setTimeout(updateAgendaBadge, 500);

}

function showNewColInput() {
  const wrap = S.getElementById('new-col-wrap');
  const addBtn = S.getElementById('btn-add-col');
  wrap.classList.add('show');
  addBtn.style.display = 'none';
  setTimeout(() => S.getElementById('new-col-input').focus(), 50);
}
function hideNewColInput() {
  S.getElementById('new-col-wrap').classList.remove('show');
  S.getElementById('btn-add-col').style.display = '';
  S.getElementById('new-col-input').value = '';
}

// ── Panel toggle ──────────────────────────────────────────
function setWaPadding(px) {
  let style = document.getElementById('nxt-wa-push');
  if (!style) {
    style = document.createElement('style');
    style.id = 'nxt-wa-push';
    (document.head || document.documentElement).appendChild(style);
  }
  style.textContent = `
    #app {
      position: fixed !important;
      top: ${px}px !important;
      left: 0 !important; right: 0 !important; bottom: 0 !important;
      height: auto !important;
    }
  `;
}

function togglePanel() {
  panelOpen = !panelOpen;
  S.getElementById('panel').classList.toggle('open', panelOpen);
  S.getElementById('btn-toggle').textContent = panelOpen ? '▲ Fechar' : '▼ Colunas';
  setWaPadding(panelOpen ? 268 : 48);
}

// ── Badge ─────────────────────────────────────────────────
function refreshBadge() {
  if (!S) return;
  const badge = S.getElementById('badge');
  if (!currentContactId) {
    badge.innerHTML = '<span class="ghost">Abra um chat para gerenciar o lead</span>';
    return;
  }
  const c  = ensureContact(currentContactId, currentContactName);
  const st = STAGES.find(s => s.id === c.stage) || STAGES[0];
  badge.innerHTML = `
    <span class="bname">${currentContactName}</span>
    <span class="bstage" style="color:${st.color};border-color:${st.color};background:${st.color}18">
      ${st.emoji} ${st.label}
    </span>
    <select class="bsel" id="stage-sel">
      ${STAGES.map(s => `<option value="${s.id}"${c.stage===s.id?' selected':''}>${s.emoji} ${s.label}</option>`).join('')}
    </select>
    <button class="btn btn-p" style="font-size:10px;padding:4px 10px" id="btn-add-to-col">+ Coluna</button>
    <button class="btn btn-teal" style="font-size:10px;padding:4px 10px" id="btn-agendar">⏰ Agendar</button>
  `;
  S.getElementById('stage-sel').addEventListener('change', e => {
    updateContact(currentContactId, { stage: e.target.value });
    refreshBadge(); renderCols();
  });
  S.getElementById('btn-add-to-col').addEventListener('click', addCurrentToColumn);
  S.getElementById('btn-agendar').addEventListener('click', () => showScheduleModal(currentContactName));
}

// ── Add current contact to a column (inline select) ──────
function addCurrentToColumn() {
  if (!currentContactId) { toast('Abra um chat primeiro!', 'warn'); return; }
  if (!db.columns.length) { toast('Crie uma coluna primeiro!', 'warn'); showNewColInput(); return; }

  // Build a small floating picker right below the badge
  const existing = S.getElementById('col-picker');
  if (existing) { existing.remove(); return; }

  const picker = document.createElement('div');
  picker.id = 'col-picker';
  picker.style.cssText = `
    position:fixed;top:48px;left:50%;transform:translateX(-50%);
    background:#111827;border:1px solid #374151;border-radius:10px;
    padding:12px;z-index:2147483647;min-width:220px;
    box-shadow:0 8px 32px rgba(0,0,0,.8);
  `;
  picker.innerHTML = `
    <div style="font-size:11px;font-weight:700;color:#9ca3af;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px;">
      Adicionar "${(currentContactName||'').substring(0,20)}" a:
    </div>
    ${db.columns.map(col => `
      <button data-col="${col.id}" style="
        display:block;width:100%;text-align:left;
        background:#1a2234;border:1px solid #1f2937;border-radius:7px;
        color:#f9fafb;padding:8px 12px;margin-bottom:6px;
        font-size:12px;font-weight:600;cursor:pointer;transition:border-color .15s;
      " onmouseover="this.style.borderColor='#6366f1'" onmouseout="this.style.borderColor='#1f2937'">
        ${col.name} <span style="color:#6b7280;font-weight:400;font-size:10px">(${col.contactIds?.length||0})</span>
      </button>
    `).join('')}
    <button id="picker-cancel" style="
      display:block;width:100%;text-align:center;
      background:transparent;border:none;color:#4b5563;
      font-size:11px;cursor:pointer;padding:4px;margin-top:2px;
    ">Cancelar</button>
  `;

  S.appendChild(picker);

  picker.querySelectorAll('button[data-col]').forEach(btn => {
    btn.addEventListener('click', () => {
      const colId = btn.dataset.col;
      const col   = db.columns.find(c => c.id === colId);
      if (!col) return;
      if (!col.contactIds) col.contactIds = [];
      if (col.contactIds.includes(currentContactId)) { toast('Já está nessa coluna!', 'warn'); picker.remove(); return; }
      col.contactIds.push(currentContactId);
      saveDB(); renderCols(); picker.remove();
      toast(`Adicionado a "${col.name}"!`, 'ok');
    });
  });
  S.getElementById('picker-cancel').addEventListener('click', () => picker.remove());
  setTimeout(() => document.addEventListener('click', function handler(e) {
    if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener('click', handler); }
  }), 100);
}

// ── Render Columns ────────────────────────────────────────
function renderCols() {
  if (!S) return;
  const scroll = S.getElementById('cols-scroll');
  scroll.innerHTML = '';

  db.columns.forEach(col => {
    const leads = (col.contactIds || []).map(cid => {
      const c  = db.contacts[cid];
      if (!c) return '';
      const st = STAGES.find(s => s.id === c.stage) || STAGES[0];
      return `
        <div class="lead" data-cid="${cid}" title="Clique para abrir a conversa">
          <button class="lead-x" data-rm="${col.id}|${cid}">×</button>
          <div class="lname">${c.name || cid}</div>
          <div class="lstage" style="color:${st.color}">${st.emoji} ${st.label}</div>
          ${cid.match(/^\d+$/) ? `<div style="font-size:9px;color:#374151;">📱 ${cid}</div>` : ''}
        </div>`;
    }).join('');

    const colEl = document.createElement('div');
    colEl.className = 'col';
    colEl.innerHTML = `
      <div class="col-head">
        <input class="col-name" value="${col.name}" data-cid="${col.id}"
          title="Clique para renomear">
        <span class="col-n">${col.contactIds?.length || 0}</span>
        <button class="col-del" data-del="${col.id}">×</button>
      </div>
      <div class="col-body">
        ${leads || '<div class="empty-col">Vazio</div>'}
      </div>
      <button class="col-add" data-cadd="${col.id}">+ Adicionar contato atual</button>
    `;
    scroll.appendChild(colEl);
  });

  // "+ Nova Coluna" card
  const card = document.createElement('div');
  card.className = 'new-col-card';
  card.innerHTML = '<span>＋</span><div>Nova Coluna</div>';
  card.addEventListener('click', showNewColInput);
  scroll.appendChild(card);

  // Wire events — all via event delegation on scroll
  scroll.querySelectorAll('.col-name').forEach(inp => {
    inp.addEventListener('change', e => {
      const col = db.columns.find(c => c.id === e.target.dataset.cid);
      if (col && e.target.value.trim()) { col.name = e.target.value.trim(); saveDB(); }
    });
  });
  scroll.querySelectorAll('.col-del').forEach(btn => {
    btn.addEventListener('click', e => {
      const colId = e.target.dataset.del;
      db.columns = db.columns.filter(c => c.id !== colId);
      saveDB(); renderCols(); toast('Coluna excluída', 'warn');
    });
  });
  // Clique no card abre a conversa no WhatsApp
  scroll.querySelectorAll('.lead').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.classList.contains('lead-x')) return; // ignora clique no X
      const name = card.dataset.cid;
      if (name) openChat(name);
    });
  });

  scroll.querySelectorAll('.lead-x').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const [colId, cid] = e.target.dataset.rm.split('|');
      const col = db.columns.find(c => c.id === colId);
      if (col) { col.contactIds = col.contactIds.filter(id => id !== cid); saveDB(); renderCols(); }
    });
  });
  scroll.querySelectorAll('.col-add').forEach(btn => {
    btn.addEventListener('click', e => {
      const colId = e.target.dataset.cadd;
      if (!currentContactId) { toast('Abra um chat primeiro!', 'warn'); return; }
      const col = db.columns.find(c => c.id === colId);
      if (!col) return;
      if (!col.contactIds) col.contactIds = [];
      if (col.contactIds.includes(currentContactId)) { toast('Já está nessa coluna!', 'warn'); return; }
      col.contactIds.push(currentContactId);
      saveDB(); renderCols(); toast(`Adicionado a "${col.name}"!`, 'ok');
    });
  });
}

// ── Open Chat ─────────────────────────────────────────────
function openChat(cid) {
  if (panelOpen) togglePanel();
  // Busca pelo nome salvo no contato, não pelo ID
  const c = db.contacts[cid];
  const searchTerm = c ? c.name : cid;
  toast('Abrindo conversa...', 'ok');
  setTimeout(() => openBySearch(searchTerm), 300);
}

function findSearchInput() {
  return document.querySelector('input[aria-label="Pesquisar ou começar uma nova conversa"]') ||
         document.querySelector('input[aria-label="Search input textbox"]') ||
         document.querySelector('input[aria-label="Search or start new chat"]') ||
         document.querySelector('div[data-testid="chat-list-search-container"] input') ||
         document.querySelector('#side input[type="text"]');
}

function openBySearch(name) {
  const box = findSearchInput();
  if (!box) {
    toast('Não achei a busca — clique manualmente', 'warn');
    return;
  }

  // Focus and set value using native setter (works with React controlled inputs)
  box.focus();
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  nativeSetter.call(box, name);
  box.dispatchEvent(new Event('input', { bubbles: true }));

  // Wait for search results to render, then click the best match
  setTimeout(() => clickBestResult(box, name), 900);
}

function clickBestResult(box, name) {
  const nameLower = name.toLowerCase();
  const cells = [...document.querySelectorAll('[data-testid="cell-frame-container"]')];

  // Prefer exact name match, then partial first-word match, then first result
  let target = null;
  for (const cell of cells) {
    const span = cell.querySelector('span[dir="auto"]');
    if (span && span.textContent.trim().toLowerCase() === nameLower) { target = cell; break; }
  }
  if (!target) {
    const firstName = nameLower.split(' ')[0];
    for (const cell of cells) {
      const span = cell.querySelector('span[dir="auto"]');
      if (span && span.textContent.trim().toLowerCase().includes(firstName)) { target = cell; break; }
    }
  }
  if (!target && cells.length > 0) target = cells[0];

  if (target) {
    // Use coordinate-based click — WhatsApp Business ignores synthetic .click()
    const r = target.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };
    target.dispatchEvent(new MouseEvent('mouseover', opts));
    target.dispatchEvent(new MouseEvent('mousedown', opts));
    target.dispatchEvent(new MouseEvent('mouseup',   opts));
    target.dispatchEvent(new MouseEvent('click',     opts));

    // Clear the search box after chat opens
    setTimeout(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      const b = findSearchInput();
      if (b) {
        nativeSetter.call(b, '');
        b.dispatchEvent(new Event('input', { bubbles: true }));
        b.blur();
      }
    }, 500);
  } else {
    toast('Conversa não encontrada — verifique o nome', 'warn');
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const b = findSearchInput();
    if (b) { nativeSetter.call(b, ''); b.dispatchEvent(new Event('input', { bubbles: true })); }
  }
}

// ✂️ REMOVER APÓS TESTE — início
// ── Importar CSV de outro CRM ─────────────────────────────
function handleCSVImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const text = ev.target.result;
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) { toast('CSV vazio ou inválido', 'warn'); return; }

      // Detecta separador (vírgula ou ponto-e-vírgula)
      const sep = lines[0].includes(';') ? ';' : ',';
      const headers = lines[0].split(sep).map(h => h.replace(/"/g,'').trim().toLowerCase());

      // Tenta mapear colunas pelos nomes mais comuns de CRMs
      const findCol = (...names) => {
        for (const n of names) {
          const i = headers.findIndex(h => h.includes(n));
          if (i >= 0) return i;
        }
        return -1;
      };
      const iNome   = findCol('nome','name','contato','contact','cliente','lead');
      const iEtapa  = findCol('etapa','stage','status','fase','funil','pipeline');
      const iNota   = findCol('nota','note','obs','descrição','descricao','comment');

      // Se não achou coluna de nome, usa a primeira
      const nomeIdx = iNome >= 0 ? iNome : 0;

      let importados = 0, ignorados = 0;
      const linhasValidas = lines.slice(1);

      linhasValidas.forEach(line => {
        const cols = line.split(sep).map(c => c.replace(/^"|"$/g,'').trim());
        const nome = cols[nomeIdx];
        if (!nome || nome.length < 2) { ignorados++; return; }

        // Monta o contato
        if (!db.contacts[nome]) {
          db.contacts[nome] = { id: nome, name: nome, stage: 'novo', tags: [], notes: [], addedAt: Date.now() };
        }
        // Importa etapa se existir
        if (iEtapa >= 0 && cols[iEtapa]) {
          const etapaRaw = cols[iEtapa].toLowerCase();
          const mapa = { fechado:'fechado', closed:'fechado', ganho:'fechado', won:'fechado', perdido:'perdido', lost:'perdido', negociando:'negociando', proposta:'proposta', contato:'contato', novo:'novo', new:'novo' };
          const etapa = Object.entries(mapa).find(([k]) => etapaRaw.includes(k));
          if (etapa) db.contacts[nome].stage = etapa[1];
        }
        // Importa nota se existir
        if (iNota >= 0 && cols[iNota]) {
          db.contacts[nome].notes = [{ text: cols[iNota], date: Date.now() }];
        }
        importados++;
      });

      saveDB();
      // Limpa o input para permitir reimportar o mesmo arquivo
      e.target.value = '';

      // Mostra resultado
      const modal = document.createElement('div');
      modal.style.cssText = 'position:fixed;top:54px;right:12px;background:#111827;border:1px solid #374151;border-radius:12px;padding:18px;z-index:2147483647;width:300px;box-shadow:0 16px 48px rgba(0,0,0,.9);';
      modal.innerHTML = `
        <div style="font-size:13px;font-weight:800;color:#f9fafb;margin-bottom:10px;">📥 Importação concluída</div>
        <div style="font-size:12px;color:#34d399;margin-bottom:4px;">✅ ${importados} contatos importados</div>
        ${ignorados ? `<div style="font-size:12px;color:#6b7280;margin-bottom:4px;">⏭ ${ignorados} linhas ignoradas (sem nome)</div>` : ''}
        <div style="font-size:11px;color:#6b7280;margin-top:8px;margin-bottom:12px;">Os contatos estão disponíveis para adicionar às colunas.</div>
        <button id="imp-ok" style="width:100%;padding:8px;background:#6366f1;color:#fff;font-weight:700;font-size:12px;border:none;border-radius:7px;cursor:pointer;">OK</button>
      `;
      S.appendChild(modal);
      S.getElementById('imp-ok').addEventListener('click', () => modal.remove());
      setTimeout(() => modal.remove(), 8000);

    } catch(err) {
      toast('Erro ao ler o arquivo — verifique se é CSV válido', 'warn');
      e.target.value = '';
    }
  };
  reader.readAsText(file, 'UTF-8');
}
// ✂️ REMOVER APÓS TESTE — fim

// ── Agendamento de Mensagens ──────────────────────────────
function getScheduled() {
  return new Promise(r => {
    chrome.storage.local.get(['nextra_scheduled'], res => r(res.nextra_scheduled || []));
  });
}
function saveScheduled(list) {
  chrome.storage.local.set({ nextra_scheduled: list });
}

function updateAgendaBadge() {
  getScheduled().then(list => {
    const pending = list.filter(s => s.status === 'pending').length;
    const badge = S && S.getElementById('agenda-badge');
    if (!badge) return;
    if (pending > 0) { badge.textContent = pending; badge.style.display = 'inline'; }
    else { badge.style.display = 'none'; }
  });
}

function showScheduleModal(contact) {
  const existing = S.getElementById('sched-modal');
  if (existing) { existing.remove(); return; }

  // Default date = today, time = 09:00
  const now = new Date();
  const defaultDate = now.toISOString().split('T')[0];
  const defaultTime = '09:00';

  const modal = document.createElement('div');
  modal.id = 'sched-modal';
  modal.style.cssText = 'position:fixed;top:54px;right:12px;background:#111827;border:1px solid #374151;border-radius:14px;padding:18px;z-index:2147483647;width:340px;box-shadow:0 20px 60px rgba(0,0,0,.9);';

  modal.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <div style="font-size:14px;font-weight:800;color:#f9fafb;">⏰ Agendar Mensagem</div>
      <button id="sc-close" style="background:none;border:none;color:#6b7280;font-size:20px;cursor:pointer;line-height:1;">×</button>
    </div>

    <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">Contato</div>
    <input id="sc-contact" value="${contact || ''}" placeholder="Nome exato do contato no WhatsApp"
      style="width:100%;background:#1a2234;border:1px solid #374151;border-radius:8px;color:#f9fafb;padding:9px 11px;font-size:13px;outline:none;margin-bottom:12px;">

    <div style="display:flex;gap:10px;margin-bottom:12px;">
      <div style="flex:1;">
        <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">Data</div>
        <input id="sc-date" type="date" value="${defaultDate}"
          style="width:100%;background:#1a2234;border:1px solid #374151;border-radius:8px;color:#f9fafb;padding:9px 8px;font-size:12px;outline:none;cursor:pointer;">
      </div>
      <div style="flex:1;">
        <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">Horário</div>
        <input id="sc-time" type="time" value="${defaultTime}"
          style="width:100%;background:#1a2234;border:1px solid #374151;border-radius:8px;color:#f9fafb;padding:9px 8px;font-size:12px;outline:none;cursor:pointer;">
      </div>
    </div>

    <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">Mensagem</div>
    <textarea id="sc-msg" placeholder="Oi {nome}! Passando para dar aquele retorno que você pediu 😊" style="width:100%;height:80px;background:#1a2234;border:1px solid #374151;border-radius:8px;color:#f9fafb;padding:10px;font-size:12px;resize:vertical;outline:none;font-family:inherit;line-height:1.5;margin-bottom:4px;"></textarea>
    <div style="font-size:10px;color:#4b5563;margin-bottom:12px;">Use <span style="color:#818cf8;font-weight:700;">{nome}</span> para o primeiro nome do contato.</div>

    <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">🖼️ Imagem (opcional)</div>
    <div id="sc-img-preview" style="display:none;margin-bottom:8px;text-align:center;">
      <img id="sc-img-thumb" style="max-width:100%;max-height:110px;border-radius:8px;border:1px solid #374151;object-fit:cover;">
      <div style="margin-top:6px;">
        <button id="sc-img-remove" style="background:#7f1d1d;border:none;color:#fca5a5;padding:4px 12px;border-radius:6px;font-size:11px;cursor:pointer;">✕ Remover imagem</button>
      </div>
    </div>
    <label id="sc-img-label" style="display:flex;align-items:center;gap:8px;background:#1a2234;border:1px dashed #374151;border-radius:8px;padding:10px 14px;cursor:pointer;color:#9ca3af;font-size:12px;margin-bottom:4px;">
      <span style="font-size:16px;">📎</span> Clique para anexar uma imagem
      <input id="sc-img-input" type="file" accept="image/*" style="display:none;">
    </label>
    <div style="font-size:10px;color:#4b5563;margin-bottom:12px;">Imagem enviada como legenda. Máx. 2 MB.</div>

    <div style="background:#0c1a0c;border:1px solid #14532d;border-radius:8px;padding:9px 11px;margin-bottom:14px;font-size:11px;color:#86efac;line-height:1.5;">
      ℹ️ O WhatsApp precisa estar aberto no computador no horário agendado.<br>
      Se não estiver, a extensão abrirá automaticamente.
    </div>

    <button id="sc-save" style="width:100%;padding:11px;background:#0d9488;color:#fff;font-weight:800;font-size:13px;border:none;border-radius:8px;cursor:pointer;">⏰ Agendar Mensagem</button>
  `;

  S.appendChild(modal);

  S.getElementById('sc-close').addEventListener('click', () => modal.remove());

  // Image handling
  let _imgBase64 = null;
  S.getElementById('sc-img-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast('Imagem muito grande! Máx. 2 MB.', 'warn'); return; }
    compressImage(file).then(b64 => {
      _imgBase64 = b64;
      S.getElementById('sc-img-thumb').src = b64;
      S.getElementById('sc-img-preview').style.display = '';
      S.getElementById('sc-img-label').style.display = 'none';
    });
  });
  S.getElementById('sc-img-remove').addEventListener('click', () => {
    _imgBase64 = null;
    S.getElementById('sc-img-input').value = '';
    S.getElementById('sc-img-preview').style.display = 'none';
    S.getElementById('sc-img-label').style.display = '';
  });

  S.getElementById('sc-save').addEventListener('click', async () => {
    const contact  = S.getElementById('sc-contact').value.trim();
    const dateStr  = S.getElementById('sc-date').value;
    const timeStr  = S.getElementById('sc-time').value;
    const message  = S.getElementById('sc-msg').value.trim();

    if (!contact) { toast('Digite o nome do contato!', 'warn'); return; }
    if (!dateStr)  { toast('Escolha a data!', 'warn'); return; }
    if (!timeStr)  { toast('Escolha o horário!', 'warn'); return; }
    if (!message && !_imgBase64) { toast('Digite uma mensagem ou anexe uma imagem!', 'warn'); return; }

    const scheduledAt = new Date(`${dateStr}T${timeStr}:00`).getTime();
    if (scheduledAt <= Date.now()) { toast('Escolha uma data/hora no futuro!', 'warn'); return; }

    const id = 'nxt_' + uid();
    const item = { id, contact, message, imageBase64: _imgBase64 || null, scheduledAt, status: 'pending', createdAt: Date.now() };

    // Salva no storage
    const list = await getScheduled();
    list.push(item);
    saveScheduled(list);

    // Cria o alarme no service worker
    chrome.runtime.sendMessage({ type: 'nxt_create_alarm', id, when: scheduledAt });

    modal.remove();
    updateAgendaBadge();

    const dtLabel = new Date(scheduledAt).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    toast(`⏰ Agendado para ${contact} em ${dtLabel}`, 'ok');
  });
}

function showAgendaList() {
  const existing = S.getElementById('agenda-modal');
  if (existing) { existing.remove(); return; }

  getScheduled().then(list => {
    const modal = document.createElement('div');
    modal.id = 'agenda-modal';
    modal.style.cssText = 'position:fixed;top:54px;right:12px;background:#111827;border:1px solid #374151;border-radius:14px;padding:18px;z-index:2147483647;width:360px;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.9);';

    const sorted = [...list].sort((a,b) => a.scheduledAt - b.scheduledAt);
    const statusLabel = { pending: '⏳ Pendente', sent: '✅ Enviada', failed: '❌ Falhou' };
    const statusColor = { pending: '#fbbf24', sent: '#34d399', failed: '#ef4444' };

    const itemsHTML = sorted.length
      ? sorted.map(s => {
          const dt = new Date(s.scheduledAt).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
          const isPending = s.status === 'pending';
          return `<div style="background:#1a2234;border:1px solid #1f2937;border-radius:8px;padding:10px 12px;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
              <div>
                <div style="font-size:12px;font-weight:700;color:#f9fafb;">${s.contact}</div>
                <div style="font-size:11px;color:#6b7280;margin-top:1px;">📅 ${dt}</div>
              </div>
              <span style="font-size:10px;font-weight:700;color:${statusColor[s.status]||'#6b7280'}">${statusLabel[s.status]||s.status}</span>
            </div>
            <div style="font-size:11px;color:#9ca3af;line-height:1.4;white-space:pre-wrap;">${s.message.substring(0,100)}${s.message.length>100?'…':''}</div>
            ${isPending ? `<button data-cancel="${s.id}" style="margin-top:8px;background:none;border:1px solid #374151;border-radius:5px;color:#6b7280;font-size:10px;padding:3px 8px;cursor:pointer;">Cancelar</button>` : ''}
          </div>`;
        }).join('')
      : '<div style="text-align:center;color:#4b5563;font-size:12px;padding:24px;">Nenhuma mensagem agendada.</div>';

    modal.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div style="font-size:14px;font-weight:800;color:#f9fafb;">⏰ Mensagens Agendadas</div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button id="ag-new" style="font-size:11px;background:#0d9488;color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-weight:700;">+ Nova</button>
          <button id="ag-close" style="background:none;border:none;color:#6b7280;font-size:20px;cursor:pointer;line-height:1;">×</button>
        </div>
      </div>
      <div id="ag-list">${itemsHTML}</div>
    `;

    S.appendChild(modal);
    S.getElementById('ag-close').addEventListener('click', () => modal.remove());
    S.getElementById('ag-new').addEventListener('click', () => {
      modal.remove();
      detectContact(); // captura o contato aberto na hora (igual ao botão verde)
      showScheduleModal(currentContactName || '');
    });

    modal.querySelectorAll('button[data-cancel]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.cancel;
        chrome.runtime.sendMessage({ type: 'nxt_cancel_alarm', id });
        const upd = await getScheduled();
        const idx = upd.findIndex(s => s.id === id);
        if (idx >= 0) { upd.splice(idx, 1); saveScheduled(upd); }
        modal.remove();
        showAgendaList();
        updateAgendaBadge();
        toast('Agendamento cancelado', 'warn');
      });
    });
  });
}

// ── Listener para envio agendado (vindo do background) ────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'nxt_send_scheduled') {
    const item = msg.item;
    const sendPromise = item.imageBase64
      ? (async () => {
          await openChatForDisparo(item.contact);
          await sleep(1800);
          const sent = await sendImageToWhatsApp(item.imageBase64, item.message || '');
          if (!sent) throw new Error('Falha ao enviar imagem');
        })()
      : disparoSend(item.contact, item.message);
    sendPromise
      .then(async () => {
        const list = await getScheduled();
        const idx = list.findIndex(s => s.id === item.id);
        if (idx >= 0) { list[idx].status = 'sent'; list[idx].sentAt = Date.now(); saveScheduled(list); }
        updateAgendaBadge();
        toast(`✅ Mensagem agendada enviada para ${item.contact}!`, 'ok');
        sendResponse({ ok: true });
      })
      .catch(async e => {
        const list = await getScheduled();
        const idx = list.findIndex(s => s.id === item.id);
        if (idx >= 0) { list[idx].status = 'failed'; saveScheduled(list); }
        updateAgendaBadge();
        toast(`❌ Falha ao enviar para ${item.contact}`, 'warn');
        sendResponse({ ok: false });
      });
    return true; // Async response
  }
});

// ── Disparo em Massa ──────────────────────────────────────
function showDisparoModal() {
  const existing = S.getElementById('disparo-modal');
  if (existing) { existing.remove(); return; }

  const contacts = Object.values(db.contacts);
  const contactsHTML = contacts.length
    ? contacts.map(c => {
        const st = STAGES.find(s => s.id === c.stage) || STAGES[0];
        return `<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;">
          <input type="checkbox" data-contact="${c.name.replace(/"/g,'&quot;')}" style="cursor:pointer;accent-color:#6366f1;width:14px;height:14px;">
          <span style="font-size:12px;color:#f9fafb;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.name}</span>
          <span style="font-size:10px;color:#6b7280;">${st.emoji}</span>
        </label>`;
      }).join('')
    : '<div style="text-align:center;color:#4b5563;font-size:12px;padding:16px;">Nenhum contato no CRM ainda.<br>Abra chats no WhatsApp para adicioná-los.</div>';

  const modal = document.createElement('div');
  modal.id = 'disparo-modal';
  modal.style.cssText = 'position:fixed;top:54px;right:12px;background:#111827;border:1px solid #374151;border-radius:14px;padding:18px;z-index:2147483647;width:360px;max-height:calc(100vh - 70px);overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.9);';

  modal.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <div style="font-size:14px;font-weight:800;color:#f9fafb;">📢 Disparo em Massa</div>
      <button id="dc" style="background:none;border:none;color:#6b7280;font-size:20px;cursor:pointer;line-height:1;">×</button>
    </div>

    <div style="background:#1a0a0a;border:1px solid #7f1d1d;border-radius:8px;padding:9px 11px;margin-bottom:13px;">
      <div style="font-size:11px;color:#fca5a5;font-weight:700;margin-bottom:3px;">⚠️ Risco de banimento</div>
      <div style="font-size:11px;color:#f87171;line-height:1.5;">Use apenas com contatos que já conversaram com você. Delay mínimo recomendado: 20s.</div>
    </div>

    <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">Mensagem</div>
    <textarea id="d-msg" placeholder="Olá {nome}, tudo bem?&#10;&#10;Escreva sua mensagem aqui..." style="width:100%;height:100px;background:#1a2234;border:1px solid #374151;border-radius:8px;color:#f9fafb;padding:10px;font-size:12px;resize:vertical;outline:none;font-family:inherit;line-height:1.5;"></textarea>
    <div style="font-size:10px;color:#4b5563;margin-top:3px;margin-bottom:12px;">Use <span style="color:#818cf8;font-weight:700;">{nome}</span> para inserir o nome do contato automaticamente.</div>

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;">
      <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px;">Delay entre mensagens</div>
      <span id="d-dv" style="font-size:12px;font-weight:700;color:#6366f1;">25s</span>
    </div>
    <input type="range" id="d-delay" min="10" max="90" value="25" style="width:100%;accent-color:#6366f1;cursor:pointer;margin-bottom:3px;">
    <div style="display:flex;justify-content:space-between;font-size:10px;color:#4b5563;margin-bottom:13px;"><span>10s ⚠️</span><span>90s ✅</span></div>

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px;">Contatos (<span id="d-sel-n">0</span> selecionados)</div>
      <div style="display:flex;gap:10px;">
        <button id="d-all" style="font-size:10px;color:#6366f1;background:none;border:none;cursor:pointer;font-weight:700;">Todos</button>
        <button id="d-none" style="font-size:10px;color:#6b7280;background:none;border:none;cursor:pointer;">Nenhum</button>
      </div>
    </div>
    <div id="d-contacts" style="max-height:150px;overflow-y:auto;border:1px solid #1f2937;border-radius:8px;padding:4px;margin-bottom:13px;">${contactsHTML}</div>

    <div id="d-prog" style="display:none;margin-bottom:11px;">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;margin-bottom:5px;">
        <span>Enviando...</span><span><span id="d-cur">0</span> / <span id="d-tot">0</span></span>
      </div>
      <div style="background:#1f2937;border-radius:4px;height:5px;">
        <div id="d-bar" style="background:#6366f1;height:100%;border-radius:4px;width:0;transition:width .4s;"></div>
      </div>
    </div>

    <button id="d-start" style="width:100%;padding:11px;background:#6366f1;color:#fff;font-weight:800;font-size:13px;border:none;border-radius:8px;cursor:pointer;">📢 Iniciar Disparo</button>
  `;

  S.appendChild(modal);

  const updateCount = () => {
    const n = modal.querySelectorAll('input[type="checkbox"]:checked').length;
    S.getElementById('d-sel-n').textContent = n;
  };
  modal.addEventListener('change', updateCount);

  S.getElementById('dc').addEventListener('click', () => modal.remove());
  S.getElementById('d-delay').addEventListener('input', e => {
    S.getElementById('d-dv').textContent = e.target.value + 's';
  });
  S.getElementById('d-all').addEventListener('click', () => {
    modal.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    updateCount();
  });
  S.getElementById('d-none').addEventListener('click', () => {
    modal.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    updateCount();
  });
  S.getElementById('d-start').addEventListener('click', () => {
    const msg = S.getElementById('d-msg').value.trim();
    if (!msg) { toast('Digite a mensagem primeiro!', 'warn'); return; }
    const selected = [...modal.querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.dataset.contact);
    if (!selected.length) { toast('Selecione pelo menos 1 contato!', 'warn'); return; }
    const delay = parseInt(S.getElementById('d-delay').value) * 1000;
    runDisparo(selected, msg, delay, modal);
  });
}

async function runDisparo(contacts, message, delay, modal) {
  const startBtn = S.getElementById('d-start');
  const prog     = S.getElementById('d-prog');
  const dCur     = S.getElementById('d-cur');
  const dTot     = S.getElementById('d-tot');
  const dBar     = S.getElementById('d-bar');

  startBtn.disabled = true;
  startBtn.textContent = '⏳ Enviando...';
  startBtn.style.background = '#374151';
  prog.style.display = 'block';
  dTot.textContent = contacts.length;

  let sent = 0, failed = 0;

  for (let i = 0; i < contacts.length; i++) {
    const name = contacts[i];
    dCur.textContent = i + 1;
    dBar.style.width = Math.round((i / contacts.length) * 100) + '%';
    toast(`Enviando para ${name}... (${i + 1}/${contacts.length})`, 'ok');

    const personalMsg = message.replace(/\{nome\}/gi, name.split(' ')[0]);
    try {
      await disparoSend(name, personalMsg);
      sent++;
    } catch (e) {
      failed++;
      toast(`Falha: ${name}`, 'warn');
    }

    if (i < contacts.length - 1) await sleep(delay);
  }

  dBar.style.width = '100%';
  await sleep(600);
  modal.remove();
  toast(`✅ Disparo pronto! ${sent} enviados${failed ? ` · ${failed} falhas` : ''}`, 'ok');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function compressImage(file, maxW = 900, quality = 0.75) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function sendImageToWhatsApp(base64, caption) {
  // Convert base64 to File
  const res = await fetch(base64);
  const blob = await res.blob();
  const file = new File([blob], 'imagem.jpg', { type: 'image/jpeg' });

  // Find WhatsApp's hidden file input for images (inside attachment menu)
  // First try: look for existing file inputs
  let fileInput = [...document.querySelectorAll('input[type="file"]')]
    .find(i => i.accept && (i.accept.includes('image') || i.accept.includes('video')));

  if (!fileInput) {
    // Click the attach button to reveal the inputs
    const attachBtn = document.querySelector('[data-testid="attach-menu-icon"]') ||
      document.querySelector('span[data-icon="attach-menu-plus"]')?.closest('button') ||
      document.querySelector('button[title="Anexar"]');
    if (attachBtn) {
      attachBtn.click();
      await sleep(600);
      fileInput = [...document.querySelectorAll('input[type="file"]')]
        .find(i => i.accept && (i.accept.includes('image') || i.accept.includes('video')));
    }
  }

  if (!fileInput) return false;

  const dt = new DataTransfer();
  dt.items.add(file);
  Object.defineProperty(fileInput, 'files', { value: dt.files, configurable: true, writable: true });
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(2000); // Wait for WhatsApp preview

  // Add caption if provided
  if (caption) {
    const captionInput = document.querySelector('[data-testid="media-caption-input"]') ||
      document.querySelector('div[contenteditable][data-tab]');
    if (captionInput) {
      captionInput.focus();
      document.execCommand('insertText', false, caption);
      await sleep(300);
    }
  }

  // Click send
  const sendBtn = document.querySelector('[data-testid="send"]') ||
    document.querySelector('button[aria-label="Enviar"]');
  if (sendBtn) { sendBtn.click(); return true; }
  return false;
}

function findMessageInput() {
  return document.querySelector('[data-testid="conversation-compose-box-input"]') ||
         document.querySelector('div[data-tab="10"][contenteditable="true"]') ||
         document.querySelector('div[aria-label="Digite uma mensagem"]') ||
         document.querySelector('div[aria-label="Type a message"]') ||
         (() => {
           const all = [...document.querySelectorAll('div[contenteditable="true"]')];
           return all.find(el => {
             const r = el.getBoundingClientRect();
             return r.left > 500 && r.width > 400;
           });
         })();
}

async function disparoSend(name, message) {
  // 1. Open chat
  await openChatForDisparo(name);
  // 2. Wait for chat to render
  await sleep(1800);
  // 3. Find compose box
  const msgBox = findMessageInput();
  if (!msgBox) throw new Error('compose box not found');
  // 4. Type message
  msgBox.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);
  document.execCommand('insertText', false, message);
  await sleep(400);
  // 5. Send — click the send button or press Enter
  const sendBtn = document.querySelector('button[aria-label="Enviar"]') ||
                  document.querySelector('button[aria-label="Send"]');
  if (sendBtn) {
    sendBtn.click();
  } else {
    msgBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
  }
  await sleep(300);
}

function openChatForDisparo(name) {
  return new Promise(resolve => {
    const box = findSearchInput();
    if (!box) { resolve(); return; }
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    box.focus();
    nativeSetter.call(box, name);
    box.dispatchEvent(new Event('input', { bubbles: true }));

    setTimeout(() => {
      const nameLower = name.toLowerCase();
      const cells = [...document.querySelectorAll('[data-testid="cell-frame-container"]')];
      let target = null;
      for (const cell of cells) {
        const span = cell.querySelector('span[dir="auto"]');
        if (span && span.textContent.trim().toLowerCase() === nameLower) { target = cell; break; }
      }
      if (!target) {
        const first = nameLower.split(' ')[0];
        for (const cell of cells) {
          const span = cell.querySelector('span[dir="auto"]');
          if (span && span.textContent.trim().toLowerCase().includes(first)) { target = cell; break; }
        }
      }
      if (!target && cells.length > 0) target = cells[0];

      if (target) {
        const r = target.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };
        target.dispatchEvent(new MouseEvent('mousedown', opts));
        target.dispatchEvent(new MouseEvent('mouseup',   opts));
        target.dispatchEvent(new MouseEvent('click',     opts));
      }
      nativeSetter.call(box, '');
      box.dispatchEvent(new Event('input', { bubbles: true }));
      box.blur();
      setTimeout(resolve, 200);
    }, 900);
  });
}

// ── Toast ─────────────────────────────────────────────────
function toast(msg, type = 'ok') {
  if (!S) return;
  const t = S.getElementById('toast');
  t.textContent = msg;
  t.className = `show ${type}`;
  setTimeout(() => t.className = '', 2800);
}

// ── Licença ───────────────────────────────────────────────
// 👇 Cole aqui a URL do seu Google Apps Script após publicar
const LICENSE_SERVER_URL = 'https://script.google.com/macros/s/AKfycbwcEu7-mfTPlXQdqWy1DzDwZ3gEu6Yohtksbc1tQHgDBGg_IMI5RIGyHDAfPrKj8U6g/exec';

async function getInstanceId() {
  const res = await new Promise(r => chrome.storage.local.get(['nxt_instance_id'], r));
  if (res.nxt_instance_id) return res.nxt_instance_id;
  const id = uid() + uid() + uid();
  await new Promise(r => chrome.storage.local.set({ nxt_instance_id: id }, r));
  return id;
}

async function checkLicense() {
  if (!LICENSE_SERVER_URL) return true; // sem URL = modo livre
  const instanceId = await getInstanceId();
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'nxt_check_license', instanceId }, data => {
      if (!data || data.active === false) {
        showLockScreen(
          (data && data.message) || 'Acesso bloqueado. Entre em contato com a agência.',
          (data && data.contact) || '',
          !!(data && data.pending)
        );
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

function showLockScreen(message, contactPhone, isPending = false) {
  // Garante que o host existe (pode ser chamado antes de inject())
  let host = document.getElementById('nxt-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'nxt-host';
    host.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;';
    document.body.prepend(host);
    S = host.attachShadow({ mode: 'open' });
  }

  // Empurra 48px — só a barra de bloqueio ocupa esse espaço, WhatsApp fica usável abaixo
  setWaPadding(48);

  const waBtn = contactPhone
    ? `<a href="https://wa.me/${contactPhone.replace(/\D/g,'')}" target="_blank"
         style="background:#25d366;color:#fff;padding:7px 20px;border-radius:8px;
                font-weight:800;font-size:12px;text-decoration:none;white-space:nowrap;
                flex-shrink:0;display:flex;align-items:center;gap:6px;">
         💬 ${isPending ? 'Falar com a agência' : 'Regularize seu acesso'}
       </a>`
    : '';

  const barColor  = isPending ? '#0a1a0a' : '#1a0a0a';
  const borderColor = isPending ? '#14532d' : '#991b1b';
  const icon      = isPending ? '⏳' : '🔒';
  const title     = isPending ? 'Nextra CRM — Aguardando aprovação' : 'Nextra CRM — Suspenso';
  const textColor = isPending ? '#86efac' : '#fca5a5';
  const msgText   = isPending ? 'Sua instalação foi registrada. Aguarde a liberação pela agência.' : message;

  S.innerHTML = `
    <style>
      :host { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: block; }
      #bar {
        height: 48px; background: ${barColor}; border-bottom: 2px solid ${borderColor};
        display: flex; align-items: center; padding: 0 16px; gap: 12px;
      }
    </style>
    <div id="bar">
      <span style="font-size:20px;flex-shrink:0;">${icon}</span>
      <span style="font-size:13px;font-weight:800;color:#f9fafb;flex-shrink:0;">${title}</span>
      <span style="font-size:11px;color:${textColor};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${msgText}</span>
      ${waBtn}
    </div>
  `;
}

// ── Boot ──────────────────────────────────────────────────
async function boot() {
  await loadDB();
  if (!db.columns.length) {
    db.columns = [
      { id: uid(), name: 'Leads Abril', contactIds: [] },
      { id: uid(), name: 'Negociando',  contactIds: [] },
    ];
    saveDB();
  }
  const licensed = await checkLicense();
  if (!licensed) return; // bloqueado — não injeta CRM

  inject();
  setInterval(detectContact, 1500);
  setInterval(updateAgendaBadge, 30000);
  setInterval(checkLicense, 2 * 60 * 60 * 1000); // revalida a cada 2h
}

setTimeout(boot, 2500);
