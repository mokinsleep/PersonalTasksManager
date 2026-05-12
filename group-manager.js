'use strict';

/* ============================
 * 卡片组管理模块（阶段三）
 * 包含：卡片组 CRUD、组内任务 CRUD（三列看板）、拖拽排序、模态框
 * 依赖：app.js 中的 loadData(), updateDataField(), UIManager, TaskManager
 * ============================ */

(function() {

  // --- 辅助函数 ---
  function _escape(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // 兼容包装：优先使用 app.js 暴露的全局函数
  function _loadData() {
    if (typeof window.loadData === 'function') return window.loadData();
    try {
      const raw = localStorage.getItem('task-board-data');
      const parsed = raw ? JSON.parse(raw) : {};
      return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (e) { return {}; }
  }
  function _updateDataField(key, value) {
    if (typeof window.updateDataField === 'function') {
      window.updateDataField(key, value);
      return;
    }
    try {
      const raw = localStorage.getItem('task-board-data');
      const data = (raw ? JSON.parse(raw) : {});
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      data[key] = value;
      localStorage.setItem('task-board-data', JSON.stringify(data));
    } catch (e) { console.error('group-manager: 保存数据失败', e); }
  }

  // --- 组内任务状态配置 ---
  const GROUP_STATUS_CONFIG = {
    'active':    { label: '🔄 进行中', emoji: '🔄' },
    'standby':   { label: '📌 待处理', emoji: '📌' },
    'completed': { label: '✅ 已完成', emoji: '✅' }
  };

  // --- TaskManager 扩展：卡片组 CRUD ---

  TaskManager.prototype.getGroups = function() {
    const data = _loadData();
    return Array.isArray(data.groups) ? data.groups : [];
  };

  TaskManager.prototype.getGroupsByStatus = function(status) {
    return this.getGroups().filter(g => g.status === status);
  };

  TaskManager.prototype.addGroup = function(status, title) {
    const groups = this.getGroups();
    const group = {
      id: 'group_' + Date.now() + '_' + Math.random(),
      title: title || '新卡片组',
      status: status,
      collapsed: false,
      createdAt: new Date().toISOString(),
      completedAt: null,
      tasks: []
    };
    groups.push(group);
    _updateDataField('groups', groups);
    return group;
  };

  TaskManager.prototype.updateGroup = function(id, updates) {
    const groups = this.getGroups();
    const idx = groups.findIndex(g => g.id === id);
    if (idx === -1) return null;
    groups[idx] = { ...groups[idx], ...updates };
    _updateDataField('groups', groups);
    return groups[idx];
  };

  TaskManager.prototype.deleteGroup = function(id) {
    const groups = this.getGroups();
    const newGroups = groups.filter(g => g.id !== id);
    if (newGroups.length === groups.length) return false;
    _updateDataField('groups', newGroups);
    return true;
  };

  TaskManager.prototype.toggleGroupCollapse = function(id) {
    const groups = this.getGroups();
    const group = groups.find(g => g.id === id);
    if (!group) return null;
    group.collapsed = !group.collapsed;
    _updateDataField('groups', groups);
    return group;
  };

  // --- TaskManager 扩展：组内任务 CRUD ---

  TaskManager.prototype.getGroupById = function(groupId) {
    const groups = this.getGroups();
    return groups.find(g => g.id === groupId) || null;
  };

  TaskManager.prototype.addTaskToGroup = function(groupId, taskData, taskStatus) {
    const groups = this.getGroups();
    const group = groups.find(g => g.id === groupId);
    if (!group) return null;
    if (!Array.isArray(group.tasks)) group.tasks = [];
    const task = {
      id: 'task_' + Date.now() + '_' + Math.random(),
      title: taskData.title || '未命名任务',
      desc: taskData.description || '',
      dueDate: taskData.dueDate || '',
      priority: taskData.priority || 'medium',
      tags: Array.isArray(taskData.tags) ? [...taskData.tags] : [],
      status: taskStatus || 'active',
      createdAt: new Date().toISOString()
    };
    group.tasks.push(task);
    _updateDataField('groups', groups);
    return task;
  };

  TaskManager.prototype.updateGroupTask = function(groupId, taskId, updates) {
    const groups = this.getGroups();
    const group = groups.find(g => g.id === groupId);
    if (!group || !Array.isArray(group.tasks)) return null;
    const idx = group.tasks.findIndex(t => t.id === taskId);
    if (idx === -1) return null;
    group.tasks[idx] = { ...group.tasks[idx], ...updates };
    _updateDataField('groups', groups);
    return group.tasks[idx];
  };

  TaskManager.prototype.deleteGroupTask = function(groupId, taskId) {
    const groups = this.getGroups();
    const group = groups.find(g => g.id === groupId);
    if (!group || !Array.isArray(group.tasks)) return false;
    const idx = group.tasks.findIndex(t => t.id === taskId);
    if (idx === -1) return false;
    group.tasks.splice(idx, 1);
    _updateDataField('groups', groups);
    return true;
  };

  TaskManager.prototype.reorderGroupTask = function(groupId, taskId, targetStatus, insertBeforeId) {
    const groups = this.getGroups();
    const group = groups.find(g => g.id === groupId);
    if (!group || !Array.isArray(group.tasks)) return false;

    // Find and remove the task
    const taskIdx = group.tasks.findIndex(t => t.id === taskId);
    if (taskIdx === -1) return false;
    const [task] = group.tasks.splice(taskIdx, 1);
    task.status = targetStatus;

    if (insertBeforeId) {
      // Insert before the target task
      const insertIdx = group.tasks.findIndex(t => t.id === insertBeforeId);
      if (insertIdx !== -1) {
        group.tasks.splice(insertIdx, 0, task);
      } else {
        group.tasks.push(task);
      }
    } else {
      // Append after the last task of the target status
      let lastIdx = -1;
      group.tasks.forEach((t, i) => { if ((t.status || 'active') === targetStatus) lastIdx = i; });
      if (lastIdx !== -1) {
        group.tasks.splice(lastIdx + 1, 0, task);
      } else {
        group.tasks.push(task);
      }
    }

    _updateDataField('groups', groups);
    return true;
  };

  // --- UIManager 扩展：卡片组渲染（三列纵向看板）---

  UIManager.prototype.createGroupElement = function(group) {
    const card = document.createElement('div');
    card.className = 'group-card' + (group.collapsed ? ' collapsed' : '');
    card.dataset.groupId = group.id;
    card.draggable = true;

    const taskCount = (group.tasks && Array.isArray(group.tasks)) ? group.tasks.length : 0;
    const priorityLabels = { high: '🔴', medium: '🟡', low: '🟢' };

    // Build three status rows
    let rowsHtml = '';
    for (const [status, config] of Object.entries(GROUP_STATUS_CONFIG)) {
      const statusTasks = (group.tasks || []).filter(t => (t.status || 'active') === status);
      let tasksHtml = '';
      if (statusTasks.length > 0) {
        const today = new Date(); today.setHours(0,0,0,0);
        tasksHtml = statusTasks.map(t => {
          let dueDateHtml = '';
          if (t.dueDate) {
            const dueDate = new Date(t.dueDate + 'T00:00:00');
            const isOverdue = dueDate < today && t.status !== 'completed';
            // 简短格式：MM-DD
            const shortDate = t.dueDate.slice(5); // "2026-05-15" -> "05-15"
            dueDateHtml = `<span class="group-task-due-date${isOverdue ? ' overdue' : ''}">📅 ${shortDate}${isOverdue ? ' (逾期)' : ''}</span>`;
          }
          return `
          <div class="group-task-mini-card${t.status === 'completed' ? ' completed' : ''}"
               data-task-id="${t.id}" draggable="true">
            <span class="group-task-priority">${priorityLabels[t.priority] || '🟡'}</span>
            <span class="group-task-title">${_escape(t.title)}</span>
            ${dueDateHtml}
            <button class="group-task-btn delete" data-task-id="${t.id}" title="删除">×</button>
          </div>`;
        }).join('');
      } else {
        tasksHtml = '<div class="group-task-row-empty">暂无任务</div>';
      }

      rowsHtml += `
        <div class="group-task-row" data-group-status="${status}">
          <div class="group-task-row-header">
            <span class="group-task-row-label">${config.label}</span>
            <span class="group-task-row-count">${statusTasks.length}</span>
            <button class="btn-add-group-task" data-status="${status}" title="新增任务">+</button>
          </div>
          <div class="group-task-row-list" data-group-status="${status}">
            ${tasksHtml}
          </div>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="group-card-header">
        <span class="group-card-collapse-icon">▼</span>
        <span class="group-card-icon">📁</span>
        <span class="group-card-title">${_escape(group.title)}</span>
        <span class="group-card-count">· ${taskCount}项任务</span>
        <button class="group-card-delete" title="删除卡片组">🗑️</button>
      </div>
      <div class="group-card-body">
        ${rowsHtml}
      </div>
    `;

    // 300ms 延迟判断单击折叠 vs 双击编辑
    let clickTimer = null;
    card.querySelector('.group-card-header').addEventListener('click', (e) => {
      if (e.target.closest('.group-card-delete')) return;
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
        this._startGroupTitleEdit(group, card.querySelector('.group-card-title'));
      } else {
        clickTimer = setTimeout(() => {
          clickTimer = null;
          this.tm.toggleGroupCollapse(group.id);
          this.refreshBoard();
        }, 300);
      }
    });

    // 删除卡片组
    card.querySelector('.group-card-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('确定要删除卡片组「' + group.title + '」吗？')) {
        this.tm.deleteGroup(group.id);
        this.refreshBoard();
        this.showToast('已删除卡片组');
      }
    });

    // 每行的 "+ 新增任务" 按钮
    card.querySelectorAll('.btn-add-group-task').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const status = btn.dataset.status;
        this.openGroupTaskModal(group.id, null, status);
      });
    });

    // 组内任务点击编辑
    card.querySelectorAll('.group-task-mini-card').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.group-task-btn.delete')) return;
        this.openGroupTaskModal(group.id, item.dataset.taskId);
      });
    });

    // 组内任务删除
    card.querySelectorAll('.group-task-btn.delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskId = btn.dataset.taskId;
        const task = (group.tasks || []).find(t => t.id === taskId);
        if (task && confirm('确定要删除任务「' + task.title + '」吗？')) {
          this.tm.deleteGroupTask(group.id, taskId);
          this.refreshBoard();
          this.showToast('已删除组内任务');
        }
      });
    });

    // 组内任务拖拽
    this._bindGroupTaskDragDrop(card, group);

    return card;
  };

  // --- 组内任务拖拽绑定 ---

  UIManager.prototype._bindGroupTaskDragDrop = function(card, group) {
    const miniCards = card.querySelectorAll('.group-task-mini-card');
    const rowLists = card.querySelectorAll('.group-task-row-list');

    miniCards.forEach(mc => {
      mc.addEventListener('dragstart', (e) => {
        e.stopPropagation(); // 阻止冒泡到卡片组的拖拽
        mc.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/group-task-id', mc.dataset.taskId);
        e.dataTransfer.setData('text/group-task-group-id', group.id);
      });

      mc.addEventListener('dragend', (e) => {
        e.stopPropagation();
        mc.classList.remove('dragging');
        // 清理所有拖拽指示器
        card.querySelectorAll('.group-task-drop-indicator').forEach(el => el.remove());
        card.querySelectorAll('.group-task-row-list').forEach(r => r.classList.remove('drag-over'));
      });
    });

    rowLists.forEach(row => {
      row.addEventListener('dragover', (e) => {
        const taskId = e.dataTransfer.types.includes('text/group-task-id');
        if (!taskId) return; // 不是组内任务拖拽
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        row.classList.add('drag-over');

        // 移除旧的指示器
        row.querySelectorAll('.group-task-drop-indicator').forEach(el => el.remove());

        // 创建新的指示器
        const indicator = document.createElement('div');
        indicator.className = 'group-task-drop-indicator';

        const cards = [...row.querySelectorAll('.group-task-mini-card:not(.dragging)')];
        let inserted = false;

        for (const c of cards) {
          const rect = c.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          if (e.clientY < midY) {
            row.insertBefore(indicator, c);
            inserted = true;
            break;
          }
        }

        if (!inserted) {
          const emptyHint = row.querySelector('.group-task-row-empty');
          if (emptyHint) {
            row.insertBefore(indicator, emptyHint);
          } else {
            row.appendChild(indicator);
          }
        }
      });

      row.addEventListener('dragleave', (e) => {
        if (!row.contains(e.relatedTarget)) {
          row.classList.remove('drag-over');
          row.querySelectorAll('.group-task-drop-indicator').forEach(el => el.remove());
        }
      });

      row.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation(); // 阻止冒泡到列的 drop handler

        row.classList.remove('drag-over');
        row.querySelectorAll('.group-task-drop-indicator').forEach(el => el.remove());

        const taskId = e.dataTransfer.getData('text/group-task-id');
        const sourceGroupId = e.dataTransfer.getData('text/group-task-group-id');
        if (!taskId || sourceGroupId !== group.id) return;

        const targetStatus = row.dataset.groupStatus;

        // 计算插入位置
        const cards = [...row.querySelectorAll('.group-task-mini-card:not(.dragging)')];
        let insertBeforeId = null;

        for (const c of cards) {
          const rect = c.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          if (e.clientY < midY) {
            insertBeforeId = c.dataset.taskId;
            break;
          }
        }

        this.tm.reorderGroupTask(group.id, taskId, targetStatus, insertBeforeId);
        this.refreshBoard();
      });
    });
  };

  // --- UIManager 扩展：标题编辑 ---

  UIManager.prototype._startGroupTitleEdit = function(group, titleEl) {
    if (!titleEl) return;
    const originalTitle = group.title;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'group-card-title-input';
    input.value = originalTitle;
    titleEl.replaceWith(input);
    input.focus();
    input.select();
    const saveEdit = () => {
      const newTitle = input.value.trim();
      if (newTitle && newTitle !== originalTitle) {
        this.tm.updateGroup(group.id, { title: newTitle });
        this.showToast('✅ 卡片组标题已更新');
      }
      this.refreshBoard();
    };
    input.addEventListener('blur', saveEdit);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      else if (ev.key === 'Escape') { input.value = originalTitle; input.blur(); }
    });
  };

  // --- UIManager 扩展：模态框 ---

  UIManager.prototype.openGroupModal = function(status) {
    const modalHtml = `
      <div class="modal-overlay" id="modalOverlay">
        <div class="modal" id="modal">
          <h2>📁 新建卡片组</h2>
          <div class="form-group">
            <label>标题 *</label>
            <input type="text" id="groupModalTitle" placeholder="输入卡片组标题" autofocus>
          </div>
          <div class="form-actions">
            <button class="btn-secondary" id="groupModalCancel">取消</button>
            <button class="btn-primary" id="groupModalSave">创建卡片组</button>
          </div>
        </div>
      </div>
    `;
    this.$modalContainer.innerHTML = modalHtml;
    const $overlay = document.getElementById('modalOverlay');
    const $input = document.getElementById('groupModalTitle');
    const closeModal = () => { this.$modalContainer.innerHTML = ''; };
    $overlay.addEventListener('click', (e) => { if (e.target === $overlay) closeModal(); });
    document.getElementById('groupModalCancel').addEventListener('click', closeModal);
    document.getElementById('groupModalSave').addEventListener('click', () => {
      const title = $input.value.trim();
      if (!title) { this.showToast('⚠️ 请输入卡片组标题'); $input.focus(); return; }
      this.tm.addGroup(status, title);
      closeModal();
      this.refreshBoard();
      this.showToast('✅ 已创建卡片组');
    });
    const escHandler = (e) => {
      if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);
    setTimeout(() => $input.focus(), 100);
  };

  UIManager.prototype.openGroupTaskModal = function(groupId, taskIdOrNull, taskStatus) {
    const isEdit = (taskIdOrNull != null && taskIdOrNull !== undefined);
    const group = this.tm.getGroupById(groupId);
    if (!group) return;
    const task = isEdit ? (group.tasks || []).find(t => t.id === taskIdOrNull) : null;
    if (isEdit && !task) return;
    const initialTags = isEdit ? (task.tags || []) : [];
    const currentStatus = isEdit ? (task.status || 'active') : (taskStatus || 'active');

    const statusOptions = Object.entries(GROUP_STATUS_CONFIG).map(([key, config]) => {
      const selected = currentStatus === key ? 'selected' : '';
      return `<option value="${key}" ${selected}>${config.label}</option>`;
    }).join('');

    const modalHtml = `
      <div class="modal-overlay" id="modalOverlay">
        <div class="modal" id="modal">
          <h2>${isEdit ? '编辑组内任务' : '新增组内任务'}</h2>
          <div class="form-group"><label>标题 *</label><input type="text" id="groupTaskTitle" value="${isEdit ? _escape(task.title) : ''}" placeholder="输入任务标题" autofocus></div>
          <div class="form-group"><label>描述</label><textarea id="groupTaskDesc" placeholder="添加详细描述（可选）">${isEdit ? _escape(task.desc || '') : ''}</textarea></div>
          <div class="form-group"><label>截止日期</label><input type="date" id="groupTaskDueDate" value="${isEdit ? task.dueDate : ''}"></div>
          <div class="form-group"><label>优先级</label>
            <select id="groupTaskPriority">
              <option value="high" ${(isEdit && task.priority === 'high') ? 'selected' : ''}>🔴 高优先级</option>
              <option value="medium" ${(!isEdit || task.priority === 'medium') ? 'selected' : ''}>🟡 中优先级</option>
              <option value="low" ${(isEdit && task.priority === 'low') ? 'selected' : ''}>🟢 低优先级</option>
            </select>
          </div>
          <div class="form-group"><label>状态</label>
            <select id="groupTaskStatus">
              ${statusOptions}
            </select>
          </div>
          <div class="form-group"><label>标签</label>
            <div class="tag-input-wrapper" id="tagWrapper">
              ${initialTags.map(tag => `<span class="tag-chip"><span>${_escape(tag)}</span><span class="tag-remove" data-tag="${_escape(tag)}">&times;</span></span>`).join('')}
              <input type="text" class="tag-input" id="groupTaskTag" placeholder="输入标签后回车">
            </div>
          </div>
          <div class="form-actions">
            <button class="btn-secondary" id="groupTaskCancel">取消</button>
            <button class="btn-primary" id="groupTaskSave">${isEdit ? '保存修改' : '创建任务'}</button>
          </div>
        </div>
      </div>
    `;
    this.$modalContainer.innerHTML = modalHtml;
    const $overlay = document.getElementById('modalOverlay');
    const $tagWrapper = document.getElementById('tagWrapper');
    const $inputTag = document.getElementById('groupTaskTag');
    let currentTags = [...initialTags];
    const renderTags = () => {
      $tagWrapper.querySelectorAll('.tag-chip').forEach(c => c.remove());
      currentTags.forEach(tag => {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.innerHTML = `<span>${_escape(tag)}</span><span class="tag-remove" data-tag="${_escape(tag)}">&times;</span>`;
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
      if (removeBtn) { currentTags = currentTags.filter(t => t !== removeBtn.dataset.tag); renderTags(); }
    });
    const closeModal = () => { this.$modalContainer.innerHTML = ''; };
    $overlay.addEventListener('click', (e) => { if (e.target === $overlay) closeModal(); });
    document.getElementById('groupTaskCancel').addEventListener('click', closeModal);
    document.getElementById('groupTaskSave').addEventListener('click', () => {
      const title = document.getElementById('groupTaskTitle').value.trim();
      if (!title) { this.showToast('⚠️ 请输入任务标题'); document.getElementById('groupTaskTitle').focus(); return; }
      const newStatus = document.getElementById('groupTaskStatus').value;
      const taskData = {
        title,
        description: document.getElementById('groupTaskDesc').value.trim(),
        dueDate: document.getElementById('groupTaskDueDate').value,
        priority: document.getElementById('groupTaskPriority').value,
        tags: currentTags
      };
      if (isEdit) {
        this.tm.updateGroupTask(groupId, taskIdOrNull, {
          title: taskData.title,
          desc: taskData.description,
          dueDate: taskData.dueDate,
          priority: taskData.priority,
          tags: taskData.tags,
          status: newStatus
        });
        this.showToast('✅ 组内任务已更新');
      } else {
        this.tm.addTaskToGroup(groupId, taskData, newStatus);
        this.showToast('✅ 组内任务已创建');
      }
      closeModal();
      this.refreshBoard();
    });
    const escHandler = (e) => {
      if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);
    setTimeout(() => document.getElementById('groupTaskTitle').focus(), 100);
  };

  // --- UIManager 扩展：刷新时渲染卡片组 ---

  const _originalRefreshBoard = UIManager.prototype.refreshBoard;
  UIManager.prototype.refreshBoard = function() {
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
      const groups = this.tm.getGroupsByStatus(status);
      groups.forEach(group => col.list.appendChild(this.createGroupElement(group)));
      col.count.textContent = tasks.length;
      tasks.forEach(task => col.list.appendChild(this.createCardElement(task)));
    });
    this.restoreCheckboxStates();
  };

  // --- UIManager 扩展：绑定卡片组事件 ---

  const _originalBindEvents = UIManager.prototype.bindEvents;
  UIManager.prototype.bindEvents = function() {
    _originalBindEvents.call(this);

    // 卡片组按钮 - 打开模态框
    document.querySelectorAll('.btn-add-group').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const status = e.currentTarget.dataset.status;
        this.openGroupModal(status);
      });
    });

    // 卡片组拖拽（跳过组内任务的拖拽）
    this.$board.addEventListener('dragstart', (e) => {
      // 如果是组内任务拖拽，跳过卡片组拖拽逻辑
      if (e.target.closest('.group-task-mini-card')) return;

      const groupCard = e.target.closest('.group-card');
      if (groupCard) {
        groupCard.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/group-id', groupCard.dataset.groupId);
      }
    });
    this.$board.addEventListener('dragend', (e) => {
      const groupCard = e.target.closest('.group-card');
      if (groupCard) groupCard.classList.remove('dragging');
      document.querySelectorAll('.column').forEach(col => col.classList.remove('drag-over'));
    });

    // 列 drop 支持卡片组
    document.querySelectorAll('.column').forEach(column => {
      column.addEventListener('drop', (e) => {
        const groupId = e.dataTransfer.getData('text/group-id');
        const taskId = e.dataTransfer.getData('text/plain');
        const newStatus = column.dataset.status;
        if (groupId && newStatus) {
          e.preventDefault();
          column.classList.remove('drag-over');
          this.tm.updateGroup(groupId, { status: newStatus });
          this.refreshBoard();
          const statusLabels = { 'todo': '待处理', 'in-progress': '进行中', 'done': '已完成' };
          this.showToast(`卡片组已移至「${statusLabels[newStatus]}」`);
        }
        // 任务拖拽由原有 bindEvents 处理
      }, true); // 使用捕获阶段，优先于原有 handler
    });
  };

})();
