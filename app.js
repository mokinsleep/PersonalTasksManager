'use strict';

/* ============================
 * 统一数据存储规范
 * ============================ */

const DATA_STRUCTURE = window.DATA_STRUCTURE || {
  tasks: [],
  groups: [],
  dailyTodos: {},
  theme: 'light',
  sidebarCollapsed: false,
  backupDir: ''
};
if (!window.DATA_STRUCTURE) window.DATA_STRUCTURE = DATA_STRUCTURE;

const DATA_STORAGE_KEY = 'task-board-data';

function loadData() {
  let data = {};
  let migrated = [];
  try {
    const raw = localStorage.getItem(DATA_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        data = { tasks: parsed };
        migrated.push('tasks (旧数组格式 → 对象格式)');
      } else if (parsed && typeof parsed === 'object') {
        data = parsed;
      }
    }
  } catch (e) {
    console.warn('⚠️ 读取主数据失败，将使用默认值', e);
  }
  // 迁移旧的分散 key
  try {
    const oldDaily = localStorage.getItem('daily-todo-data');
    if (oldDaily && !data.dailyTodos) {
      const parsed = JSON.parse(oldDaily);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        data.dailyTodos = parsed;
        migrated.push('dailyTodos (从 daily-todo-data 迁移)');
      }
    }
  } catch (e) {}
  try {
    const oldTheme = localStorage.getItem('left-sidebar-theme');
    if (oldTheme && typeof oldTheme === 'string' && !data.theme) {
      data.theme = oldTheme;
      migrated.push('theme (从 left-sidebar-theme 迁移)');
    }
  } catch (e) {}
  try {
    const oldSidebar = localStorage.getItem('left-sidebar-state');
    if (oldSidebar) {
      const s = JSON.parse(oldSidebar);
      if (s && typeof s.expanded === 'boolean' && data.sidebarCollapsed === undefined) {
        data.sidebarCollapsed = !s.expanded;
        migrated.push('sidebarCollapsed (从 left-sidebar-state 迁移)');
      }
    }
  } catch (e) {}
  if (migrated.length > 0) {
    console.log('📦 数据迁移完成:', migrated.join(' | '));
  }
  // 合并默认值 + 类型校验
  const result = {};
  for (const [key, defaultVal] of Object.entries(DATA_STRUCTURE)) {
    let val = data[key];
    if (Array.isArray(defaultVal)) {
      result[key] = Array.isArray(val) ? val : [];
    } else if (typeof defaultVal === 'object' && defaultVal !== null) {
      result[key] = (val && typeof val === 'object' && !Array.isArray(val)) ? val : {};
    } else if (typeof defaultVal === 'boolean') {
      result[key] = typeof val === 'boolean' ? val : defaultVal;
    } else if (typeof defaultVal === 'string') {
      result[key] = typeof val === 'string' ? val : defaultVal;
    } else {
      result[key] = val !== undefined ? val : defaultVal;
    }
  }
  return result;
}

function saveData(data) {
  const filtered = {};
  for (const [key, defaultVal] of Object.entries(DATA_STRUCTURE)) {
    if (!(key in data)) continue;
    let val = data[key];
    if (Array.isArray(defaultVal)) {
      filtered[key] = Array.isArray(val) ? val : [];
    } else if (typeof defaultVal === 'object' && defaultVal !== null) {
      filtered[key] = (val && typeof val === 'object' && !Array.isArray(val)) ? val : {};
    } else if (typeof defaultVal === 'boolean') {
      filtered[key] = typeof val === 'boolean' ? val : defaultVal;
    } else if (typeof defaultVal === 'string') {
      filtered[key] = typeof val === 'string' ? val : defaultVal;
    } else {
      filtered[key] = val;
    }
  }
  try {
    localStorage.setItem(DATA_STORAGE_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.error('❌ 数据保存失败', e);
  }
}

function updateDataField(key, value) {
  const data = loadData();
  data[key] = value;
  saveData(data);
}

// 暴露到全局供 group-manager.js 等外部模块使用
if (!window.loadData) window.loadData = loadData;
if (!window.updateDataField) window.updateDataField = updateDataField;
if (!window.saveData) window.saveData = saveData;

/* ============================
 * DataStorage — 数据存储抽象层
 * 支持：File System Access API（优先）+ localStorage（回退/备份）
 * ============================ */

class DataStorage {
  constructor() {
    this._mode = 'localStorage';
    this._dirHandle = null;
    this._dirName = '';
    this._localKey = 'task-board-data';
    this._configKey = 'task-board-config';
    this._fsAvailable = (typeof window.showDirectoryPicker === 'function');
  }
  get mode() { return this._mode; }
  get dirName() { return this._dirName; }
  get fsAvailable() { return this._fsAvailable; }
  async init() {
    try {
      const cfgRaw = localStorage.getItem(this._configKey);
      if (!cfgRaw) return;
      const cfg = JSON.parse(cfgRaw);
      if (cfg.mode === 'fileSystem' && cfg.dirName && this._fsAvailable) {
        try {
          this._dirHandle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'desktop' });
          if (this._dirHandle.name !== cfg.dirName) {
            this._dirHandle = null;
            this._mode = 'localStorage';
            this._dirName = '';
            this._saveConfig();
            return;
          }
          this._mode = 'fileSystem';
          this._dirName = cfg.dirName;
          console.log(`📁 已恢复文件存储目录: ${this._dirName}`);
        } catch (e) {
          console.warn('恢复文件目录权限失败，使用 localStorage', e);
          this._mode = 'localStorage';
          this._dirHandle = null;
          this._dirName = '';
          this._saveConfig();
        }
      }
    } catch (e) {
      console.warn('DataStorage 初始化失败', e);
    }
  }
  async selectDirectory() {
    if (!this._fsAvailable) {
      throw new Error('当前浏览器不支持 File System Access API（需要 Chrome 86+/Edge 86+）');
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'desktop' });
      this._dirHandle = handle;
      this._dirName = handle.name;
      this._mode = 'fileSystem';
      this._saveConfig();
      return this._dirName;
    } catch (e) {
      if (e.name === 'AbortError') return null;
      throw e;
    }
  }
  switchToLocal() {
    this._mode = 'localStorage';
    this._dirHandle = null;
    this._dirName = '';
    this._saveConfig();
  }
  _saveConfig() {
    const cfg = { mode: this._mode, dirName: this._dirName };
    localStorage.setItem(this._configKey, JSON.stringify(cfg));
  }
  async loadFromFile() {
    if (!this._dirHandle) throw new Error('未设置文件目录');
    try {
      let fileHandle;
      try {
        fileHandle = await this._dirHandle.getFileHandle('tasks.json');
      } catch {
        return [];
      }
      const file = await fileHandle.getFile();
      const text = await file.text();
      return JSON.parse(text);
    } catch (e) {
      console.warn('从文件读取数据失败', e);
      throw e;
    }
  }
  async saveToFile(data) {
    if (!this._dirHandle) throw new Error('未设置文件目录');
    try {
      const fileHandle = await this._dirHandle.getFileHandle('tasks.json', { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(data, null, 2));
      await writable.close();
      return true;
    } catch (e) {
      console.error('写入文件失败', e);
      throw e;
    }
  }
  loadFromLocal() {
    try {
      const data = loadData();
      return Array.isArray(data.tasks) ? data.tasks : [];
    } catch (e) {
      console.warn('localStorage 读取失败', e);
      return [];
    }
  }
  saveToLocal(data) {
    try {
      updateDataField('tasks', Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('localStorage 写入失败', e);
    }
  }
}

/* ============================
 * TaskManager — 数据管理层
 * ============================ */

class TaskManager {
  constructor(dataStorage) {
    this._ds = dataStorage;
    this.tasks = [];
  }
  async init() {
    await this._ds.init();
    if (this._ds.mode === 'fileSystem' && this._ds.fsAvailable) {
      try {
        this.tasks = await this._ds.loadFromFile();
        console.log(`📁 已从文件加载 ${this.tasks.length} 个任务`);
      } catch (e) {
        console.warn('文件加载失败，回退到 localStorage', e);
        const data = loadData();
        this.tasks = Array.isArray(data.tasks) ? data.tasks : [];
      }
    } else {
      const data = loadData();
      this.tasks = Array.isArray(data.tasks) ? data.tasks : [];
      this.groups = Array.isArray(data.groups) ? data.groups : [];
      console.log(`💾 已从统一存储加载 ${this.tasks.length} 个任务`);
    }
    this.tasks = this.tasks.map(t => ({
      id: t.id || crypto.randomUUID(),
      title: t.title || '',
      description: t.description || '',
      dueDate: t.dueDate || '',
      priority: t.priority || 'medium',
      tags: Array.isArray(t.tags) ? t.tags : [],
      status: t.status || 'todo',
      createdAt: t.createdAt || Date.now(),
      progress: Array.isArray(t.progress) ? t.progress : []
    }));
    await this._persist();
  }
  async _persist() {
    if (this._ds.mode === 'fileSystem' && this._ds.fsAvailable) {
      try {
        await this._ds.saveToFile(this.tasks);
      } catch (e) {
        console.warn('文件写入失败，使用 localStorage 备份', e);
        this._ds.saveToLocal(this.tasks);
      }
    }
    this._ds.saveToLocal(this.tasks);
  }
  async setFileDirectory() {
    const dirName = await this._ds.selectDirectory();
    if (!dirName) return null;
    await this._persist();
    return dirName;
  }
  async switchToLocalStorage() {
    this._ds.switchToLocal();
    await this._persist();
  }
  get storageMode() { return this._ds.mode; }
  get storageDirName() { return this._ds.dirName; }
  getAll() { return this.tasks; }
  getById(id) { return this.tasks.find(t => t.id === id) || null; }
  async add(taskData) {
    const task = {
      id: crypto.randomUUID(),
      title: taskData.title || '未命名任务',
      description: taskData.description || '',
      dueDate: taskData.dueDate || '',
      priority: taskData.priority || 'medium',
      tags: Array.isArray(taskData.tags) ? [...taskData.tags] : [],
      status: taskData.status || 'todo',
      createdAt: Date.now(),
      progress: []
    };
    this.tasks.push(task);
    await this._persist();
    return task;
  }
  async update(id, updates) {
    const idx = this.tasks.findIndex(t => t.id === id);
    if (idx === -1) return null;
    this.tasks[idx] = { ...this.tasks[idx], ...updates };
    await this._persist();
    return this.tasks[idx];
  }
  async delete(id) {
    const idx = this.tasks.findIndex(t => t.id === id);
    if (idx === -1) return false;
    this.tasks.splice(idx, 1);
    await this._persist();
    return true;
  }
  async deleteMany(ids) {
    const idSet = new Set(ids);
    this.tasks = this.tasks.filter(t => !idSet.has(t.id));
    await this._persist();
  }
  async copy(id) {
    const original = this.getById(id);
    if (!original) return null;
    const copy = {
      ...original,
      id: crypto.randomUUID(),
      title: original.title + ' (副本)',
      createdAt: Date.now(),
      progress: original.progress ? original.progress.map(p => ({...p})) : []
    };
    this.tasks.push(copy);
    await this._persist();
    return copy;
  }
  async addProgress(taskId, text) {
    const task = this.getById(taskId);
    if (!task) return null;
    if (!Array.isArray(task.progress)) task.progress = [];
    const record = { text: text.trim(), time: Date.now() };
    task.progress.push(record);
    await this._persist();
    return record;
  }
  async deleteProgress(taskId, index) {
    const task = this.getById(taskId);
    if (!task || !Array.isArray(task.progress)) return false;
    if (index < 0 || index >= task.progress.length) return false;
    task.progress.splice(index, 1);
    await this._persist();
    return true;
  }
  async updateProgress(taskId, index, newText) {
    const task = this.getById(taskId);
    if (!task || !Array.isArray(task.progress)) return false;
    if (index < 0 || index >= task.progress.length) return false;
    task.progress[index].text = newText.trim();
    await this._persist();
    return true;
  }
  getFilteredAndSorted(filters, sortBy) {
    let result = [...this.tasks];
    if (filters.priority && filters.priority !== 'all') {
      result = result.filter(t => t.priority === filters.priority);
    }
    if (filters.tag && filters.tag !== 'all') {
      result = result.filter(t => t.tags && t.tags.includes(filters.tag));
    }
    if (filters.date && filters.date !== 'all') {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(todayStart.getTime() + 86400000);
      if (filters.date === 'today') {
        result = result.filter(t => t.dueDate && new Date(t.dueDate + 'T00:00:00') >= todayStart && new Date(t.dueDate + 'T00:00:00') < todayEnd);
      } else if (filters.date === 'week') {
        const dayOfWeek = now.getDay() || 7;
        const weekStart = new Date(todayStart);
        weekStart.setDate(weekStart.getDate() - dayOfWeek + 1);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);
        result = result.filter(t => t.dueDate && new Date(t.dueDate + 'T00:00:00') >= weekStart && new Date(t.dueDate + 'T00:00:00') < weekEnd);
      } else if (filters.date === 'month') {
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        result = result.filter(t => t.dueDate && new Date(t.dueDate + 'T00:00:00') >= monthStart && new Date(t.dueDate + 'T00:00:00') < monthEnd);
      }
    }
    if (sortBy === 'dueDate') {
      result.sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return new Date(a.dueDate) - new Date(b.dueDate);
      });
    } else if (sortBy === 'priority') {
      const order = { high: 0, medium: 1, low: 2 };
      result.sort((a, b) => (order[a.priority] ?? 1) - (order[b.priority] ?? 1));
    } else {
      result.sort((a, b) => b.createdAt - a.createdAt);
    }
    return result;
  }
  getAllTags() {
    const tagSet = new Set();
    this.tasks.forEach(t => { if (Array.isArray(t.tags)) t.tags.forEach(tag => tagSet.add(tag)); });
    return [...tagSet].sort();
  }
  getStats() {
    const total = this.tasks.length;
    const done = this.tasks.filter(t => t.status === 'done').length;
    return { total, done, undone: total - done };
  }

  // Groups CRUD 方法已迁移至 group-manager.js
}

/* ============================
 * UIManager — UI 渲染与交互层
 * ============================ */

class UIManager {
  constructor(taskManager) {
    this.tm = taskManager;
    this.draggingTaskId = null;
    this.selectedCardIds = new Set();
    this.contextMenuTargetId = null;
    this.cacheDom();
    this.bindEvents();
    this.refreshAll();
    this.updateDataDirIndicator();
  }
  cacheDom() {
    this.$board = document.getElementById('board');
    this.$batchBar = document.getElementById('batchBar');
    this.$batchCount = document.getElementById('batchCount');
    this.$contextMenu = document.getElementById('contextMenu');
    this.$modalContainer = document.getElementById('modalContainer');
    this.$toastContainer = document.getElementById('toastContainer');
    this.$statTotal = document.getElementById('statTotal');
    this.$statDone = document.getElementById('statDone');
    this.$statUndone = document.getElementById('statUndone');
    this.$filterPriority = document.getElementById('filterPriority');
    this.$filterTag = document.getElementById('filterTag');
    this.$filterDate = document.getElementById('filterDate');
    this.$sortBy = document.getElementById('sortBy');
    this.$btnBatchDelete = document.getElementById('btnBatchDelete');
    this.$btnBatchCancel = document.getElementById('btnBatchCancel');
    this.$btnDataDir = document.getElementById('btnDataDir');
    this.$dataDirIndicator = document.getElementById('dataDirIndicator');
    this.columnMap = {
      'todo': { list: document.getElementById('listTodo'), count: document.getElementById('countTodo') },
      'in-progress': { list: document.getElementById('listInProgress'), count: document.getElementById('countInProgress') },
      'done': { list: document.getElementById('listDone'), count: document.getElementById('countDone') }
    };
  }
  bindEvents() {
    this._mouseDownPos = null;
    this._mouseMoved = false;
    document.querySelectorAll('.btn-add-task').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const status = e.currentTarget.dataset.status;
        this.openModal(null, status);
      });
    });
    this.$board.addEventListener('mousedown', (e) => {
      const card = e.target.closest('.task-card');
      if (card && e.button === 0) {
        this._mouseDownPos = { x: e.clientX, y: e.clientY };
        this._mouseMoved = false;
      }
    });
    this.$board.addEventListener('mousemove', (e) => {
      if (this._mouseDownPos) {
        const dx = Math.abs(e.clientX - this._mouseDownPos.x);
        const dy = Math.abs(e.clientY - this._mouseDownPos.y);
        if (dx > 5 || dy > 5) this._mouseMoved = true;
      }
    });
    this.$board.addEventListener('click', (e) => {
      const card = e.target.closest('.task-card');
      if (!card) return;
      if (e.target.classList.contains('card-checkbox')) return;
      if (this._mouseMoved) return;
      this.openModal(card.dataset.taskId);
    });
    document.addEventListener('mouseup', () => {
      this._mouseDownPos = null;
    });
    this.$board.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.task-card');
      if (!card) return;
      this.draggingTaskId = card.dataset.taskId;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.taskId);
    });
    this.$board.addEventListener('dragend', (e) => {
      const card = e.target.closest('.task-card');
      if (card) card.classList.remove('dragging');
      this.draggingTaskId = null;
      this._mouseMoved = false;
      document.querySelectorAll('.column').forEach(col => col.classList.remove('drag-over'));
    });
    document.querySelectorAll('.column').forEach(column => {
      column.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        column.classList.add('drag-over');
      });
      column.addEventListener('dragleave', (e) => {
        if (!column.contains(e.relatedTarget)) column.classList.remove('drag-over');
      });
      column.addEventListener('drop', (e) => {
        e.preventDefault();
        column.classList.remove('drag-over');
        const newStatus = column.dataset.status;
        const taskId = e.dataTransfer.getData('text/plain');
        if (taskId && newStatus) {
          this.moveTask(taskId, newStatus);
        }
      });
    });
    this.$board.addEventListener('contextmenu', (e) => {
      const card = e.target.closest('.task-card');
      if (card) {
        e.preventDefault();
        this.contextMenuTargetId = card.dataset.taskId;
        this.showContextMenu(e.clientX, e.clientY);
      }
    });
    document.addEventListener('click', (e) => {
      if (!this.$contextMenu.contains(e.target)) this.hideContextMenu();
    });
    this.$contextMenu.addEventListener('click', (e) => {
      const menuItem = e.target.closest('.menu-item');
      if (!menuItem) return;
      this.handleContextAction(menuItem.dataset.action, this.contextMenuTargetId);
      this.hideContextMenu();
    });
    this.$board.addEventListener('change', (e) => {
      if (e.target.classList.contains('card-checkbox')) {
        const taskId = e.target.dataset.taskId;
        if (e.target.checked) this.selectedCardIds.add(taskId);
        else this.selectedCardIds.delete(taskId);
        this.updateBatchBar();
      }
    });
    this.$btnBatchDelete.addEventListener('click', () => {
      if (this.selectedCardIds.size === 0) return;
      if (confirm(`确定要删除选中的 ${this.selectedCardIds.size} 个任务吗？此操作不可撤销。`)) {
        this.tm.deleteMany([...this.selectedCardIds]);
        this.selectedCardIds.clear();
        this.updateBatchBar();
        this.refreshAll();
        this.showToast('已删除选中任务');
      }
    });
    this.$btnBatchCancel.addEventListener('click', () => {
      this.selectedCardIds.clear();
      this.updateBatchBar();
      this.refreshAll();
    });
    [this.$filterPriority, this.$filterTag, this.$filterDate, this.$sortBy].forEach(el => {
      el.addEventListener('change', () => this.refreshBoard());
    });
    this.$btnDataDir.addEventListener('click', () => this.handleDataDir());
  }
  refreshAll() {
    this.refreshBoard();
    this.refreshStats();
    this.refreshTagFilter();
  }
  refreshBoard() {
    const filters = {
      priority: this.$filterPriority.value,
      tag: this.$filterTag.value,
      date: this.$filterDate.value
    };
    const sortBy = this.$sortBy.value;
    const filteredTasks = this.tm.getFilteredAndSorted(filters, sortBy);
    const grouped = { 'todo': [], 'in-progress': [], 'done': [] };
    filteredTasks.forEach(t => {
      if (grouped[t.status]) grouped[t.status].push(t);
      else grouped['todo'].push(t);
    });
    Object.entries(grouped).forEach(([status, tasks]) => {
      const col = this.columnMap[status];
      if (!col) return;
      col.list.innerHTML = '';
      col.count.textContent = tasks.length;
      tasks.forEach(task => col.list.appendChild(this.createCardElement(task)));
    });
    this.restoreCheckboxStates();
  }
  refreshStats() {
    const stats = this.tm.getStats();
    this.$statTotal.textContent = stats.total;
    this.$statDone.textContent = stats.done;
    this.$statUndone.textContent = stats.undone;
  }
  refreshTagFilter() {
    const tags = this.tm.getAllTags();
    const currentValue = this.$filterTag.value;
    this.$filterTag.innerHTML = '<option value="all">全部</option>';
    tags.forEach(tag => {
      const opt = document.createElement('option');
      opt.value = tag;
      opt.textContent = tag;
      this.$filterTag.appendChild(opt);
    });
    if (tags.includes(currentValue)) this.$filterTag.value = currentValue;
  }
  // 卡片组渲染方法（createGroupElement, openGroupModal 等）已迁移至 group-manager.js
  createCardElement(task) {
    const card = document.createElement('div');
    card.className = 'task-card';
    card.dataset.taskId = task.id;
    card.draggable = true;
    const priorityLabels = { high: '🔴 高', medium: '🟡 中', low: '🟢 低' };
    let dueDateHtml = '';
    if (task.dueDate) {
      const dueDate = new Date(task.dueDate + 'T00:00:00');
      const today = new Date(); today.setHours(0,0,0,0);
      const isOverdue = dueDate < today && task.status !== 'done';
      dueDateHtml = `<span class="due-date ${isOverdue ? 'overdue' : ''}">📅 ${task.dueDate}${isOverdue ? ' (已逾期)' : ''}</span>`;
    }
    let tagsHtml = '';
    if (task.tags && task.tags.length > 0) {
      tagsHtml = '<span class="category-tags">' + task.tags.map(t => `<span class="category-tag">${this.escapeHtml(t)}</span>`).join('') + '</span>';
    }
    let descHtml = '';
    if (task.description) descHtml = `<div class="card-desc">${this.escapeHtml(task.description)}</div>`;
    let progressPreviewHtml = '';
    if (task.progress && task.progress.length > 0) {
      const latestProgress = task.progress[task.progress.length - 1];
      const previewText = latestProgress.text.length > 30 ? latestProgress.text.slice(0, 30) + '…' : latestProgress.text;
      progressPreviewHtml = `<div class="card-progress-preview"><span class="progress-label">💬</span>${this.escapeHtml(previewText)}</div>`;
    }
    card.innerHTML = `
      <input type="checkbox" class="card-checkbox" data-task-id="${task.id}">
      <div class="card-title">${this.escapeHtml(task.title)}</div>
      ${descHtml}
      ${progressPreviewHtml}
      <div class="card-meta">
        <span class="priority-tag ${task.priority}">${priorityLabels[task.priority]}</span>
        ${tagsHtml}
        ${dueDateHtml}
      </div>
    `;
    return card;
  }
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  restoreCheckboxStates() {
    this.selectedCardIds.forEach(taskId => {
      const cb = document.querySelector(`.card-checkbox[data-task-id="${taskId}"]`);
      if (cb) cb.checked = true;
    });
    this.updateBatchBar();
  }
  updateBatchBar() {
    if (this.selectedCardIds.size > 0) {
      this.$batchBar.classList.add('visible');
      this.$batchCount.textContent = `已选择 ${this.selectedCardIds.size} 项`;
    } else {
      this.$batchBar.classList.remove('visible');
    }
  }
  moveTask(taskId, newStatus) {
    const task = this.tm.getById(taskId);
    if (!task || task.status === newStatus) return;
    this.tm.update(taskId, { status: newStatus });
    this.refreshAll();
    const statusLabels = { 'todo': '待处理', 'in-progress': '进行中', 'done': '已完成' };
    this.showToast(`已移至「${statusLabels[newStatus]}」`);
  }
  showContextMenu(x, y) {
    this.$contextMenu.classList.add('show');
    let left = x, top = y;
    if (left + 160 > window.innerWidth) left = window.innerWidth - 170;
    if (top + 220 > window.innerHeight) top = window.innerHeight - 230;
    this.$contextMenu.style.left = left + 'px';
    this.$contextMenu.style.top = top + 'px';
  }
  hideContextMenu() {
    this.$contextMenu.classList.remove('show');
    this.contextMenuTargetId = null;
  }
  handleContextAction(action, taskId) {
    if (!taskId) return;
    const task = this.tm.getById(taskId);
    if (!task) return;
    switch (action) {
      case 'edit': this.openModal(taskId); break;
      case 'copy': {
        const copy = this.tm.copy(taskId);
        if (copy) { this.refreshAll(); this.showToast('已复制任务'); }
        break;
      }
      case 'move-todo': this.moveTask(taskId, 'todo'); break;
      case 'move-progress': this.moveTask(taskId, 'in-progress'); break;
      case 'move-done': this.moveTask(taskId, 'done'); break;
      case 'delete': {
        if (confirm('确定要删除这个任务吗？')) {
          this.tm.delete(taskId);
          this.selectedCardIds.delete(taskId);
          this.updateBatchBar();
          this.refreshAll();
          this.showToast('已删除任务');
        }
        break;
      }
    }
  }
  /* ---------- 数据目录管理 ---------- */
  updateDataDirIndicator() {
    const mode = this.tm.storageMode;
    if (mode === 'fileSystem') {
      this.$dataDirIndicator.textContent = `📁 ${this.tm.storageDirName}/tasks.json`;
      this.$dataDirIndicator.className = 'data-dir-indicator file-mode';
      this.$btnDataDir.textContent = '🔄 切换回 localStorage';
    } else {
      this.$dataDirIndicator.textContent = '💾 localStorage';
      this.$dataDirIndicator.className = 'data-dir-indicator';
      this.$btnDataDir.textContent = '📁 设置数据目录';
    }
  }
  async handleDataDir() {
    if (this.tm.storageMode === 'fileSystem') {
      if (!confirm('切换回 localStorage 模式后，数据将不再自动保存到文件。\n\n（已保存的 tasks.json 文件不会被删除）')) return;
      await this.tm.switchToLocalStorage();
      this.refreshAll();
      this.updateDataDirIndicator();
      this.showToast('已切换回 localStorage 模式');
    } else {
      try {
        const dirName = await this.tm.setFileDirectory();
        if (dirName) {
          this.refreshAll();
          this.updateDataDirIndicator();
          this.showToast(`数据目录已设置为「${dirName}」`);
        }
      } catch (e) {
        console.error(e);
        this.showToast('⚠️ 设置失败: ' + e.message);
      }
    }
  }
  /* ---------- Modal ---------- */
  openModal(taskIdOrNull, presetStatus) {
    const isEdit = taskIdOrNull !== null;
    const task = isEdit ? this.tm.getById(taskIdOrNull) : null;
    const initialStatus = isEdit ? task.status : (presetStatus || 'todo');
    const initialTags = isEdit ? (task.tags || []) : [];
    const modalHtml = `
      <div class="modal-overlay" id="modalOverlay">
        <div class="modal" id="modal">
          <h2>${isEdit ? '编辑任务' : '新增任务'}</h2>
          <div class="form-group"><label>标题 *</label><input type="text" id="inputTitle" value="${isEdit ? this.escapeHtml(task.title) : ''}" placeholder="输入任务标题" autofocus></div>
          <div class="form-group"><label>描述</label><textarea id="inputDesc" placeholder="添加详细描述（可选）">${isEdit ? this.escapeHtml(task.description) : ''}</textarea></div>
          <div class="form-group"><label>截止日期</label><input type="date" id="inputDueDate" value="${isEdit ? task.dueDate : ''}"></div>
          <div class="form-group"><label>优先级</label>
            <select id="inputPriority">
              <option value="high" ${(isEdit && task.priority === 'high') ? 'selected' : ''}>🔴 高优先级</option>
              <option value="medium" ${(!isEdit || task.priority === 'medium') ? 'selected' : ''}>🟡 中优先级</option>
              <option value="low" ${(isEdit && task.priority === 'low') ? 'selected' : ''}>🟢 低优先级</option>
            </select>
          </div>
          <div class="form-group"><label>状态</label>
            <select id="inputStatus">
              <option value="todo" ${initialStatus === 'todo' ? 'selected' : ''}>📌 待处理</option>
              <option value="in-progress" ${initialStatus === 'in-progress' ? 'selected' : ''}>🔄 进行中</option>
              <option value="done" ${initialStatus === 'done' ? 'selected' : ''}>✅ 已完成</option>
            </select>
          </div>
          <div class="form-group"><label>标签</label>
            <div class="tag-input-wrapper" id="tagWrapper">
              ${initialTags.map(tag => `<span class="tag-chip"><span>${this.escapeHtml(tag)}</span><span class="tag-remove" data-tag="${this.escapeHtml(tag)}">&times;</span></span>`).join('')}
              <input type="text" class="tag-input" id="inputTag" placeholder="输入标签后回车">
            </div>
          </div>
          ${isEdit ? `
          <div class="progress-section" id="progressSection">
            <button class="progress-section-toggle" id="progressToggle" type="button">
              <span>💬 进展记录 <span id="progressBadge" style="font-size:11px;color:var(--text-muted);font-weight:400;"></span></span>
              <span class="toggle-icon">▼</span>
            </button>
            <div class="progress-section-body" id="progressBody">
              <div class="progress-history" id="progressHistory"></div>
              <div class="progress-add-bar">
                <textarea id="progressInput" placeholder="输入进展内容…" rows="2"></textarea>
                <button class="btn-progress-add" id="btnProgressAdd" type="button">添加</button>
              </div>
            </div>
          </div>
          ` : ''}
          <div class="form-actions">
            <button class="btn-secondary" id="btnModalCancel">取消</button>
            <button class="btn-primary" id="btnModalSave">${isEdit ? '保存修改' : '创建任务'}</button>
          </div>
        </div>
      </div>
    `;
    this.$modalContainer.innerHTML = modalHtml;
    const $overlay = document.getElementById('modalOverlay');
    const $inputTitle = document.getElementById('inputTitle');
    const $inputDesc = document.getElementById('inputDesc');
    const $inputDueDate = document.getElementById('inputDueDate');
    const $inputPriority = document.getElementById('inputPriority');
    const $inputStatus = document.getElementById('inputStatus');
    const $tagWrapper = document.getElementById('tagWrapper');
    const $inputTag = document.getElementById('inputTag');
    let currentTags = [...initialTags];
    const renderTags = () => {
      $tagWrapper.querySelectorAll('.tag-chip').forEach(c => c.remove());
      currentTags.forEach(tag => {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.innerHTML = `<span>${this.escapeHtml(tag)}</span><span class="tag-remove" data-tag="${this.escapeHtml(tag)}">&times;</span>`;
        chip.querySelector('.tag-remove').addEventListener('click', () => {
          currentTags = currentTags.filter(t => t !== tag);
          renderTags();
        });
        $tagWrapper.insertBefore(chip, $inputTag);
      });
    };
    const addTag = (tagName) => {
      const trimmed = tagName.trim();
      if (!trimmed || currentTags.includes(trimmed)) { $inputTag.value = ''; return; }
      currentTags.push(trimmed);
      $inputTag.value = '';
      renderTags();
    };
    $inputTag.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addTag($inputTag.value); }
      else if (e.key === 'Backspace' && $inputTag.value === '' && currentTags.length > 0) { currentTags.pop(); renderTags(); }
    });
    $tagWrapper.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.tag-remove');
      if (removeBtn) {
        currentTags = currentTags.filter(t => t !== removeBtn.dataset.tag);
        renderTags();
      }
    });
    if (isEdit) {
      const $progressToggle = document.getElementById('progressToggle');
      const $progressBody = document.getElementById('progressBody');
      const $progressHistory = document.getElementById('progressHistory');
      const $progressBadge = document.getElementById('progressBadge');
      const $progressInput = document.getElementById('progressInput');
      const $btnProgressAdd = document.getElementById('btnProgressAdd');
      let progressExpanded = false;
      const formatTime = (timestamp) => {
        const d = new Date(timestamp);
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      };
      const getProgressList = () => {
        const t = this.tm.getById(taskIdOrNull);
        return (t && Array.isArray(t.progress)) ? t.progress : [];
      };
      const renderHistory = () => {
        const plist = getProgressList();
        $progressBadge.textContent = plist.length > 0 ? `(${plist.length}条)` : '';
        if (plist.length === 0) {
          $progressHistory.innerHTML = '<div class="progress-empty">暂无进展记录，在下方添加第一条</div>';
          return;
        }
        $progressHistory.innerHTML = plist.map((p, i) => ({...p, _rawIdx: i})).reverse().map(p => `
          <div class="progress-item" data-progress-index="${p._rawIdx}">
            <div class="progress-avatar">💬</div>
            <div class="progress-content">
              <div class="progress-text" id="progressText_${p._rawIdx}">${this.escapeHtml(p.text)}</div>
              <div class="progress-time">${formatTime(p.time)}</div>
            </div>
            <button class="progress-delete" data-progress-index="${p._rawIdx}" title="编辑此进展">✏️</button>
            <button class="progress-delete" data-progress-index="${p._rawIdx}" title="删除此进展">&times;</button>
          </div>
        `).join('');
        $progressHistory.querySelectorAll('.progress-delete').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.progressIndex, 10);
            if (isNaN(idx)) return;
            if (btn.textContent.trim() === '×') {
              if (confirm('确定要删除这条进展记录吗？')) {
                this.tm.deleteProgress(taskIdOrNull, idx);
                renderHistory();
                this.refreshBoard();
              }
            } else {
              this._startProgressEdit(taskIdOrNull, idx, renderHistory);
            }
          });
        });
      };
      $progressToggle.addEventListener('click', () => {
        progressExpanded = !progressExpanded;
        if (progressExpanded) { $progressBody.classList.add('show'); $progressToggle.classList.add('expanded'); }
        else { $progressBody.classList.remove('show'); $progressToggle.classList.remove('expanded'); }
      });
      const addProgress = () => {
        const text = $progressInput.value.trim();
        if (!text) return;
        this.tm.addProgress(taskIdOrNull, text);
        $progressInput.value = '';
        renderHistory();
        this.refreshBoard();
      };
      $btnProgressAdd.addEventListener('click', addProgress);
      $progressInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addProgress(); }
      });
      renderHistory();
    }
    const closeModal = () => { this.$modalContainer.innerHTML = ''; };
    $overlay.addEventListener('click', (e) => { if (e.target === $overlay) closeModal(); });
    document.getElementById('btnModalCancel').addEventListener('click', closeModal);
    document.getElementById('btnModalSave').addEventListener('click', () => {
      const title = $inputTitle.value.trim();
      if (!title) { this.showToast('⚠️ 请输入任务标题'); $inputTitle.focus(); return; }
      const taskData = {
        title, description: $inputDesc.value.trim(), dueDate: $inputDueDate.value,
        priority: $inputPriority.value, status: $inputStatus.value, tags: currentTags
      };
      if (isEdit) { this.tm.update(taskIdOrNull, taskData); this.showToast('✅ 任务已更新'); }
      else { this.tm.add(taskData); this.showToast('✅ 任务已创建'); }
      closeModal();
      this.refreshAll();
    });
    const escHandler = (e) => {
      if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);
    setTimeout(() => $inputTitle.focus(), 100);
  }
  _startProgressEdit(taskId, index, renderHistoryFn) {
    const $textEl = document.getElementById('progressText_' + index);
    if (!$textEl) return;
    const task = this.tm.getById(taskId);
    if (!task || !Array.isArray(task.progress) || index >= task.progress.length) return;
    const originalText = task.progress[index].text;
    $textEl.innerHTML = `
      <div style="display:flex;gap:6px;align-items:flex-start;">
        <textarea class="progress-edit-input" id="progressEditInput_${index}" rows="2" style="flex:1;padding:6px 10px;border:1px solid #7c8ce0;border-radius:6px;font-size:13px;font-family:inherit;color:var(--text-primary);outline:none;resize:none;">${this.escapeHtml(originalText)}</textarea>
        <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
          <button class="progress-edit-save" data-idx="${index}" style="padding:4px 10px;background:#4f6ef7;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:12px;font-family:inherit;white-space:nowrap;">保存</button>
          <button class="progress-edit-cancel" data-idx="${index}" style="padding:4px 10px;background:#f3f4f6;color:var(--text-primary);border:1px solid #d1d5db;border-radius:5px;cursor:pointer;font-size:12px;font-family:inherit;white-space:nowrap;">取消</button>
        </div>
      </div>
    `;
    const $editInput = document.getElementById('progressEditInput_' + index);
    if ($editInput) $editInput.focus();
    $textEl.querySelector('.progress-edit-save').addEventListener('click', (e) => {
      e.stopPropagation();
      const newText = $editInput ? $editInput.value.trim() : '';
      if (!newText) return;
      this.tm.updateProgress(taskId, index, newText);
      renderHistoryFn();
      this.refreshBoard();
    });
    $textEl.querySelector('.progress-edit-cancel').addEventListener('click', (e) => { e.stopPropagation(); renderHistoryFn(); });
    if ($editInput) {
      $editInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const newText = $editInput.value.trim();
          if (!newText) return;
          this.tm.updateProgress(taskId, index, newText);
          renderHistoryFn();
          this.refreshBoard();
        }
      });
    }
  }
  showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    this.$toastContainer.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 2000);
  }
}

/* ============================
 * DailyTodoStorage — 每日待办数据存储
 * ============================ */

class DailyTodoStorage {
  constructor() {
    // 使用统一数据存储，不再需要独立 key
  }
  loadAll() {
    try {
      const data = loadData();
      return (data.dailyTodos && typeof data.dailyTodos === 'object' && !Array.isArray(data.dailyTodos)) ? data.dailyTodos : {};
    } catch (e) {
      console.warn('每日待办数据读取失败', e);
      return {};
    }
  }
  saveAll(data) {
    try {
      updateDataField('dailyTodos', (data && typeof data === 'object' && !Array.isArray(data)) ? data : {});
    } catch (e) {
      console.error('每日待办数据写入失败', e);
    }
  }
  getDate(dateStr) {
    const all = this.loadAll();
    return all[dateStr] || null;
  }
  setDate(dateStr, dayData) {
    const all = this.loadAll();
    all[dateStr] = dayData;
    this.saveAll(all);
  }
  deleteDate(dateStr) {
    const all = this.loadAll();
    delete all[dateStr];
    this.saveAll(all);
  }
  hasDate(dateStr) {
    const all = this.loadAll();
    return !!all[dateStr];
  }
  getAllDates() {
    const all = this.loadAll();
    return Object.keys(all).sort();
  }
}

/* ============================
 * DailyTodoManager — 每日待办数据管理层
 * ============================ */

class DailyTodoManager {
  constructor(storage) {
    this._storage = storage;
  }
  _todayStr() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }
  getTodayItems() {
    const today = this._todayStr();
    const dateData = this._storage.getDate(today);
    return dateData ? dateData.items : null;
  }
  hasTodayList() {
    return this._storage.hasDate(this._todayStr());
  }
  createTodayList() {
    const today = this._todayStr();
    if (this._storage.hasDate(today)) return false;
    this._storage.setDate(today, { items: [] });
    return true;
  }
  getItemsForDate(dateStr) {
    const dateData = this._storage.getDate(dateStr);
    return dateData ? dateData.items : null;
  }
  hasDate(dateStr) {
    return this._storage.hasDate(dateStr);
  }
  addItem(dateStr, title, priority) {
    const dateData = this._storage.getDate(dateStr);
    if (!dateData) return null;
    const item = {
      id: crypto.randomUUID(),
      title: title.trim(),
      priority: priority || 'medium',
      completed: false,
      createdAt: Date.now()
    };
    dateData.items.push(item);
    this._storage.setDate(dateStr, dateData);
    return item;
  }
  updateItem(dateStr, itemId, updates) {
    const dateData = this._storage.getDate(dateStr);
    if (!dateData) return false;
    const idx = dateData.items.findIndex(item => item.id === itemId);
    if (idx === -1) return false;
    dateData.items[idx] = { ...dateData.items[idx], ...updates };
    this._storage.setDate(dateStr, dateData);
    return true;
  }
  deleteItem(dateStr, itemId) {
    const dateData = this._storage.getDate(dateStr);
    if (!dateData) return false;
    const idx = dateData.items.findIndex(item => item.id === itemId);
    if (idx === -1) return false;
    dateData.items.splice(idx, 1);
    this._storage.setDate(dateStr, dateData);
    return true;
  }
  toggleItem(dateStr, itemId) {
    const dateData = this._storage.getDate(dateStr);
    if (!dateData) return false;
    const item = dateData.items.find(item => item.id === itemId);
    if (!item) return false;
    item.completed = !item.completed;
    this._storage.setDate(dateStr, dateData);
    return true;
  }
}

/* ============================
 * DailyTodoUI — 每日待办UI渲染与交互
 * ============================ */

class DailyTodoUI {
  constructor(dailyManager) {
    this._dm = dailyManager;
    this._currentDate = this._todayStr();
    this._isCalendarView = false;
    this._calendarYear = null;
    this._calendarMonth = null;
    this._addFormVisible = false;
    this._cacheDom();
    this._bindEvents();
  }
  _todayStr() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }
  _cacheDom() {
    this.$overlay = document.getElementById('dailyOverlay');
    this.$sidebar = document.getElementById('dailySidebar');
    this.$btnDailyTodo = document.getElementById('btnDailyTodo');
    this.$sidebarClose = document.getElementById('dailySidebarClose');
    this.$dateTitle = document.getElementById('dailyDateTitle');
    this.$dateWeekday = document.getElementById('dailyDateWeekday');
    this.$goCalendar = document.getElementById('dailyGoCalendar');
    this.$todayView = document.getElementById('dailyTodayView');
    this.$calendarView = document.getElementById('dailyCalendarView');
    this.$dailyBody = document.getElementById('dailyBody');
    this.$emptyHint = document.getElementById('dailyEmptyHint');
    this.$createBtn = document.getElementById('dailyCreateBtn');
    this.$itemList = document.getElementById('dailyItemList');
    this.$addItemBtn = document.getElementById('dailyAddItemBtn');
    this.$addFormContainer = document.getElementById('dailyAddFormContainer');
    this.$calendarMonth = document.getElementById('dailyCalendarMonth');
    this.$calendarGrid = document.getElementById('dailyCalendarGrid');
    this.$calendarPrev = document.getElementById('dailyCalendarPrev');
    this.$calendarNext = document.getElementById('dailyCalendarNext');
    this.$backToday = document.getElementById('dailyBackToday');
  }
  _bindEvents() {
    this.$btnDailyTodo.addEventListener('click', () => this.open());
    this.$sidebarClose.addEventListener('click', () => this.close());
    this.$overlay.addEventListener('click', () => this.close());
    this.$goCalendar.addEventListener('click', () => this._showCalendarView());
    this.$backToday.addEventListener('click', () => this._showTodayView());
    this.$createBtn.addEventListener('click', () => this._createTodayList());
    this.$addItemBtn.addEventListener('click', () => this._toggleAddForm());
    this.$calendarPrev.addEventListener('click', () => this._navigateMonth(-1));
    this.$calendarNext.addEventListener('click', () => this._navigateMonth(1));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.$sidebar.classList.contains('open')) {
        this.close();
      }
    });
  }
  open() {
    this._currentDate = this._todayStr();
    this._isCalendarView = false;
    this._showTodayView();
    this.$overlay.classList.add('show');
    this.$sidebar.classList.add('open');
  }
  close() {
    this.$overlay.classList.remove('show');
    this.$sidebar.classList.remove('open');
    this._addFormVisible = false;
    this.$addFormContainer.innerHTML = '';
  }
  _showTodayView() {
    this._isCalendarView = false;
    this._currentDate = this._todayStr();
    this.$todayView.style.display = '';
    this.$calendarView.style.display = 'none';
    this._updateDateDisplay();
    this._renderToday();
  }
  _showCalendarView() {
    this._isCalendarView = true;
    this.$todayView.style.display = 'none';
    this.$calendarView.style.display = '';
    this._updateDateDisplay();
    const todayDate = new Date();
    this._calendarYear = todayDate.getFullYear();
    this._calendarMonth = todayDate.getMonth();
    this._renderCalendar();
  }
  _updateDateDisplay() {
    const d = new Date(this._currentDate + 'T00:00:00');
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    this.$dateTitle.textContent = '📅 ' + this._currentDate;
    this.$dateWeekday.textContent = weekdays[d.getDay()];
  }
  _createTodayList() {
    this._dm.createTodayList();
    this._renderToday();
  }
  _renderToday() {
    const items = this._dm.getItemsForDate(this._currentDate);
    const hasList = items !== null;
    this._addFormVisible = false;
    this.$addFormContainer.innerHTML = '';
    if (!hasList) {
      this.$emptyHint.style.display = '';
      this.$createBtn.style.display = '';
      this.$itemList.innerHTML = '';
      this.$addItemBtn.style.display = 'none';
      return;
    }
    this.$emptyHint.style.display = 'none';
    this.$createBtn.style.display = 'none';
    this.$addItemBtn.style.display = '';
    this._renderItems(items);
  }
  _renderItems(items) {
    this.$itemList.innerHTML = '';
    if (!items || items.length === 0) {
      this.$itemList.innerHTML = '<div class="daily-empty" style="padding:20px;"><span class="daily-empty-icon">📋</span>暂无待办项，点击下方按钮添加</div>';
      return;
    }
    items.forEach(item => {
      const li = document.createElement('li');
      li.className = 'daily-item-card' + (item.completed ? ' completed' : '');
      li.dataset.itemId = item.id;
      const priorityEmoji = { high: '🔴', medium: '🟡', low: '🟢' };
      li.innerHTML = `
        <input type="checkbox" class="daily-item-check" ${item.completed ? 'checked' : ''}>
        <div class="daily-item-content">
          <span class="daily-item-title">${this._escape(item.title)}</span>
          <span class="daily-item-priority">${priorityEmoji[item.priority] || '🟡'}</span>
        </div>
        <button class="daily-item-delete" title="删除此待办">×</button>
      `;
      li.querySelector('.daily-item-check').addEventListener('change', (e) => {
        e.stopPropagation();
        this._dm.toggleItem(this._currentDate, item.id);
        this._renderToday();
      });
      li.querySelector('.daily-item-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('确定要删除这条待办吗？')) {
          this._dm.deleteItem(this._currentDate, item.id);
          this._renderToday();
        }
      });
      li.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this._startEditTitle(item, li);
      });
      this.$itemList.appendChild(li);
    });
  }
  _startEditTitle(item, liElement) {
    const titleEl = liElement.querySelector('.daily-item-title');
    if (!titleEl) return;
    const originalTitle = item.title;
    const $input = document.createElement('input');
    $input.type = 'text';
    $input.className = 'daily-item-edit-input';
    $input.value = originalTitle;
    $input.style.flex = '1';
    titleEl.replaceWith($input);
    $input.focus();
    $input.select();
    const saveEdit = () => {
      const newTitle = $input.value.trim();
      if (newTitle && newTitle !== originalTitle) {
        this._dm.updateItem(this._currentDate, item.id, { title: newTitle });
        this._renderToday();
      } else {
        $input.replaceWith(titleEl);
      }
    };
    $input.addEventListener('blur', saveEdit);
    $input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); $input.blur(); }
      else if (e.key === 'Escape') { $input.value = originalTitle; $input.blur(); }
    });
  }
  _toggleAddForm() {
    if (this._addFormVisible) {
      this._addFormVisible = false;
      this.$addFormContainer.innerHTML = '';
      return;
    }
    this._addFormVisible = true;
    this.$addFormContainer.innerHTML = `
      <div class="daily-add-form">
        <input type="text" id="dailyAddInput" placeholder="输入待办标题" autofocus>
        <select id="dailyAddPriority">
          <option value="high">🔴 高</option>
          <option value="medium" selected>🟡 中</option>
          <option value="low">🟢 低</option>
        </select>
        <button class="btn-confirm" id="dailyAddConfirm">添加</button>
        <button class="btn-cancel" id="dailyAddCancel">取消</button>
      </div>
    `;
    const $input = document.getElementById('dailyAddInput');
    const $priority = document.getElementById('dailyAddPriority');
    const $confirm = document.getElementById('dailyAddConfirm');
    const $cancel = document.getElementById('dailyAddCancel');
    const doAdd = () => {
      const title = $input.value.trim();
      if (!title) { $input.focus(); return; }
      this._dm.addItem(this._currentDate, title, $priority.value);
      this._renderToday();
    };
    $confirm.addEventListener('click', doAdd);
    $cancel.addEventListener('click', () => { this._addFormVisible = false; this.$addFormContainer.innerHTML = ''; this._renderToday(); });
    $input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doAdd(); }
      else if (e.key === 'Escape') { this._addFormVisible = false; this.$addFormContainer.innerHTML = ''; this._renderToday(); }
    });
    setTimeout(() => $input.focus(), 100);
  }
  _renderCalendar() {
    if (this._calendarYear === null || this._calendarMonth === null) return;
    const year = this._calendarYear;
    const month = this._calendarMonth;
    const allDates = this._dm._storage.getAllDates();
    const todayStr = this._todayStr();
    this.$calendarMonth.textContent = `${year}年 ${month + 1}月`;
    let html = '';
    const headers = ['日', '一', '二', '三', '四', '五', '六'];
    headers.forEach(h => { html += `<div class="daily-calendar-day-header">${h}</div>`; });
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();
    for (let i = firstDay - 1; i >= 0; i--) {
      html += `<div class="daily-calendar-cell other-month">${prevMonthDays - i}</div>`;
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const hasData = allDates.includes(dateStr);
      const isToday = dateStr === todayStr;
      const cellClass = ['daily-calendar-cell'];
      if (hasData) cellClass.push('has-data');
      if (isToday) cellClass.push('today');
      html += `<div class="${cellClass.join(' ')}" data-date="${dateStr}">${day}</div>`;
    }
    const totalCells = firstDay + daysInMonth;
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 1; i <= remaining; i++) {
      html += `<div class="daily-calendar-cell other-month">${i}</div>`;
    }
    this.$calendarGrid.innerHTML = html;
    this.$calendarGrid.querySelectorAll('.has-data').forEach(cell => {
      cell.addEventListener('click', () => {
        const dateStr = cell.dataset.date;
        if (dateStr) this._goToDate(dateStr);
      });
    });
  }
  _navigateMonth(delta) {
    if (this._calendarMonth === null) return;
    this._calendarMonth += delta;
    if (this._calendarMonth < 0) { this._calendarMonth = 11; this._calendarYear--; }
    else if (this._calendarMonth > 11) { this._calendarMonth = 0; this._calendarYear++; }
    this._renderCalendar();
  }
  _goToDate(dateStr) {
    this._currentDate = dateStr;
    this._isCalendarView = false;
    this.$todayView.style.display = '';
    this.$calendarView.style.display = 'none';
    this._updateDateDisplay();
    this._renderToday();
  }
  _escape(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

/* ============================
 * LeftSidebarManager — 左侧工具栏管理
 * ============================ */

class LeftSidebarManager {
  constructor() {
    this._key = 'left-sidebar-state';
    this._sidebar = document.getElementById('leftSidebar');
    this._icons = this._sidebar.querySelectorAll('.sidebar-icon-btn');
    this._panels = {
      timer: document.getElementById('panel-timer'),
      countdown: document.getElementById('panel-countdown'),
      calc: document.getElementById('panel-calc'),
      theme: document.getElementById('panel-theme')
    };
    this._activeTool = 'timer';
    this._expanded = false;
    this._restoreState();
    this._bindEvents();
  }
  _restoreState() {
    try {
      const data = loadData();
      if (data.sidebarCollapsed === false) this._expand();
      const raw = localStorage.getItem('left-sidebar-state');
      if (raw) {
        const state = JSON.parse(raw);
        if (state.tool) this._switchPanel(state.tool);
      }
    } catch(e) {}
  }
  _saveState() {
    try {
      updateDataField('sidebarCollapsed', !this._expanded);
      localStorage.setItem('left-sidebar-state', JSON.stringify({ tool: this._activeTool }));
    } catch(e) {}
  }
  _bindEvents() {
    this._icons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;
        if (this._expanded && this._activeTool === tool) {
          this._collapse();
        } else {
          this._switchPanel(tool);
          if (!this._expanded) this._expand();
        }
      });
    });
  }
  _expand() {
    this._expanded = true;
    this._sidebar.classList.add('expanded');
    document.body.classList.add('left-sidebar-expanded');
    this._saveState();
  }
  _collapse() {
    this._expanded = false;
    this._sidebar.classList.remove('expanded');
    document.body.classList.remove('left-sidebar-expanded');
    this._saveState();
  }
  _switchPanel(tool) {
    this._activeTool = tool;
    this._icons.forEach(btn => btn.classList.toggle('active', btn.dataset.tool === tool));
    Object.entries(this._panels).forEach(([key, el]) => { if (el) el.style.display = key === tool ? '' : 'none'; });
    this._saveState();
  }
}

/* ============================
 * TimerModule — 计时器模块
 * ============================ */

class TimerModule {
  constructor() {
    this._mode = 'countdown';
    this._running = false;
    this._interval = null;
    this._remaining = 0;
    this._elapsed = 0;
    this._cacheDom();
    this._bindEvents();
    this._updateDisplay();
  }
  _cacheDom() {
    this.$display = document.getElementById('timerDisplay');
    this.$inputs = document.getElementById('timerInputs');
    this.$h = document.getElementById('timerH');
    this.$m = document.getElementById('timerM');
    this.$s = document.getElementById('timerS');
    this.$start = document.getElementById('timerStart');
    this.$pause = document.getElementById('timerPause');
    this.$reset = document.getElementById('timerReset');
    this._modeBtns = document.querySelectorAll('.timer-mode-btn');
  }
  _bindEvents() {
    this._modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this._modeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._mode = btn.dataset.mode;
        this._stop();
        this._remaining = 0;
        this._elapsed = 0;
        this.$inputs.style.display = this._mode === 'countdown' ? '' : 'none';
        if (this._mode === 'countdown') this._readInputs();
        this._updateDisplay();
      });
    });
    this.$start.addEventListener('click', () => this._start());
    this.$pause.addEventListener('click', () => this._pause());
    this.$reset.addEventListener('click', () => this._reset());
    [this.$h, this.$m, this.$s].forEach(inp => {
      inp.addEventListener('change', () => { if (this._mode === 'countdown' && !this._running) this._readInputs(); this._updateDisplay(); });
    });
  }
  _readInputs() {
    const h = parseInt(this.$h.value) || 0;
    const m = parseInt(this.$m.value) || 0;
    const s = parseInt(this.$s.value) || 0;
    this._remaining = h * 3600 + m * 60 + s;
  }
  _start() {
    if (this._running) return;
    if (this._mode === 'countdown') {
      if (this._remaining <= 0) this._readInputs();
      if (this._remaining <= 0) return;
    }
    this._running = true;
    this.$start.style.display = 'none';
    this.$pause.style.display = '';
    this._interval = setInterval(() => {
      if (this._mode === 'countdown') {
        this._remaining--;
        if (this._remaining <= 0) {
          this._remaining = 0;
          this._stop();
          this._notify();
        }
      } else {
        this._elapsed++;
      }
      this._updateDisplay();
    }, 1000);
  }
  _pause() { this._stop(); }
  _stop() {
    this._running = false;
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
    this.$start.style.display = '';
    this.$pause.style.display = 'none';
  }
  _reset() {
    this._stop();
    this._remaining = 0;
    this._elapsed = 0;
    if (this._mode === 'countdown') this._readInputs();
    this._updateDisplay();
  }
  _formatTime(totalSec) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
  }
  _updateDisplay() {
    const sec = this._mode === 'countdown' ? this._remaining : this._elapsed;
    this.$display.textContent = this._formatTime(sec);
  }
  _notify() {
    if (Notification.permission === 'granted') {
      new Notification('⏱️ 倒计时结束！', { body: '计时器已归零' });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(p => {
        if (p === 'granted') new Notification('⏱️ 倒计时结束！', { body: '计时器已归零' });
      });
    }
    if (window.__app && window.__app.uiManager) window.__app.uiManager.showToast('⏱️ 倒计时结束！');
  }
}

/* ============================
 * CountdownDaysModule — 倒数日模块
 * ============================ */

class CountdownDaysModule {
  constructor(taskManager) {
    this._tm = taskManager;
    this._key = 'left-sidebar-countdown';
    this._items = this._load();
    this._cacheDom();
    this._bindEvents();
    this.render();
  }
  _cacheDom() {
    this.$name = document.getElementById('cdName');
    this.$date = document.getElementById('cdDate');
    this.$addBtn = document.getElementById('cdAddBtn');
    this.$manualList = document.getElementById('cdManualList');
    this.$taskList = document.getElementById('cdTaskList');
  }
  _bindEvents() {
    this.$addBtn.addEventListener('click', () => this._add());
    this.$name.addEventListener('keydown', e => { if (e.key === 'Enter') this._add(); });
  }
  _load() {
    try { return JSON.parse(localStorage.getItem(this._key)) || []; } catch(e) { return []; }
  }
  _save() {
    try { localStorage.setItem(this._key, JSON.stringify(this._items)); } catch(e) {}
  }
  _add() {
    const name = this.$name.value.trim();
    const date = this.$date.value;
    if (!name || !date) return;
    this._items.push({ id: crypto.randomUUID(), name, date });
    this._save();
    this.$name.value = '';
    this.$date.value = '';
    this.render();
  }
  _remove(id) {
    this._items = this._items.filter(i => i.id !== id);
    this._save();
    this.render();
  }
  _calcDays(dateStr) {
    const target = new Date(dateStr + 'T00:00:00');
    const today = new Date(); today.setHours(0,0,0,0);
    return Math.ceil((target - today) / 86400000);
  }
  render() {
    this.$manualList.innerHTML = '';
    if (this._items.length === 0) {
      this.$manualList.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-muted);font-size:12px;">暂无手动添加的倒数日</div>';
    } else {
      this._items.forEach(item => {
        const days = this._calcDays(item.date);
        const isPast = days < 0;
        const absDays = Math.abs(days);
        const label = isPast ? `${absDays}天前` : days === 0 ? '今天' : `还有${days}天`;
        this.$manualList.innerHTML += `<div class="countdown-item"><span class="cd-name">${this._esc(item.name)}</span><span class="cd-days ${isPast ? 'past' : ''}">${label}</span><span class="cd-date">${item.date}</span><button class="cd-delete" data-id="${item.id}">×</button></div>`;
      });
      this.$manualList.querySelectorAll('.cd-delete').forEach(btn => {
        btn.addEventListener('click', () => this._remove(btn.dataset.id));
      });
    }
    this.$taskList.innerHTML = '';
    const tasks = this._tm.getAll().filter(t => t.dueDate && t.status !== 'done');
    if (tasks.length === 0) {
      this.$taskList.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-muted);font-size:12px;">暂无带截止日期的未完成任务</div>';
    } else {
      tasks.sort((a,b) => new Date(a.dueDate) - new Date(b.dueDate)).forEach(t => {
        const days = this._calcDays(t.dueDate);
        const isPast = days < 0;
        const absDays = Math.abs(days);
        const label = isPast ? `${absDays}天前` : days === 0 ? '今天' : `还有${days}天`;
        this.$taskList.innerHTML += `<div class="countdown-item"><span class="cd-name">${this._esc(t.title)}</span><span class="cd-days ${isPast ? 'past' : ''}">${label}</span><span class="cd-date">${t.dueDate}</span></div>`;
      });
    }
  }
  _esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
}

/* ============================
 * CalculatorModule — 多功能计算器模块
 * ============================ */

class CalculatorModule {
  constructor() {
    this._cacheDom();
    this._bindCalcTabs();
    this._bindBasicCalc();
    this._bindFx();
    this._bindUnit();
  }
  _cacheDom() {
    this._calcTabs = document.querySelectorAll('.calc-tab');
    this._calcPanels = { basic: document.getElementById('calcBasic'), fx: document.getElementById('calcFx'), unit: document.getElementById('calcUnit') };
    this.$calcExpr = document.getElementById('calcExpr');
    this.$calcResult = document.getElementById('calcResult');
    this.$fxFrom = document.getElementById('fxFrom');
    this.$fxTo = document.getElementById('fxTo');
    this.$fxAmount = document.getElementById('fxAmount');
    this.$fxResult = document.getElementById('fxResult');
    this.$fxSwap = document.getElementById('fxSwap');
    this.$unitCat = document.getElementById('unitCat');
    this.$unitFrom = document.getElementById('unitFrom');
    this.$unitTo = document.getElementById('unitTo');
    this.$unitAmount = document.getElementById('unitAmount');
    this.$unitResult = document.getElementById('unitResult');
  }
  _bindCalcTabs() {
    this._calcTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this._calcTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        Object.values(this._calcPanels).forEach(p => p.classList.remove('active'));
        this._calcPanels[tab.dataset.calc].classList.add('active');
      });
    });
  }
  _bindBasicCalc() {
    this._calcCurrent = '0';
    this._calcPrev = '';
    this._calcOp = '';
    this._calcNew = true;
    document.querySelectorAll('#calcBasic .calc-btn').forEach(btn => {
      btn.addEventListener('click', () => this._calcPress(btn.dataset.val));
    });
  }
  _calcPress(val) {
    if (val === 'C') { this._calcCurrent = '0'; this._calcPrev = ''; this._calcOp = ''; this._calcNew = true; }
    else if (val === '±') { this._calcCurrent = String(-parseFloat(this._calcCurrent)); }
    else if (val === '%') { this._calcCurrent = String(parseFloat(this._calcCurrent) / 100); }
    else if (['+','-','×','÷'].includes(val)) {
      if (this._calcPrev && this._calcOp && !this._calcNew) this._calcEval();
      this._calcPrev = this._calcCurrent;
      this._calcOp = val;
      this._calcNew = true;
    }
    else if (val === '=') { this._calcEval(); this._calcOp = ''; this._calcPrev = ''; }
    else if (val === '.') { if (!this._calcCurrent.includes('.')) this._calcCurrent += '.'; this._calcNew = false; }
    else {
      if (this._calcNew) { this._calcCurrent = val; this._calcNew = false; }
      else this._calcCurrent += val;
    }
    this.$calcExpr.textContent = this._calcPrev ? `${this._calcPrev} ${this._calcOp}` : '';
    this.$calcResult.textContent = this._calcCurrent;
  }
  _calcEval() {
    if (!this._calcPrev || !this._calcOp) return;
    const a = parseFloat(this._calcPrev), b = parseFloat(this._calcCurrent);
    let r = 0;
    if (this._calcOp === '+') r = a + b;
    else if (this._calcOp === '-') r = a - b;
    else if (this._calcOp === '×') r = a * b;
    else if (this._calcOp === '÷') r = b !== 0 ? a / b : 'Error';
    this._calcCurrent = typeof r === 'number' ? String(Math.round(r * 1e10) / 1e10) : r;
    this._calcNew = true;
  }
  _bindFx() {
    this._fxRates = { USD: 1, CNY: 7.25, EUR: 0.92, JPY: 155.5, GBP: 0.79 };
    const calc = () => {
      const amt = parseFloat(this.$fxAmount.value);
      if (isNaN(amt)) { this.$fxResult.textContent = '—'; return; }
      const from = this.$fxFrom.value, to = this.$fxTo.value;
      const usd = amt / this._fxRates[from];
      const result = usd * this._fxRates[to];
      this.$fxResult.textContent = `${amt} ${from} ≈ ${result.toFixed(2)} ${to}`;
    };
    this.$fxAmount.addEventListener('input', calc);
    this.$fxFrom.addEventListener('change', calc);
    this.$fxTo.addEventListener('change', calc);
    this.$fxSwap.addEventListener('click', () => {
      const tmp = this.$fxFrom.value;
      this.$fxFrom.value = this.$fxTo.value;
      this.$fxTo.value = tmp;
      calc();
    });
    calc();
  }
  _bindUnit() {
    this._units = {
      length: { label: '长度', units: { '寸': 0.0333, '英寸': 0.0254, '厘米': 0.01, '米': 1 } },
      weight: { label: '重量', units: { '克': 0.001, '千克': 1, '磅': 0.4536, '盎司': 0.02835 } },
      area: { label: '面积', units: { '平方厘米': 0.0001, '平方米': 1, '亩': 666.67, '公顷': 10000 } },
      volume: { label: '体积', units: { '毫升': 0.001, '升': 1, '加仑': 3.7854, '立方厘米': 0.001 } }
    };
    const fillUnits = () => {
      const cat = this.$unitCat.value;
      const units = Object.keys(this._units[cat].units);
      this.$unitFrom.innerHTML = units.map(u => `<option value="${u}">${u}</option>`).join('');
      this.$unitTo.innerHTML = units.map(u => `<option value="${u}">${u}</option>`).join('');
      if (units.length > 1) this.$unitTo.selectedIndex = 1;
      calcUnit();
    };
    const calcUnit = () => {
      const amt = parseFloat(this.$unitAmount.value);
      if (isNaN(amt)) { this.$unitResult.textContent = '—'; return; }
      const cat = this._units[this.$unitCat.value];
      const fromFactor = cat.units[this.$unitFrom.value];
      const toFactor = cat.units[this.$unitTo.value];
      const result = amt * fromFactor / toFactor;
      this.$unitResult.textContent = `${amt} ${this.$unitFrom.value} = ${Math.round(result * 1e8) / 1e8} ${this.$unitTo.value}`;
    };
    this.$unitCat.addEventListener('change', fillUnits);
    this.$unitFrom.addEventListener('change', calcUnit);
    this.$unitTo.addEventListener('change', calcUnit);
    this.$unitAmount.addEventListener('input', calcUnit);
    fillUnits();
  }
}

/* ============================
 * ThemeModule — 主题换色模块
 * ============================ */

class ThemeModule {
  constructor() {
    this._options = document.querySelectorAll('.theme-option');
    this._bindEvents();
    this._restore();
  }
  _bindEvents() {
    this._options.forEach(opt => {
      opt.addEventListener('click', () => {
        this._options.forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        this._apply(opt.dataset.theme);
      });
    });
  }
  _apply(theme) {
    document.body.classList.remove('theme-light-blue', 'theme-light-gray', 'theme-dark');
    if (theme !== 'default') document.body.classList.add('theme-' + theme);
    try { updateDataField('theme', theme); } catch(e) {}
  }
  _restore() {
    try {
      const data = loadData();
      const saved = (typeof data.theme === 'string') ? data.theme : 'light';
      if (saved && saved !== 'light') {
        this._options.forEach(o => o.classList.toggle('active', o.dataset.theme === saved));
        this._apply(saved);
      } else {
        this._options.forEach(o => o.classList.toggle('active', o.dataset.theme === 'default'));
      }
    } catch(e) {}
  }
}

/* ============================
 * 应用初始化（异步）
 * ============================ */

document.addEventListener('DOMContentLoaded', async function init() {
  try {
    const ds = new DataStorage();
    const taskManager = new TaskManager(ds);
    await taskManager.init();
    const uiManager = new UIManager(taskManager);
    const dailyStorage = new DailyTodoStorage();
    const dailyManager = new DailyTodoManager(dailyStorage);
    const dailyUI = new DailyTodoUI(dailyManager);
    const leftSidebar = new LeftSidebarManager();
    const timer = new TimerModule();
    const countdownDays = new CountdownDaysModule(taskManager);
    const calculator = new CalculatorModule();
    const theme = new ThemeModule();
    window.__app = { ds, taskManager, uiManager, dailyStorage, dailyManager, dailyUI, leftSidebar, timer, countdownDays, calculator, theme };
    console.log('✅ 任务管理工具已就绪');
    console.log(`   - 共加载 ${taskManager.tasks.length} 个任务`);
    console.log(`   - 存储模式: ${ds.mode === 'fileSystem' ? '📁 文件系统 (' + ds.dirName + '/tasks.json)' : '💾 localStorage'}`);
  } catch (e) {
    console.error('初始化失败', e);
    document.body.innerHTML = '<div style="text-align:center;padding:60px 20px;color:#dc2626;">⚠️ 应用初始化失败，请刷新页面重试。<br><small>' + e.message + '</small></div>';
  }
});
