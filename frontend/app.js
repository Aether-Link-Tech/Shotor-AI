/* Shotor web client. Talks to the FastAPI backend (/api/v1/...). No innerHTML is used with server data. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);

  // Same origin when the backend serves this page. When the page comes from a separate static server
  // (VS Code Live Server :5500, file://, …) talk to the local backend. Override with window.SHOTOR_API_BASE.
  const API_BASE = typeof window.SHOTOR_API_BASE === 'string' ? window.SHOTOR_API_BASE
    : (location.protocol === 'file:' || ['5500', '5173', '3000', '8080'].includes(location.port)) ? 'http://127.0.0.1:8000' : '';

  const PAGES = { chat: 'Chat', documents: 'Documents', calendar: 'Calendar', gmail: 'Gmail', settings: 'Settings' };
  const state = {
    token: sessionStorage.getItem('shotor_token') || '', user: null, authMode: 'login', page: 'chat',
    chat: [], chatBusy: false, draft: null, openMail: null,
  };

  /* ---------- helpers ---------- */
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    node.append(...children.filter((c) => c != null));
    return node;
  }
  const clear = (node) => { node.replaceChildren(); return node; };
  const setText = (id, text, cls) => { const n = $(id); n.textContent = text || ''; if (cls !== undefined) n.className = cls; };

  function toast(message, kind = 'info') {
    const palette = kind === 'error' ? 'bg-red-50 text-red-900 border border-red-200' : kind === 'success' ? 'bg-emerald-50 text-emerald-900 border border-emerald-200' : 'bg-slate-900 text-white';
    const node = el('div', { class: `max-w-sm rounded-xl px-4 py-3 shadow-lg text-sm ${palette}`, role: 'status', text: message });
    $('toastHost').append(node); setTimeout(() => node.remove(), 5000);
  }

  const FIELD_NAMES = { password: 'Password', email: 'Email', full_name: 'Name', message: 'Message', subject: 'Subject', body: 'Message', recipient: 'Recipient', instructions: 'Instructions', history: 'History' };
  function formatError(data, status) {
    const d = data && data.detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) {   // FastAPI validation errors: [{loc:[...], msg:"..."}]
      return d.map((e) => {
        const field = (e.loc || []).filter((p) => p !== 'body' && p !== 'query').pop();
        const msg = String(e.msg || 'Invalid value').replace(/^Value error, /, '');
        return field !== undefined ? `${FIELD_NAMES[field] || field}: ${msg}` : msg;
      }).join('\n');
    }
    if (status === 429) return 'Too many requests. Please wait a moment and try again.';
    return `Request failed (${status}).`;
  }

  class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }

  async function api(path, { method = 'GET', json, form } = {}) {
    const headers = {}; let body;
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    else if (form) body = form;
    let res;
    try { res = await fetch(API_BASE + '/api/v1' + path, { method, headers, body }); }
    catch { throw new ApiError('Cannot reach the server. Make sure the backend is running.', 0); }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && state.token) signOut('Your session expired. Please sign in again.');
      throw new ApiError(formatError(data, res.status), res.status);
    }
    return data;
  }

  const fmtDateTime = (iso) => { const d = new Date(iso); return isNaN(d) ? String(iso || '') : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); };
  const displayName = (from) => (String(from || '').replace(/<[^>]*>/, '').replace(/^["\s]+|["\s]+$/g, '') || String(from || 'Unknown sender'));

  /* ---------- theme ---------- */
  function applyTheme(dark) { document.documentElement.classList.toggle('dark', dark); try { localStorage.setItem('shotor_theme', dark ? 'dark' : 'light'); } catch { /* ignore */ } }
  const toggleTheme = () => applyTheme(!document.documentElement.classList.contains('dark'));
  try { applyTheme(localStorage.getItem('shotor_theme') === 'dark'); } catch { /* ignore */ }

  /* ---------- auth ---------- */
  function setAuthMode(mode) {
    state.authMode = mode; const reg = mode === 'register';
    $('nameField').classList.toggle('hidden', !reg); $('passwordHint').classList.toggle('hidden', !reg);
    $('authTitle').textContent = reg ? 'Create your account' : 'Welcome back';
    $('authSubtitle').textContent = reg ? 'Join Shotor and start your AI journey.' : 'Sign in to continue to your workspace.';
    $('authSubmit').textContent = reg ? 'Create account →' : 'Sign in →';
    $('password').autocomplete = reg ? 'new-password' : 'current-password';
    $('loginTab').className = 'py-2.5 rounded-lg font-semibold ' + (reg ? 'text-slate-500' : 'bg-white shadow-sm');
    $('registerTab').className = 'py-2.5 rounded-lg font-semibold ' + (reg ? 'bg-white shadow-sm' : 'text-slate-500');
    setText('authMessage', '');
  }

  function showApp(user) {
    state.user = user;
    $('authScreen').classList.add('hidden'); $('app').classList.remove('hidden');
    const name = user.full_name || user.email.split('@')[0];
    $('userName').textContent = name; $('userEmail').textContent = user.email;
    $('userAvatar').textContent = name.charAt(0).toUpperCase();
    $('settingsName').textContent = user.full_name || '—'; $('settingsEmail').textContent = user.email;
  }

  function signOut(notice) {
    state.token = ''; state.user = null; state.chat = []; state.draft = null; state.openMail = null;
    sessionStorage.removeItem('shotor_token');
    clear($('chatMessages')); $('welcome').classList.remove('hidden');
    for (const id of ['documentList', 'calendarList', 'gmailList']) clear($(id));
    for (const id of ['summaryPanel', 'emailPanel', 'draftEditor']) $(id).classList.add('hidden');
    $('app').classList.add('hidden'); $('authScreen').classList.remove('hidden');
    $('password').value = ''; setAuthMode('login');
    if (notice) setText('authMessage', notice, 'text-sm text-slate-600');
  }

  $('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('authMessage'); msg.className = 'text-sm text-red-600'; msg.textContent = '';
    const email = $('email').value.trim().toLowerCase(), password = $('password').value, fullName = $('fullName').value.trim();
    if (!email || !password) { msg.textContent = 'Enter your email and password.'; return; }
    if (state.authMode === 'register') {
      if (!fullName) { msg.textContent = 'Enter your full name.'; return; }
      if (password.length < 12) { msg.textContent = 'Password: use at least 12 characters.'; return; }
    }
    const btn = $('authSubmit'); btn.disabled = true; btn.classList.add('opacity-60');
    try {
      const payload = state.authMode === 'register' ? { email, password, full_name: fullName } : { email, password };
      const data = await api(`/auth/${state.authMode}`, { method: 'POST', json: payload });
      state.token = data.access_token; sessionStorage.setItem('shotor_token', state.token);
      $('password').value = ''; showApp(data.user); navigate('chat'); checkAI();
    } catch (err) { msg.textContent = err.message; }
    finally { btn.disabled = false; btn.classList.remove('opacity-60'); }
  });
  $('loginTab').addEventListener('click', () => setAuthMode('login'));
  $('registerTab').addEventListener('click', () => setAuthMode('register'));

  async function logout() {
    try { if (state.token) await api('/auth/logout', { method: 'POST' }); } catch { /* local sign-out always proceeds */ }
    signOut();
  }
  $('logoutBtn').addEventListener('click', logout); $('settingsLogoutBtn').addEventListener('click', logout);

  /* ---------- navigation ---------- */
  function toggleMenu(open) { $('sidebar').classList.toggle('closed', !open); $('overlay').classList.toggle('hidden', !open); }
  function navigate(page) {
    if (!PAGES[page]) page = 'chat';
    state.page = page;
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${page}`));
    document.querySelectorAll('.nav-link').forEach((b) => {
      const on = b.dataset.page === page; b.classList.toggle('active', on); b.classList.toggle('text-slate-300', !on);
    });
    $('pageTitle').textContent = PAGES[page]; toggleMenu(false);
    if (page === 'documents') loadDocuments();
    if (page === 'calendar') loadCalendar();
    if (page === 'gmail') loadGmail();
    if (page === 'settings') loadSettings();
  }
  document.querySelectorAll('.nav-link').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.page)));
  document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.goto)));
  $('menuBtn').addEventListener('click', () => toggleMenu(true)); $('menuClose').addEventListener('click', () => toggleMenu(false)); $('overlay').addEventListener('click', () => toggleMenu(false));
  $('themeBtn').addEventListener('click', toggleTheme); $('settingsThemeBtn').addEventListener('click', toggleTheme);

  async function checkServer() {
    let ok = false;
    try { ok = (await fetch(API_BASE + '/health')).ok; } catch { ok = false; }
    $('serverStatus').textContent = ok ? 'Online' : 'Offline';
    $('serverDot').className = 'w-2 h-2 rounded-full ' + (ok ? 'bg-green-400' : 'bg-red-500');
  }

  async function checkAI() {
    if (!state.token) return;
    try {
      const a = await api('/assistant/status'); const ok = a.available && a.model_installed;
      $('aiStatus').textContent = ok ? a.model : (a.available ? 'Model missing' : 'Ollama offline');
      $('aiStatus').title = a.detail || `Using local model ${a.model}`;
      $('aiDot').className = 'w-2 h-2 rounded-full ' + (ok ? 'bg-green-400' : 'bg-red-500');
    } catch { $('aiStatus').textContent = 'Unknown'; }
  }
  $('aiStatus').addEventListener('click', () => { checkAI(); if ($('aiStatus').title) toast($('aiStatus').title); });

  /* ---------- chat ---------- */
  function addMessage(text, role) {
    $('welcome').classList.add('hidden');
    const bubble = el('div', { class: 'message max-w-[90%] sm:max-w-[80%] rounded-2xl px-4 py-3 leading-7 ' + (role === 'user' ? 'bg-brand text-white rounded-br-sm' : 'bg-white border border-slate-200 rounded-bl-sm'), text });
    const row = el('div', { class: role === 'user' ? 'flex justify-end' : 'flex justify-start' }, bubble);
    $('chatMessages').append(row); row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return bubble;
  }
  function newChat() { state.chat = []; clear($('chatMessages')); $('welcome').classList.remove('hidden'); $('messageInput').value = ''; navigate('chat'); $('messageInput').focus(); }
  $('newChatBtn').addEventListener('click', newChat);
  document.querySelectorAll('[data-suggest]').forEach((b) => b.addEventListener('click', () => { $('messageInput').value = b.dataset.suggest; $('messageInput').focus(); }));

  async function sendChat() {
    const message = $('messageInput').value.trim();
    if (!message || state.chatBusy) return;
    state.chatBusy = true; $('sendButton').disabled = true; $('messageInput').value = '';
    addMessage(message, 'user');
    const pending = addMessage('Thinking…', 'assistant');
    try {
      const data = await api('/assistant/chat', { method: 'POST', json: { message, history: state.chat.slice(-20) } });
      pending.textContent = data.answer || 'No answer returned.';
      state.chat.push({ role: 'user', content: message }, { role: 'assistant', content: data.answer });
    } catch (err) { pending.textContent = `I couldn't complete that request: ${err.message}`; }
    finally { state.chatBusy = false; $('sendButton').disabled = false; $('messageInput').focus(); }
  }
  $('chatForm').addEventListener('submit', (e) => { e.preventDefault(); sendChat(); });
  $('messageInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(); } });

  /* ---------- documents ---------- */
  const docMessage = (text, error = false) => setText('documentMessage', text, 'text-sm mt-3 ' + (error ? 'text-red-600' : 'text-slate-500'));

  async function loadDocuments() {
    const list = $('documentList'); clear(list).append(el('p', { class: 'text-sm text-slate-500', text: 'Loading your documents…' }));
    try {
      const docs = await api('/documents'); clear(list);
      if (!docs.length) { list.append(el('p', { class: 'text-sm text-slate-500 bg-white border border-slate-200 rounded-xl p-5', text: 'No documents yet. Upload a file to get started.' })); return; }
      for (const d of docs) list.append(documentRow(d));
    } catch (err) { clear(list).append(el('p', { class: 'text-sm text-red-600', text: err.message })); }
  }
  function documentRow(d) {
    const actions = el('div', { class: 'flex flex-wrap gap-2' });
    if (d.summary) actions.append(el('button', { type: 'button', class: 'text-sm border border-slate-200 rounded-lg px-3 py-2 font-semibold', text: 'View summary', onclick: () => showSummary(d.original_filename, d.summary) }));
    const sum = el('button', { type: 'button', class: 'text-sm border border-blue-200 text-brand rounded-lg px-3 py-2 font-semibold disabled:opacity-60', text: d.summary ? 'Re-summarize' : 'Summarize' });
    sum.addEventListener('click', () => summarize(d, sum));
    actions.append(sum, el('button', { type: 'button', class: 'text-sm border border-red-200 text-red-600 rounded-lg px-3 py-2 font-semibold', text: 'Delete', onclick: () => removeDocument(d) }));
    return el('div', { class: 'bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3' },
      el('div', { class: 'w-11 h-11 rounded-xl bg-blue-50 text-brand grid place-items-center text-xl', text: '▤' }),
      el('div', { class: 'flex-1 min-w-0' },
        el('p', { class: 'font-semibold truncate', text: d.original_filename }),
        el('p', { class: 'text-xs text-slate-500 mt-1', text: fmtDateTime(d.created_at) + (d.summary ? ' · summarized' : '') })),
      actions);
  }
  function showSummary(name, text) {
    $('summaryTitle').textContent = name; $('summaryBody').textContent = text;
    $('summaryPanel').classList.remove('hidden'); $('summaryPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  $('summaryClose').addEventListener('click', () => $('summaryPanel').classList.add('hidden'));
  async function summarize(d, btn) {
    btn.disabled = true; const label = btn.textContent; btn.textContent = 'Working…'; docMessage('Summarizing — this can take a while on a local model…');
    try {
      const r = await api(`/documents/${encodeURIComponent(d.id)}/summarize`, { method: 'POST' });
      docMessage('Summary ready.'); showSummary(d.original_filename, r.summary); loadDocuments();
    } catch (err) { docMessage(err.message, true); btn.disabled = false; btn.textContent = label; }
  }
  async function removeDocument(d) {
    if (!confirm(`Delete “${d.original_filename}”? This cannot be undone.`)) return;
    try { await api(`/documents/${encodeURIComponent(d.id)}`, { method: 'DELETE' }); docMessage('Document deleted.'); $('summaryPanel').classList.add('hidden'); loadDocuments(); }
    catch (err) { docMessage(err.message, true); }
  }
  async function uploadFile(file) {
    docMessage(`Uploading ${file.name}…`);
    const form = new FormData(); form.append('file', file);
    try { await api('/documents/upload', { method: 'POST', form }); docMessage('Upload complete.'); await loadDocuments(); }
    catch (err) { docMessage(`Upload failed: ${err.message}`, true); }
  }
  $('uploadBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) await uploadFile(f); e.target.value = ''; });
  $('refreshDocsBtn').addEventListener('click', loadDocuments);
  const dz = $('dropzone');
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('border-blue-500', 'bg-blue-50'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('border-blue-500', 'bg-blue-50'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('border-blue-500', 'bg-blue-50'); const f = e.dataTransfer.files[0]; if (f) uploadFile(f); });

  /* ---------- google (shared) ---------- */
  async function connectGoogle() {
    try {
      const r = await api('/google/connect?client=web');
      if (r.return_origin && r.return_origin !== location.origin && !API_BASE) {
        toast(`Google will send you back to ${r.return_origin}. Open Shotor at that address (not ${location.origin}) and try again.`, 'error'); return;
      }
      sessionStorage.setItem('shotor_return_page', state.page);
      window.location.href = r.authorization_url;
    } catch (err) { toast(err.message, 'error'); }
  }
  async function googleStatus() { try { return await api('/google/status'); } catch (err) { return { error: err.message }; } }
  function describeConnection(s) { return s.error ? s.error : s.connected ? `Connected${s.google_email ? ' as ' + s.google_email : ''}` : 'Not connected. Connect Google to continue.'; }
  $('connectCalendarBtn').addEventListener('click', connectGoogle); $('connectGmailBtn').addEventListener('click', connectGoogle);

  /* ---------- calendar ---------- */
  async function loadCalendar() {
    const list = clear($('calendarList')); setText('calendarMessage', '');
    const s = await googleStatus();
    setText('calendarStatus', describeConnection(s)); $('connectCalendarBtn').textContent = s.connected ? 'Reconnect Google' : 'Connect Google';
    if (!s.connected) return;
    list.append(el('p', { class: 'text-sm text-slate-500', text: 'Loading events…' }));
    try {
      const { events } = await api('/google/calendar/events?limit_count=50'); clear(list);
      if (!events.length) { list.append(el('p', { class: 'text-sm text-slate-500 bg-white border border-slate-200 rounded-xl p-5', text: 'No events in the next 7 days.' })); return; }
      const groups = new Map();
      for (const e of events) {
        const allDay = e.start.length === 10; const start = allDay ? new Date(e.start + 'T00:00:00') : new Date(e.start);
        const key = start.toDateString(); if (!groups.has(key)) groups.set(key, { date: start, items: [] });
        groups.get(key).items.push({ e, allDay, start });
      }
      for (const { date, items } of groups.values()) {
        list.append(el('h3', { class: 'text-sm font-bold text-slate-500 mt-4', text: date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }) }));
        for (const { e, allDay, start } of items) {
          const time = allDay ? 'All day' : start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' – ' + new Date(e.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          list.append(el('div', { class: 'bg-white border border-slate-200 rounded-xl p-4' },
            el('p', { class: 'font-semibold', text: e.summary }),
            el('p', { class: 'text-sm text-slate-500 mt-1', text: time + (e.location ? ' · ' + e.location : '') }),
            e.html_link && /^https:\/\//.test(e.html_link) ? el('a', { class: 'text-xs text-brand font-semibold', href: e.html_link, target: '_blank', rel: 'noopener noreferrer', text: 'Open in Google Calendar ↗' }) : null));
        }
      }
    } catch (err) { clear(list); setText('calendarMessage', err.message); }
  }
  $('refreshCalendarBtn').addEventListener('click', loadCalendar);

  /* ---------- gmail ---------- */
  const gmailMsg = (t, error = false) => setText('gmailMessage', t, 'text-sm mt-3 ' + (error ? 'text-red-600' : 'text-slate-500'));
  async function loadGmail() {
    const list = clear($('gmailList')); gmailMsg('');
    const s = await googleStatus();
    setText('gmailStatus', describeConnection(s)); $('connectGmailBtn').textContent = s.connected ? 'Reconnect Google' : 'Connect Google';
    if (!s.connected) return;
    list.append(el('p', { class: 'text-sm text-slate-500', text: 'Loading messages…' }));
    try {
      const { messages } = await api('/google/gmail/messages?limit_count=20'); clear(list);
      if (!messages.length) { list.append(el('p', { class: 'text-sm text-slate-500 bg-white border border-slate-200 rounded-xl p-5', text: 'No messages found.' })); return; }
      for (const m of messages) {
        list.append(el('div', { class: 'bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3' },
          el('div', { class: 'flex-1 min-w-0' },
            el('p', { class: 'font-semibold truncate', text: m.subject || '(No subject)' }),
            el('p', { class: 'text-xs text-slate-500 mt-1 truncate', text: `${displayName(m.from)} · ${fmtDateTime(m.date)}` }),
            el('p', { class: 'text-sm text-slate-600 mt-1 line-clamp-2', text: m.snippet || '' })),
          el('button', { type: 'button', class: 'text-sm border border-blue-200 text-brand rounded-lg px-3 py-2 font-semibold', text: 'Open', onclick: () => openMail(m.id) })));
      }
    } catch (err) { clear(list); gmailMsg(err.message, true); }
  }
  async function openMail(id) {
    closeDraft(); $('emailPanel').classList.remove('hidden');
    $('emailSubject').textContent = 'Loading…'; $('emailMeta').textContent = ''; $('emailBody').textContent = '';
    try {
      const m = await api(`/google/gmail/messages/${encodeURIComponent(id)}`); state.openMail = m;
      $('emailSubject').textContent = m.subject || '(No subject)'; $('emailMeta').textContent = `From: ${m.from || 'Unknown'} · ${fmtDateTime(m.date)}`;
      $('emailBody').textContent = m.body || m.snippet || 'No message body returned.';
      $('emailPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) { $('emailPanel').classList.add('hidden'); gmailMsg(err.message, true); }
  }
  function closeDraft() { state.draft = null; $('draftEditor').classList.add('hidden'); setText('draftStatus', ''); }
  $('emailClose').addEventListener('click', () => { $('emailPanel').classList.add('hidden'); closeDraft(); state.openMail = null; });
  $('discardDraftBtn').addEventListener('click', closeDraft);
  $('refreshGmailBtn').addEventListener('click', loadGmail);

  $('draftBtn').addEventListener('click', async () => {
    if (!state.openMail) return;
    const btn = $('draftBtn'); btn.disabled = true; setText('draftStatus', 'Drafting with AI…', 'text-sm text-slate-500');
    try {
      const d = await api('/google/gmail/reply-draft', { method: 'POST', json: { message_id: state.openMail.id, instructions: $('draftInstructions').value.trim() || 'Write a polite, concise reply.' } });
      state.draft = d; $('draftTo').value = d.recipient; $('draftSubject').value = d.subject; $('draftBody').value = d.body;
      $('draftExpiry').textContent = `Draft expires at ${new Date(d.expires_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`;
      $('draftEditor').classList.remove('hidden'); setText('draftStatus', '');
    } catch (err) { setText('draftStatus', err.message, 'text-sm text-red-600'); }
    finally { btn.disabled = false; }
  });
  $('sendDraftBtn').addEventListener('click', async () => {
    if (!state.draft) return;
    const recipient = $('draftTo').value.trim(), subject = $('draftSubject').value.trim(), body = $('draftBody').value.trim();
    if (!recipient || !subject || !body) { setText('draftStatus', 'Recipient, subject and message are required.', 'text-sm text-red-600'); return; }
    if (!confirm(`Send this email to ${recipient}?`)) return;
    const btn = $('sendDraftBtn'); btn.disabled = true; setText('draftStatus', 'Sending…', 'text-sm text-slate-500');
    try {
      await api('/google/gmail/send', { method: 'POST', json: { draft_id: state.draft.draft_id, recipient, subject, body, confirm_send: true } });
      closeDraft(); toast('Email sent.', 'success'); gmailMsg('Email sent.');
    } catch (err) { setText('draftStatus', err.message, 'text-sm text-red-600'); }
    finally { btn.disabled = false; }
  });

  /* ---------- settings ---------- */
  async function loadSettings() {
    const s = await googleStatus();
    setText('settingsGoogle', describeConnection(s)); $('settingsDisconnectBtn').classList.toggle('hidden', !s.connected);
  }
  $('settingsDisconnectBtn').addEventListener('click', async () => {
    if (!confirm('Disconnect your Google account from Shotor?')) return;
    try { await api('/google/disconnect', { method: 'DELETE' }); toast('Google disconnected.', 'success'); loadSettings(); }
    catch (err) { toast(err.message, 'error'); }
  });
  const resetDelete = () => { $('deleteForm').classList.add('hidden'); $('deletePassword').value = ''; setText('deleteMessage', ''); };
  $('deleteToggleBtn').addEventListener('click', () => { $('deleteForm').classList.remove('hidden'); $('deletePassword').focus(); });
  $('deleteCancelBtn').addEventListener('click', resetDelete);
  $('deleteConfirmBtn').addEventListener('click', async () => {
    const password = $('deletePassword').value;
    if (!password) { setText('deleteMessage', 'Enter your password to confirm.'); return; }
    if (!confirm('This permanently deletes your account and all data. Continue?')) return;
    const btn = $('deleteConfirmBtn'); btn.disabled = true;
    try { await api('/account/me', { method: 'DELETE', json: { password } }); resetDelete(); signOut('Your account was deleted.'); }
    catch (err) { setText('deleteMessage', err.message); }
    finally { btn.disabled = false; }
  });

  /* ---------- start ---------- */
  async function handleGoogleReturn() {
    const params = new URLSearchParams(location.search), result = params.get('google');
    if (!result) return null;
    history.replaceState(null, '', location.pathname);
    const page = sessionStorage.getItem('shotor_return_page') || 'gmail'; sessionStorage.removeItem('shotor_return_page');
    if (result === 'connected') toast('Google connected.', 'success');
    else if (result === 'cancelled') toast('Google connection was cancelled.');
    else toast('Google connection failed. Please try again.', 'error');
    return page;
  }

  async function init() {
    setAuthMode('login'); checkServer(); setInterval(() => { checkServer(); checkAI(); }, 30000);
    const returnPage = await handleGoogleReturn();
    if (!state.token) return;
    try { showApp(await api('/auth/me')); navigate(returnPage || 'chat'); checkAI(); }
    catch (err) { if (err.status !== 401) signOut(err.message); }   // 401 already signed out
  }
  init();
})();
