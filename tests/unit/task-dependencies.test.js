import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/database/migrations/runner.js';
import { TaskRepository } from '../../src/database/repositories/task.repository.js';

describe('Task Dependencies & Anti-Cycle Validation', () => {
  let db;
  let taskRepo;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    taskRepo = new TaskRepository(db);

    // Create 3 tasks
    taskRepo.createTask({ id: 'task_A', title: 'Task A' });
    taskRepo.createTask({ id: 'task_B', title: 'Task B' });
    taskRepo.createTask({ id: 'task_C', title: 'Task C' });
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('allows valid sequential dependencies: A -> B -> C', () => {
    // task_B depends on task_A
    taskRepo.addDependency('task_B', 'task_A');
    // task_C depends on task_B
    taskRepo.addDependency('task_C', 'task_B');

    expect(taskRepo.arePrerequisitesSatisfied('task_B')).toBe(false);

    // Complete task A
    taskRepo.updateTaskStatus('task_A', 'completed');
    expect(taskRepo.arePrerequisitesSatisfied('task_B')).toBe(true);
    expect(taskRepo.arePrerequisitesSatisfied('task_C')).toBe(false);

    // Complete task B
    taskRepo.updateTaskStatus('task_B', 'completed');
    expect(taskRepo.arePrerequisitesSatisfied('task_C')).toBe(true);
  });

  it('rejects circular dependencies: A -> B -> C -> A', () => {
    taskRepo.addDependency('task_B', 'task_A');
    taskRepo.addDependency('task_C', 'task_B');

    // Attempting to make task_A depend on task_C creates cycle A -> B -> C -> A
    expect(() => {
      taskRepo.addDependency('task_A', 'task_C');
    }).toThrow(/Circular dependency detected/);
  });

  it('rejects self-referencing dependency: A -> A', () => {
    expect(() => {
      taskRepo.addDependency('task_A', 'task_A');
    }).toThrow(/Task cannot depend on itself/);
  });
});
