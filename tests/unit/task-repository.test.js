// Regression: task/approval list queries must use single-quoted SQL string
// literals. Double quotes ("critical") are parsed as column identifiers by
// SQLite and made GET /api/tasks/:id (via getSubtasks → getAllTasks) 500.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/database/migrations/runner.js';
import { seedInitialOffice } from '../../src/database/seeds/initial_office.js';
import { TaskRepository } from '../../src/database/repositories/task.repository.js';
import { TaskService } from '../../src/modules/tasks/task.service.js';

process.env.INITIAL_DIRECTOR_PASSWORD = process.env.INITIAL_DIRECTOR_PASSWORD || 'TestPass123456';

describe('TaskRepository priority ordering (SQL literal regression)', () => {
  let db;
  let taskRepo;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    await seedInitialOffice(db);
    taskRepo = new TaskRepository(db);
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('getAllTasks sorts by priority without throwing', () => {
    taskRepo.createTask({ id: 'task_low', title: 'Low', priority: 'low' });
    taskRepo.createTask({ id: 'task_normal', title: 'Normal', priority: 'normal' });
    taskRepo.createTask({ id: 'task_critical', title: 'Critical', priority: 'critical' });
    taskRepo.createTask({ id: 'task_high', title: 'High', priority: 'high' });

    const tasks = taskRepo.getAllTasks({});
    expect(tasks.map((t) => t.id)).toEqual(['task_critical', 'task_high', 'task_normal', 'task_low']);
  });

  it('getSubtasks works (the exact path that broke GET /api/tasks/:id)', () => {
    taskRepo.createTask({ id: 'task_parent', title: 'Parent', priority: 'normal' });
    taskRepo.createTask({ id: 'task_child', title: 'Child', priority: 'critical', parentTaskId: 'task_parent' });
    const subtasks = taskRepo.getSubtasks('task_parent');
    expect(subtasks.map((t) => t.id)).toEqual(['task_child']);
  });

  it('TaskService.getById returns full detail including subtasks', () => {
    taskRepo.createTask({ id: 'task_detail', title: 'Detail', priority: 'high' });
    taskRepo.createTask({ id: 'task_detail_sub', title: 'Sub', priority: 'normal', parentTaskId: 'task_detail' });
    const service = new TaskService(db);
    const detail = service.getById('task_detail');
    expect(detail.id).toBe('task_detail');
    expect(detail.subtasks.map((t) => t.id)).toEqual(['task_detail_sub']);
  });
});