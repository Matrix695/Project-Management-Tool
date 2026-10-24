const app = document.querySelector('#app');
const toastRegion = document.querySelector('#toast-region');
const columns = ['Backlog', 'In progress', 'Review', 'Done'];
const state = {
  user: null,
  section: location.pathname === '/admin' ? 'admin' : 'user',
  projects: [],
  project: null,
  tasks: [],
  members: [],
  adminDashboard: null,
  notifications: [],
  view: 'board',
  filter: 'all',
  search: '',
  socket: null,
  notificationOpen: false,
  draggedTaskId: null
};

const initials = (name = '') => name.split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const initialsClass = (name = '') => {
  const index = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 3;
  return ['', ' avatar-coral', ' avatar-green'][index];
};
const formatDate = (value) => value
  ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  : '';
const formatTime = (value) => {
  const date = new Date(value);
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

async function api(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const csrfToken = document.cookie
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith('csrftoken='))
    ?.slice('csrftoken='.length);
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) {
    headers['X-CSRFToken'] = decodeURIComponent(csrfToken);
  }
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers
  });
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

function toast(message, isError = false) {
  const item = document.createElement('div');
  item.className = `toast${isError ? ' error' : ''}`;
  item.textContent = message;
  toastRegion.append(item);
  window.setTimeout(() => item.remove(), 3800);
}

function userAvatar(user, small = false) {
  if (!user) return '<span class="avatar avatar-small">?</span>';
  return `<span class="avatar${small ? ' avatar-small' : ''}${initialsClass(user.name)}" title="${escapeHtml(user.name)}">${escapeHtml(initials(user.name))}</span>`;
}

function availabilityControl() {
  if (state.user?.role !== 'crew') return '';
  const available = state.user.availability !== 'unavailable';
  return `<button class="availability-toggle${available ? ' is-available' : ''}" data-action="toggle-availability" aria-label="Availability: ${available ? 'available' : 'unavailable'}. Click to change"><span></span>${available ? 'Available' : 'Unavailable'}</button>`;
}

function setLoading() {
  app.innerHTML = `
    <div class="login-shell">
      <aside class="login-aside"><div class="brand"><img class="brand-mark" src="/assets/trackit-mark.svg" alt=""> TrackIt</div>
        <div class="login-aside-copy"><h1>Good work happens together.</h1><p>Make space for the big ideas, the small details, and everything it takes to get there.</p></div>
        <div class="login-foot">A little more in sync, every day.</div>
      </aside>
      <section class="login-main"><div class="auth-card"><div class="skeleton"></div></div></section>
    </div>`;
}

function showAuth(mode = 'login', message = '') {
  const isRegister = mode === 'register';
  app.innerHTML = `
    <div class="login-shell">
      <aside class="login-aside">
        <div class="brand"><img class="brand-mark" src="/assets/trackit-mark.svg" alt=""> TrackIt</div>
        <div class="login-aside-copy">
          <h1>Good work happens together.</h1>
          <p>Make space for the big ideas, the small details, and everything it takes to get there. Your team’s next great thing starts here.</p>
        </div>
        <div class="login-foot">A little more in sync, every day.</div>
      </aside>
      <section class="login-main">
        <form class="auth-card" id="auth-form">
          <h2>${isRegister ? 'Create your account' : 'Welcome back'}</h2>
          <p class="auth-subtitle">${isRegister ? 'Bring your team and your best ideas together.' : 'Sign in to pick up where your team left off.'}</p>
          ${isRegister ? '<div class="field"><label for="auth-name">Your name</label><input id="auth-name" name="name" autocomplete="name" placeholder="Full Name" required maxlength="180"></div>' : ''}
          <div class="field"><label for="auth-role">${isRegister ? 'Account type' : 'Sign in as'}</label><select id="auth-role" name="role" required><option value="crew">Crew member</option><option value="admin">Project admin</option></select></div>
          <div class="field"><label for="auth-email">Email address</label><input id="auth-email" name="email" type="email" autocomplete="email" placeholder="you@company.com" required></div>
          <div class="field"><label for="auth-password">Password</label><input id="auth-password" name="password" type="password" autocomplete="${isRegister ? 'new-password' : 'current-password'}" placeholder="${isRegister ? 'At least 8 characters' : 'Enter your password'}" minlength="${isRegister ? '8' : '1'}" required></div>
          <p class="error-text" id="auth-error">${escapeHtml(message)}</p>
          <button class="btn btn-primary btn-full" type="submit">${isRegister ? 'Create account' : 'Sign in'} <span aria-hidden="true">→</span></button>
          <p class="auth-switch">${isRegister ? 'Already have an account?' : 'New to TrackIt?'} <button class="text-link" type="button" data-action="toggle-auth">${isRegister ? 'Sign in' : 'Create an account'}</button></p>
          ${isRegister ? '' : '<div class="demo-note"><strong>Demo accounts</strong><br>Project admin: alex@trackit.test / trackitdemo<br>Crew member: maya@trackit.test / trackitdemo or jordan@trackit.test / trackitdemo.</div>'}
        </form>
      </section>
    </div>`;
  document.querySelector('#auth-form').addEventListener('submit', submitAuth);
  document.querySelector('[data-action="toggle-auth"]').addEventListener('click', () => showAuth(isRegister ? 'login' : 'register'));
}

async function submitAuth(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const register = form.has('name');
  const endpoint = register ? '/api/auth/register' : '/api/auth/login';
  const errorNode = document.querySelector('#auth-error');
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = 'One moment…';
  try {
    const payload = Object.fromEntries(form.entries());
    const result = await api(endpoint, { method: 'POST', body: JSON.stringify(payload) });
    state.user = result.user;
    state.section = result.user.role === 'admin' ? 'admin' : 'user';
    window.history.pushState({}, '', state.section === 'admin' ? '/admin' : '/');
    await loadWorkspace();
  } catch (error) {
    errorNode.textContent = error.message;
    submitButton.disabled = false;
    submitButton.innerHTML = `${register ? 'Create account' : 'Sign in'} <span aria-hidden="true">→</span>`;
  }
}

async function loadWorkspace() {
  if (state.section === 'admin' && state.user.role !== 'admin') {
    state.section = 'user';
    window.history.replaceState({}, '', '/');
  }
  const [projectResult, notificationResult] = await Promise.all([
    api('/api/projects'),
    api('/api/notifications')
  ]);
  state.projects = projectResult.projects;
  state.notifications = notificationResult.notifications;
  if (state.section === 'admin' && !state.projects.some((project) => project.ownerId === state.user.id)) {
    state.section = 'user';
    window.history.replaceState({}, '', '/');
  }
  const availableProjects = state.section === 'admin'
    ? state.projects.filter((project) => project.ownerId === state.user.id)
    : state.projects;
  if (!state.project || !availableProjects.some((project) => project.id === state.project.id)) {
    state.project = availableProjects[0] || null;
  } else {
    state.project = availableProjects.find((project) => project.id === state.project.id);
  }
  if (state.project) {
    const board = await api(`/api/projects/${encodeURIComponent(state.project.id)}/tasks`);
    state.tasks = board.tasks;
    state.members = board.members;
    if (state.section === 'admin') await refreshAdminDashboard();
    else state.adminDashboard = null;
  } else {
    state.tasks = [];
    state.members = [];
    state.adminDashboard = null;
  }
  renderWorkspace();
  connectSocket();
}

function connectSocket() {
  if (state.socket) state.socket.close();
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  state.socket = new WebSocket(`${protocol}//${location.host}/ws`);
  state.socket.addEventListener('message', async (event) => {
    const message = JSON.parse(event.data);
    if (message.type !== 'activity') return;
    if (message.eventType === 'member' && !state.projects.some((project) => project.id === message.projectId)) {
      await loadWorkspace();
      return;
    }
    if (message.actorName !== state.user.name) toast(`${message.actorName} ${message.message}`);
    const refreshes = [api('/api/notifications')];
    if (message.projectId === state.project?.id) {
      refreshes.push(refreshBoard());
      if (state.section === 'admin' && isProjectAdmin()) refreshes.push(refreshAdminDashboard());
    }
    const [notifications] = await Promise.all(refreshes);
    state.notifications = notifications.notifications;
    renderWorkspace();
  });
  state.socket.addEventListener('close', () => {
    if (state.user) window.setTimeout(() => {
      if (state.user && (!state.socket || state.socket.readyState === WebSocket.CLOSED)) connectSocket();
    }, 2500);
  });
}

async function refreshBoard() {
  if (!state.project) return;
  const board = await api(`/api/projects/${encodeURIComponent(state.project.id)}/tasks`);
  state.tasks = board.tasks;
  state.members = board.members;
}

function isProjectAdmin() {
  return Boolean(state.user && state.project && state.project.ownerId === state.user.id);
}

async function refreshAdminDashboard() {
  if (!isProjectAdmin()) {
    state.adminDashboard = null;
    return;
  }
  state.adminDashboard = await api(`/api/projects/${encodeURIComponent(state.project.id)}/admin`);
}

function renderWorkspace() {
  if (state.section === 'admin' && !state.projects.some((project) => project.ownerId === state.user.id)) {
    state.section = 'user';
    window.history.replaceState({}, '', '/');
  }
  if (state.section === 'admin') return renderAdminWorkspace();
  return renderUserWorkspace();
}

function renderUserWorkspace() {
  if (!state.user) return showAuth();
  if (!state.project) return renderEmptyWorkspace();
  const project = state.project;
  const unread = state.notifications.filter((item) => !item.read).length;
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="brand"><img class="brand-mark" src="/assets/trackit-mark.svg" alt=""> TrackIt</div>
        <div class="workspace-label">Workspace</div>
        <button class="nav-link" data-action="home"><span class="nav-icon">⌂</span>Home</button>
        <button class="nav-link active" data-action="board"><span class="nav-icon">▦</span>My projects</button>
        ${state.projects.some((item) => item.ownerId === state.user.id) ? '<button class="nav-link" data-action="admin-portal"><span class="nav-icon">◎</span>Admin portal</button>' : ''}
        <button class="nav-link" data-action="notifications"><span class="nav-icon">♧</span>Inbox${unread ? `<span class="column-count">${unread}</span>` : ''}</button>
        <div class="project-nav-title">Projects ${state.user.role === 'admin' ? '<button type="button" data-action="new-project" aria-label="Create project">+</button>' : ''}</div>
        <div class="project-list">
          ${state.projects.map((item) => `<button class="project-link${item.id === project.id ? ' active' : ''}" data-project-id="${escapeHtml(item.id)}"><span class="project-color" style="--project-color:${escapeHtml(item.color)}"></span>${escapeHtml(item.name)}</button>`).join('')}
        </div>
        <div class="sidebar-spacer"></div>
        ${state.user.role === 'admin' ? '<div class="upgrade-card"><strong>Keep the team on track</strong><p>Good things happen when everyone can see the whole picture.</p><button data-action="invite">Assign crew →</button></div>' : ''}
        <div class="profile-row">${userAvatar(state.user)}<div class="profile-name"><strong>${escapeHtml(state.user.name)}</strong><span>${escapeHtml(state.user.email)}</span></div><button class="logout-button" data-action="logout" aria-label="Sign out" title="Sign out">↪</button></div>
      </aside>
      <section class="main-content">
        <header class="topbar">
          <button class="icon-button mobile-menu" data-action="menu" aria-label="Open menu">☰</button>
          <div class="breadcrumbs">Workspace <span aria-hidden="true">/</span> <strong>${escapeHtml(project.name)}</strong></div>
          <div class="top-actions">
            <label class="search-box"><input id="search-input" type="search" placeholder="Search tasks..." value="${escapeHtml(state.search)}" aria-label="Search tasks"></label>
            <button class="icon-button" data-action="notifications" aria-label="Notifications">♧${unread ? '<span class="notification-dot"></span>' : ''}</button>
            ${availabilityControl()}
            ${userAvatar(state.user, true)}
          </div>
        </header>
        <section class="project-header">
          <div>
            <p class="project-kicker">PROJECT BOARD</p>
            <div class="project-heading"><h1>${escapeHtml(project.name)}</h1><span class="project-star" title="Favorite">★</span></div>
            <p class="project-description">${escapeHtml(project.description || 'A shared space to turn plans into progress.')}</p>
          </div>
          <div class="header-actions">
            ${state.user.role === 'admin' ? '<button class="btn btn-secondary" data-action="members">＋ Assign crew</button>' : ''}
            <div class="member-stack">${state.members.slice(0, 4).map((member) => userAvatar(member, true)).join('')}<span class="member-count">${state.members.length} members</span></div>
            <button class="btn btn-primary" data-action="new-task">＋ Add task</button>
          </div>
        </section>
        <section class="project-progress" aria-label="Project progress">
          <div class="project-progress-label"><strong>Project progress</strong><span>${state.tasks.filter((task) => task.status === 'Done').length} of ${state.tasks.length} tasks complete</span></div>
          <div class="progress-track"><span style="width:${state.tasks.length ? Math.round((state.tasks.filter((task) => task.status === 'Done').length / state.tasks.length) * 100) : 0}%"></span></div>
          <strong class="progress-percent">${state.tasks.length ? Math.round((state.tasks.filter((task) => task.status === 'Done').length / state.tasks.length) * 100) : 0}%</strong>
        </section>
        ${state.user.role === 'crew' ? (() => {
          const assignedTasks = state.tasks.filter((task) => task.assigneeId === state.user.id);
          const completedTasks = assignedTasks.filter((task) => task.status === 'Done').length;
          const progress = assignedTasks.length ? Math.round((completedTasks / assignedTasks.length) * 100) : 0;
          return `<section class="crew-progress" aria-label="Your project progress"><div><p class="project-kicker">YOUR CONTRIBUTION</p><strong>${completedTasks} of ${assignedTasks.length} assigned tasks complete</strong><span>${assignedTasks.filter((task) => task.status === 'In progress').length} in progress · ${assignedTasks.filter((task) => task.status === 'Review').length} in review</span></div><div class="crew-progress-track"><span style="width:${progress}%"></span></div><strong class="crew-progress-percent">${progress}%</strong></section>`;
        })() : ''}
        <nav class="view-tabs" aria-label="Project views">
          <button class="view-tab${state.view === 'board' ? ' active' : ''}" data-view="board">▦ Board <span>${state.tasks.length}</span></button>
          <button class="view-tab${state.view === 'list' ? ' active' : ''}" data-view="list">☷ List <span>${state.tasks.length}</span></button>
          <button class="view-tab" data-action="members">♧ Crew <span>${state.members.length}</span></button>
        </nav>
        <div class="board-controls">
          <div class="board-left-controls">
            <select class="select-control" id="filter-select" aria-label="Filter tasks">
              <option value="all"${state.filter === 'all' ? ' selected' : ''}>All tasks</option>
              <option value="mine"${state.filter === 'mine' ? ' selected' : ''}>Assigned to me</option>
              <option value="unassigned"${state.filter === 'unassigned' ? ' selected' : ''}>Unassigned</option>
            </select>
            <button class="btn btn-quiet" data-action="members">♧ <span>${state.members.length}</span></button>
          </div>
          <div class="board-right-controls"><span class="member-count">${state.tasks.length} tasks</span><button class="btn btn-secondary" data-action="new-task">＋ Add task</button></div>
        </div>
        <div id="board-content">${state.view === 'board' ? renderBoard() : renderList()}</div>
      </section>
    </div>
    ${state.notificationOpen ? renderNotifications() : ''}
    <div id="modal-root"></div>`;
  document.querySelector('#search-input').addEventListener('input', (event) => {
    state.search = event.currentTarget.value;
    rerenderBoardOnly();
  });
  document.querySelector('#filter-select')?.addEventListener('change', (event) => {
    state.filter = event.currentTarget.value;
    rerenderBoardOnly();
  });
  app.querySelectorAll('[data-project-id]').forEach((button) => button.addEventListener('click', () => selectProject(button.dataset.projectId)));
  app.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
    const view = button.dataset.view;
    state.view = view;
    renderWorkspace();
  }));
  app.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => handleAction(button.dataset.action)));
  wireTaskCards(document.querySelector('#board-content'));
  if (state.notificationOpen) wireNotifications();
}

function renderEmptyWorkspace() {
  const isAdmin = state.user.role === 'admin';
  app.innerHTML = `
    <div class="app-shell"><aside class="sidebar"><div class="brand"><img class="brand-mark" src="/assets/trackit-mark.svg" alt=""> TrackIt</div>
      <div class="workspace-label">Workspace</div><button class="nav-link active"><span class="nav-icon">▦</span>My projects</button><div class="sidebar-spacer"></div>
      <div class="profile-row">${userAvatar(state.user)}<div class="profile-name"><strong>${escapeHtml(state.user.name)}</strong><span>${escapeHtml(state.user.email)}</span></div><button class="logout-button" data-action="logout" aria-label="Sign out">↪</button></div>
    </aside><section class="main-content"><header class="topbar"><div class="breadcrumbs">Workspace</div>${availabilityControl()}</header>
      <div class="empty-state" style="margin:18vh auto;max-width:380px"><span style="font-size:35px;color:#0f766e">✳</span><h1 style="font:700 24px Manrope;color:#25263a">${isAdmin ? 'Start a project' : 'No projects assigned yet'}</h1><p>${isAdmin ? 'Create your project, then assign crew members to get the work moving.' : 'Ask your project admin to add you to a project. It will appear here when you are assigned.'}</p>${isAdmin ? '<button class="btn btn-primary" data-action="new-project">＋ Create a project</button>' : ''}</div>
    </section></div><div id="modal-root"></div>`;
  app.querySelector('[data-action="new-project"]')?.addEventListener('click', () => openProjectModal());
  app.querySelector('[data-action="logout"]').addEventListener('click', logout);
  app.querySelector('[data-action="toggle-availability"]')?.addEventListener('click', () => handleAction('toggle-availability'));
}

function filteredTasks() {
  const term = state.search.trim().toLowerCase();
  return state.tasks.filter((task) => {
    if (state.filter === 'mine' && task.assigneeId !== state.user.id) return false;
    if (state.filter === 'unassigned' && task.assigneeId) return false;
    return !term || `${task.title} ${task.description}`.toLowerCase().includes(term);
  });
}

function renderBoard() {
  const tasks = filteredTasks();
  return `<div class="board-layout">${columns.map((column) => {
    const columnTasks = tasks.filter((task) => task.status === column);
    const slug = column.toLowerCase().replace(/\s/g, '-');
    return `<section class="board-column" data-column="${escapeHtml(column)}">
      <div class="column-heading"><span class="column-dot ${slug}"></span><h2>${escapeHtml(column)}</h2><span class="column-count">${columnTasks.length}</span><button class="column-add" data-column-add="${escapeHtml(column)}" aria-label="Add task to ${escapeHtml(column)}">+</button></div>
      <div class="task-list" data-drop-column="${escapeHtml(column)}">
        ${columnTasks.map(renderTaskCard).join('') || '<div class="empty-state">Nothing here yet</div>'}
      </div>
      <button class="add-task-link" data-column-add="${escapeHtml(column)}">＋ Add a task</button>
    </section>`;
  }).join('')}</div>`;
}

function renderTaskCard(task) {
  const due = task.dueDate ? formatDate(task.dueDate) : '';
  const overdue = task.dueDate && task.dueDate < new Date().toISOString().slice(0, 10) && task.status !== 'Done';
  return `<article class="task-card" draggable="true" data-task-id="${escapeHtml(task.id)}">
    <div class="task-label-row"><span class="priority ${task.priority.toLowerCase()}">${escapeHtml(task.priority)} priority</span><button class="task-menu" data-card-menu="${escapeHtml(task.id)}" aria-label="Task actions">···</button></div>
    <h3 class="task-title">${escapeHtml(task.title)}</h3>
    ${task.description ? `<p class="task-description">${escapeHtml(task.description)}</p>` : ''}
    <div class="task-meta"><span class="task-due${overdue ? ' overdue' : ''}">${due ? `◷ ${escapeHtml(due)}` : '◷ No due date'}</span>
      <div class="task-footer-right">${task.comments ? `<span class="task-comments">☷ ${task.comments}</span>` : ''}${task.assignee ? `<span class="task-person">${userAvatar(task.assignee, true)}</span>` : '<span class="task-person"><span class="avatar avatar-small">+</span></span>'}</div>
    </div>
  </article>`;
}

function renderList() {
  const tasks = filteredTasks();
  if (!tasks.length) return '<div class="empty-state">No tasks match this view.</div>';
  return `<div class="list-view">${tasks.map((task) => `<div class="list-task" data-task-id="${escapeHtml(task.id)}">
    <span class="list-task-title">${escapeHtml(task.title)}</span><span class="status-pill ${task.status.toLowerCase().replace(/\s/g, '-')}">${escapeHtml(task.status)}</span>
    <span>${task.assignee ? `${userAvatar(task.assignee, true)} ${escapeHtml(task.assignee.name)}` : 'Unassigned'}</span><span>${task.dueDate ? escapeHtml(formatDate(task.dueDate)) : '—'}</span>
  </div>`).join('')}</div>`;
}

function renderAdminPortal() {
  const dashboard = state.adminDashboard;
  if (!dashboard) return '<div class="empty-state">Loading project oversight…</div>';
  const { summary, members, attentionTasks } = dashboard;
  const statuses = columns.map((status) => {
    const count = summary.statusCounts[status];
    const width = summary.taskCount ? Math.round((count / summary.taskCount) * 100) : 0;
    return `<div class="admin-status-row"><span>${escapeHtml(status)}</span><div class="admin-status-track"><span class="status-${status.toLowerCase().replace(/\s/g, '-')}" style="width:${width}%"></span></div><strong>${count}</strong></div>`;
  }).join('');
  return `<section class="admin-portal">
    <div class="admin-heading"><div><p class="project-kicker">PROJECT OVERSIGHT</p><h2>${escapeHtml(state.project.name)}</h2><p>Live progress and work that may need your attention.</p></div><div class="header-actions"><button class="btn btn-secondary" data-action="members">＋ Assign crew</button><button class="btn btn-primary" data-action="new-task">＋ Add task</button></div></div>
    <div class="admin-metrics">
      <article class="admin-metric admin-progress-card"><span>Overall progress</span><strong>${summary.progress}%</strong><div class="progress-track"><span style="width:${summary.progress}%"></span></div><small>${summary.completedCount} of ${summary.taskCount} tasks completed</small></article>
      <article class="admin-metric"><span>Total tasks</span><strong>${summary.taskCount}</strong><small>Across this project</small></article>
      <article class="admin-metric${summary.overdueCount ? ' metric-alert' : ''}"><span>Overdue</span><strong>${summary.overdueCount}</strong><small>Open past their due date</small></article>
      <article class="admin-metric${summary.unassignedCount ? ' metric-alert' : ''}"><span>Unassigned</span><strong>${summary.unassignedCount}</strong><small>Need an owner</small></article>
    </div>
    <div class="admin-grid">
      <section class="admin-panel"><div class="admin-panel-heading"><div><h3>Task status</h3><p>Current distribution across the project</p></div><span class="live-indicator">Live</span></div>${statuses}</section>
      <section class="admin-panel"><div class="admin-panel-heading"><div><h3>Team progress</h3><p>Completed work by assignee</p></div><span class="member-count">${members.length} members</span></div>
        ${members.map((member) => `<div class="admin-member">${userAvatar(member, true)}<div class="admin-member-info"><strong>${escapeHtml(member.name)}</strong><span>${member.completedCount}/${member.taskCount} tasks complete${member.overdueCount ? ` · ${member.overdueCount} overdue` : ''}</span><div class="admin-member-track"><span style="width:${member.progress}%"></span></div></div>${member.role === 'crew' ? `<span class="availability-badge${member.availability === 'available' ? ' is-available' : ''}">${member.availability === 'available' ? 'Available' : 'Unavailable'}</span>` : ''}<strong class="admin-member-percent">${member.progress}%</strong></div>`).join('')}
      </section>
    </div>
    <section class="admin-panel attention-panel"><div class="admin-panel-heading"><div><h3>Needs attention</h3><p>Review, overdue, or unassigned work</p></div><span class="column-count">${attentionTasks.length}</span></div>
      ${attentionTasks.length ? `<div class="admin-attention-list">${attentionTasks.map((task) => `<button class="admin-attention-item" data-task-id="${escapeHtml(task.id)}"><span class="attention-task-copy"><strong>${escapeHtml(task.title)}</strong><small>${task.assignee ? `Assigned to ${escapeHtml(task.assignee.name)}` : 'No assignee'}${task.dueDate ? ` · Due ${escapeHtml(formatDate(task.dueDate))}` : ''}</small></span><span class="attention-tags">${task.reasons.map((reason) => `<span class="attention-tag${reason === 'Overdue' ? ' attention-overdue' : ''}">${escapeHtml(reason)}</span>`).join('')}</span><span class="attention-arrow">→</span></button>`).join('')}</div>` : '<div class="admin-clear-state">Everything is on track. No tasks need attention.</div>'}
    </section>
  </section>`;
}

function renderAdminWorkspace() {
  if (!state.user) return showAuth();
  const ownedProjects = state.projects.filter((project) => project.ownerId === state.user.id);
  const hasAdminAccess = ownedProjects.length > 0;
  app.innerHTML = `
    <div class="admin-shell">
      <aside class="admin-sidebar">
        <div class="admin-brand"><img class="admin-brand-mark" src="/assets/trackit-mark.svg" alt=""><span>TrackIt <small>ADMIN</small></span></div>
        <div class="admin-nav-label">MANAGEMENT</div>
        <button class="admin-nav-link active"><span>▦</span>Project overview</button>
        <div class="admin-project-nav">
          <div class="admin-nav-label">YOUR PROJECTS</div>
          ${ownedProjects.map((project) => `<button class="admin-project-link${project.id === state.project?.id ? ' active' : ''}" data-admin-project-id="${escapeHtml(project.id)}"><span class="project-color" style="--project-color:${escapeHtml(project.color)}"></span>${escapeHtml(project.name)}</button>`).join('')}
        </div>
        <div class="sidebar-spacer"></div>
        <button class="admin-back-link" data-action="workspace"><span>←</span> User workspace</button>
        <div class="profile-row admin-profile">${userAvatar(state.user)}<div class="profile-name"><strong>${escapeHtml(state.user.name)}</strong><span>Project admin</span></div><button class="logout-button" data-action="logout" aria-label="Sign out" title="Sign out">↪</button></div>
      </aside>
      <main class="admin-main">
        <header class="admin-topbar">
          <div><span class="admin-eyebrow">ADMIN CONSOLE</span><h1>Project oversight</h1></div>
          <div class="admin-topbar-actions"><span class="admin-live-label"><span></span>Live updates</span><button class="btn btn-secondary" data-action="workspace">Open user workspace</button></div>
        </header>
        ${hasAdminAccess ? `<section class="admin-project-toolbar"><label for="admin-project-select">Viewing project<select id="admin-project-select">${ownedProjects.map((project) => `<option value="${escapeHtml(project.id)}"${project.id === state.project?.id ? ' selected' : ''}>${escapeHtml(project.name)}</option>`).join('')}</select></label><span class="admin-role-badge">Project admin</span></section>
          <div id="admin-content">${renderAdminPortal()}</div>` : `<section class="admin-access-empty"><div class="admin-access-icon">◎</div><h2>Create your first project</h2><p>Start a project, track its progress, and assign available crew members to the work.</p><button class="btn btn-primary" data-action="new-project">＋ Create a project</button></section>`}
      </main>
    </div>
    <div id="modal-root"></div>`;
  app.querySelectorAll('[data-admin-project-id]').forEach((button) => button.addEventListener('click', () => selectAdminProject(button.dataset.adminProjectId)));
  document.querySelector('#admin-project-select')?.addEventListener('change', (event) => selectAdminProject(event.currentTarget.value));
  app.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => handleAction(button.dataset.action)));
  wireTaskCards(document.querySelector('#admin-content') || app);
}

function rerenderBoardOnly() {
  const node = document.querySelector('#board-content');
  if (!node) return;
  node.innerHTML = state.view === 'board' ? renderBoard() : renderList();
  wireTaskCards(node);
}

function wireTaskCards(root = app) {
  root.querySelectorAll('[data-task-id]').forEach((element) => {
    element.addEventListener('click', (event) => {
      if (event.target.closest('[data-card-menu]')) return;
      openTaskDetail(element.dataset.taskId);
    });
    element.addEventListener('dragstart', () => { state.draggedTaskId = element.dataset.taskId; });
  });
  root.querySelectorAll('[data-card-menu]').forEach((button) => button.addEventListener('click', () => openTaskDetail(button.dataset.cardMenu)));
  root.querySelectorAll('[data-drop-column]').forEach((list) => {
    list.addEventListener('dragover', (event) => {
      event.preventDefault();
      list.classList.add('drag-over');
    });
    list.addEventListener('dragleave', (event) => {
      if (!list.contains(event.relatedTarget)) list.classList.remove('drag-over');
    });
    list.addEventListener('drop', async (event) => {
      event.preventDefault();
      list.classList.remove('drag-over');
      const task = state.tasks.find((item) => item.id === state.draggedTaskId);
      if (!task || task.status === list.dataset.dropColumn) return;
      await updateTask(task.id, { status: list.dataset.dropColumn });
    });
  });
  root.querySelectorAll('[data-column-add]').forEach((button) => button.addEventListener('click', () => openTaskModal(button.dataset.columnAdd)));
}

async function selectProject(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  state.project = project;
  state.adminDashboard = null;
  try {
    await refreshBoard();
    renderWorkspace();
  } catch (error) {
    toast(error.message, true);
  }
}

async function selectAdminProject(projectId) {
  const project = state.projects.find((item) => item.id === projectId && item.ownerId === state.user.id);
  if (!project) return;
  state.project = project;
  state.adminDashboard = null;
  try {
    await refreshBoard();
    await refreshAdminDashboard();
    renderWorkspace();
  } catch (error) {
    toast(error.message, true);
  }
}

async function navigateSection(section) {
  if (section === 'admin') {
    const ownedProjects = state.projects.filter((project) => project.ownerId === state.user.id);
    if (!ownedProjects.length) {
      toast('The admin portal is available to project owners.', true);
      return;
    }
    if (!ownedProjects.some((project) => project.id === state.project?.id)) state.project = ownedProjects[0];
  }
  state.section = section;
  state.notificationOpen = false;
  window.history.pushState({}, '', section === 'admin' ? '/admin' : '/');
  try {
    await loadWorkspace();
  } catch (error) {
    toast(error.message, true);
  }
}

function openModal(content, wide = false) {
  const root = document.querySelector('#modal-root');
  if (!root) return;
  root.innerHTML = `<div class="modal-backdrop"><section class="modal${wide ? ' modal-wide' : ''}" role="dialog" aria-modal="true">${content}</section></div>`;
  root.querySelector('.modal-backdrop').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeModal();
  });
  root.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeModal));
  root.querySelector('input,textarea,select,button')?.focus();
}

function closeModal() {
  const root = document.querySelector('#modal-root');
  if (root) root.innerHTML = '';
}

function openProjectModal() {
  openModal(`<div class="modal-head"><div><h2>Create a project</h2><p>A shared space for your next great thing.</p></div><button class="modal-close" data-close-modal aria-label="Close">×</button></div>
    <form id="project-form"><div class="field"><label for="project-name">Project name</label><input id="project-name" name="name" placeholder="e.g. Spring launch" required maxlength="180"></div>
    <div class="field"><label for="project-description">Description <span style="color:#aaa;font-weight:400">(optional)</span></label><textarea id="project-description" name="description" placeholder="What are you working on together?"></textarea></div>
    <p class="error-text" id="project-error"></p><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close-modal>Cancel</button><button type="submit" class="btn btn-primary">Create project</button></div></form>`);
  document.querySelector('#project-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const { project } = await api('/api/projects', { method: 'POST', body: JSON.stringify(Object.fromEntries(form.entries())) });
      state.projects.unshift(project);
      state.project = project;
      state.view = 'board';
      state.adminDashboard = null;
      await refreshBoard();
      if (state.section === 'admin') await refreshAdminDashboard();
      renderWorkspace();
      toast('Your project is ready.');
    } catch (error) { document.querySelector('#project-error').textContent = error.message; }
  });
}

function openTaskModal(status = 'Backlog') {
  openModal(`<div class="modal-head"><div><h2>Add a task</h2><p>Make the next step easy to see.</p></div><button class="modal-close" data-close-modal aria-label="Close">×</button></div>
    <form id="task-form"><div class="field"><label for="task-title">Task name</label><input id="task-title" name="title" placeholder="What needs to get done?" maxlength="180" required></div>
    <div class="field"><label for="task-description">Description</label><textarea id="task-description" name="description" placeholder="Add a little context for your team..."></textarea></div>
    <div class="form-grid"><div class="field"><label for="task-status">Status</label><select id="task-status" name="status">${columns.map((column) => `<option${column === status ? ' selected' : ''}>${column}</option>`).join('')}</select></div>
    <div class="field"><label for="task-priority">Priority</label><select id="task-priority" name="priority"><option>Low</option><option selected>Medium</option><option>High</option></select></div></div>
    <p class="error-text" id="task-error"></p><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close-modal>Cancel</button><button type="submit" class="btn btn-primary">Create task</button></div></form>`);
  document.querySelector('#task-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const { task } = await api(`/api/projects/${encodeURIComponent(state.project.id)}/tasks`, { method: 'POST', body: JSON.stringify(Object.fromEntries(form.entries())) });
      state.tasks.unshift(task);
      if (state.section === 'admin') await refreshAdminDashboard();
      closeModal();
      renderWorkspace();
      toast('Task added to the board.');
    } catch (error) { document.querySelector('#task-error').textContent = error.message; }
  });
}

async function updateTask(taskId, changes) {
  const keepDetailOpen = Boolean(document.querySelector('#modal-root .modal'));
  try {
    const { task } = await api(`/api/tasks/${encodeURIComponent(taskId)}`, { method: 'PATCH', body: JSON.stringify(changes) });
    const index = state.tasks.findIndex((item) => item.id === task.id);
    if (index >= 0) state.tasks[index] = task;
    if (state.section === 'admin') await refreshAdminDashboard();
    renderWorkspace();
    if (keepDetailOpen) await openTaskDetail(taskId);
  } catch (error) {
    toast(error.message, true);
  }
}

async function openTaskDetail(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  try {
    const { comments } = await api(`/api/tasks/${encodeURIComponent(taskId)}/comments`);
    openModal(`<div class="modal-head"><div><p class="project-kicker">${escapeHtml(state.project.name)}</p><h2>${escapeHtml(task.title)}</h2></div><button class="modal-close" data-close-modal aria-label="Close">×</button></div>
      <div class="detail-top"><div style="display:flex;gap:8px"><select class="select-control" id="detail-status" aria-label="Task status">${columns.map((column) => `<option${task.status === column ? ' selected' : ''}>${column}</option>`).join('')}</select><select class="select-control" id="detail-priority" aria-label="Task priority">${['Low', 'Medium', 'High'].map((priority) => `<option${task.priority === priority ? ' selected' : ''}>${priority} priority</option>`).join('')}</select></div><button class="btn btn-quiet" data-close-modal>Done</button></div>
      <p class="detail-section-title">Description</p><div class="detail-description">${task.description ? escapeHtml(task.description) : '<span style="color:#aaa">No description yet.</span>'}</div>
      <div class="detail-meta"><div><p class="detail-section-title">Assignee</p>${isProjectAdmin()
        ? `<select class="select-control" id="detail-assignee" style="width:100%"><option value="">Unassigned</option>${task.assignee && task.assignee.role !== 'crew' ? `<option value="${escapeHtml(task.assignee.id)}" selected>${escapeHtml(task.assignee.name)} (existing)</option>` : ''}${state.members.filter((member) => member.role === 'crew' && (member.availability === 'available' || member.id === task.assigneeId)).map((member) => `<option value="${escapeHtml(member.id)}"${task.assigneeId === member.id ? ' selected' : ''}>${escapeHtml(member.name)}${member.availability === 'unavailable' ? ' (unavailable)' : ''}</option>`).join('')}</select>`
        : `<div class="detail-description">${escapeHtml(task.assignee?.name || 'Unassigned')}</div>`}</div>
        <div><p class="detail-section-title">Due date</p><input class="select-control" id="detail-due" style="width:100%" type="date" value="${escapeHtml(task.dueDate || '')}"></div></div>
      <p class="detail-section-title">Comments · ${comments.length}</p>
      <div class="comments-list">${comments.map((comment) => `<div class="comment-item">${userAvatar(comment.user, true)}<div><strong>${escapeHtml(comment.user.name)}</strong><time>${escapeHtml(formatTime(comment.createdAt))}</time><p>${escapeHtml(comment.body)}</p></div></div>`).join('') || '<div class="empty-state">No comments yet. Start the conversation.</div>'}</div>
      <form id="comment-form" class="comment-form"><input name="body" placeholder="Write a comment..." maxlength="2000" required aria-label="Write a comment"><button class="btn btn-primary" type="submit">Send</button></form>`, true);
    document.querySelector('#detail-status').addEventListener('change', (event) => updateTask(task.id, { status: event.target.value }));
    document.querySelector('#detail-priority').addEventListener('change', (event) => updateTask(task.id, { priority: event.target.value.replace(' priority', '') }));
    document.querySelector('#detail-assignee')?.addEventListener('change', (event) => updateTask(task.id, { assigneeId: event.target.value || null }));
    document.querySelector('#detail-due').addEventListener('change', (event) => updateTask(task.id, { dueDate: event.target.value }));
    document.querySelector('#comment-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = event.currentTarget.elements.body;
      try {
        await api(`/api/tasks/${encodeURIComponent(task.id)}/comments`, { method: 'POST', body: JSON.stringify({ body: input.value }) });
        await openTaskDetail(task.id);
        await refreshBoard();
      } catch (error) { toast(error.message, true); }
    });
  } catch (error) { toast(error.message, true); }
}

async function openMembersModal() {
  let availableCrew = [];
  if (isProjectAdmin()) {
    try {
      ({ crew: availableCrew } = await api(`/api/projects/${encodeURIComponent(state.project.id)}/available-crew`));
    } catch (error) {
      toast(error.message, true);
      return;
    }
  }
  openModal(`<div class="modal-head"><div><h2>Your teammates</h2><p>Good work gets even better together.</p></div><button class="modal-close" data-close-modal aria-label="Close">×</button></div>
    ${isProjectAdmin() ? `<form class="invite-row" id="invite-form"><select class="select-control" name="userId" required aria-label="Available crew"><option value="">${availableCrew.length ? 'Select available crew' : 'No available crew accounts'}</option>${availableCrew.map((member) => `<option value="${escapeHtml(member.id)}">${escapeHtml(member.name)} · ${escapeHtml(member.email)}</option>`).join('')}</select><button class="btn btn-primary"${availableCrew.length ? '' : ' disabled'}>Assign</button></form>` : '<p class="project-description">Your project crew</p>'}
    <p class="error-text" id="invite-error"></p><div id="members-list">${state.members.map((member) => `<div class="member-row">${userAvatar(member)}<div class="profile-name"><strong>${escapeHtml(member.name)}</strong><span>${escapeHtml(member.email)}</span></div>${member.id === state.project.ownerId ? '<span class="member-count">Admin</span>' : ''}</div>`).join('')}</div>`);
  document.querySelector('#invite-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const userId = new FormData(event.currentTarget).get('userId');
    try {
      const { members } = await api(`/api/projects/${encodeURIComponent(state.project.id)}/members`, { method: 'POST', body: JSON.stringify({ userId }) });
      state.members = members;
      state.project.members = members;
      openMembersModal();
      toast('Crew member assigned to the project.');
    } catch (error) { document.querySelector('#invite-error').textContent = error.message; }
  });
}

function renderNotifications() {
  return `<aside class="notifications"><div class="notification-head"><span>Inbox</span><button data-action="mark-read">Mark all read</button></div>
    ${state.notifications.length ? state.notifications.slice(0, 8).map((item) => `<div class="notification-item"><strong>${escapeHtml(item.actorName)}</strong> ${escapeHtml(item.message)}<time>${escapeHtml(item.projectName)} · ${escapeHtml(formatTime(item.createdAt))}</time></div>`).join('') : '<div class="notification-empty">You’re all caught up. Nice.</div>'}</aside>`;
}

function wireNotifications() {
  document.querySelector('[data-action="mark-read"]')?.addEventListener('click', async () => {
    try {
      await api('/api/notifications/read', { method: 'PATCH', body: '{}' });
      state.notifications = state.notifications.map((item) => ({ ...item, read: true }));
      state.notificationOpen = false;
      renderWorkspace();
    } catch (error) { toast(error.message, true); }
  });
  document.querySelector('.notifications')?.addEventListener('click', (event) => event.stopPropagation());
}

async function handleAction(action) {
  if (action === 'new-project') return openProjectModal();
  if (action === 'new-task') return openTaskModal();
  if (action === 'members' || action === 'invite') return openMembersModal();
  if (action === 'admin-portal') return navigateSection('admin');
  if (action === 'workspace') return navigateSection('user');
  if (action === 'toggle-availability') {
    const availability = state.user.availability === 'unavailable' ? 'available' : 'unavailable';
    try {
      const { user } = await api('/api/me/availability', {
        method: 'PATCH',
        body: JSON.stringify({ availability })
      });
      state.user = user;
      renderWorkspace();
      toast(`You are now ${availability}.`);
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }
  if (action === 'logout') return logout();
  if (action === 'menu') {
    document.querySelector('#sidebar')?.classList.toggle('mobile-open');
    return;
  }
  if (action === 'notifications') {
    state.notificationOpen = !state.notificationOpen;
    renderWorkspace();
    return;
  }
  if (action === 'home') {
    state.filter = 'mine';
    state.view = 'list';
    renderWorkspace();
    return;
  }
  if (action === 'board') {
    state.filter = 'all';
    state.view = 'board';
    renderWorkspace();
  }
}

async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST', body: '{}' });
  } catch (error) {
    toast(error.message, true);
    return;
  }
  state.socket?.close();
  state.user = null;
  state.projects = [];
  state.project = null;
  state.tasks = [];
  state.adminDashboard = null;
  state.section = 'user';
  state.view = 'board';
  window.history.pushState({}, '', '/');
  showAuth();
}

window.addEventListener('popstate', async () => {
  state.section = location.pathname === '/admin' ? 'admin' : 'user';
  if (!state.user) return showAuth();
  try {
    await loadWorkspace();
  } catch (error) {
    toast(error.message, true);
  }
});

document.addEventListener('click', (event) => {
  if (!state.notificationOpen || event.target.closest('.notifications') || event.target.closest('[data-action="notifications"]')) return;
  state.notificationOpen = false;
  if (state.user) renderWorkspace();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModal();
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    document.querySelector('#search-input')?.focus();
  }
});

async function init() {
  setLoading();
  try {
    const { user } = await api('/api/me');
    state.user = user;
    await loadWorkspace();
  } catch {
    showAuth();
  }
}

init();
