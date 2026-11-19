import logger from '../../utils/logger.js';

export function seedDemoData(db) {
  logger.info('Seeding isolated DEMO workspace data...');

  const tx = db.transaction(() => {
    const now = new Date().toISOString();
    const past10m = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const past8m = new Date(Date.now() - 8 * 60 * 1000).toISOString();
    const past5m = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const past4m = new Date(Date.now() - 4 * 60 * 1000).toISOString();
    const past2m = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const past1m = new Date(Date.now() - 1 * 60 * 1000).toISOString();

    // 1. Demo Project
    db.prepare(`
      INSERT INTO projects (id, name, slug, description, status, priority, start_date, due_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', 'high', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, updated_at = excluded.updated_at
    `).run(
      'proj_demo_saas',
      '[DEMO] AI SaaS Digital Studio Launch',
      'demo-saas-launch',
      'Production demonstration project for Bangron Virtual Office multi-agent execution pipeline.',
      past10m,
      new Date(Date.now() + 7 * 86400000).toISOString(),
      past10m,
      now
    );

    // 2. Demo Agent Instances (at least 5 specialists)
    const demoAgents = [
      {
        id: 'inst_demo_hermes',
        profileId: 'prof_hermes_ops',
        displayName: '[DEMO] Hermes Orchestrator',
        status: 'working',
        roomId: 'room_ops',
        wsId: 'ws_ops_orchestrator',
        px: 585,
        py: 165,
        dir: 'SE'
      },
      {
        id: 'inst_demo_backend',
        profileId: 'prof_dev_backend',
        displayName: '[DEMO] Alex (Backend Dev)',
        status: 'working',
        roomId: 'room_dev',
        wsId: 'ws_dev_desk_backend',
        px: 85,
        py: 430,
        dir: 'SE'
      },
      {
        id: 'inst_demo_frontend',
        profileId: 'prof_dev_frontend',
        displayName: '[DEMO] Sarah (Frontend Dev)',
        status: 'working',
        roomId: 'room_dev',
        wsId: 'ws_dev_desk_frontend',
        px: 135,
        py: 430,
        dir: 'NW'
      },
      {
        id: 'inst_demo_uiux',
        profileId: 'prof_uiux_designer',
        displayName: '[DEMO] Maya (UI/UX Designer)',
        status: 'collaborating',
        roomId: 'room_meeting',
        wsId: 'ws_meeting_table',
        px: 352,
        py: 205,
        dir: 'NE'
      },
      {
        id: 'inst_demo_qa',
        profileId: 'prof_qa_engineer',
        displayName: '[DEMO] Marcus (QA & Security)',
        status: 'waiting',
        roomId: 'room_qa',
        wsId: 'ws_qa_desk_1',
        px: 890,
        py: 230,
        dir: 'SE'
      },
      {
        id: 'inst_demo_creative',
        profileId: 'prof_creative_artist',
        displayName: '[DEMO] Luna (Brand Designer)',
        status: 'idle',
        roomId: 'room_creative',
        wsId: 'ws_creative_desk_1',
        px: 352,
        py: 590,
        dir: 'SW'
      },
      {
        id: 'inst_demo_research',
        profileId: 'prof_research_analyst',
        displayName: '[DEMO] David (Research Analyst)',
        status: 'completed',
        roomId: 'room_research',
        wsId: 'ws_research_desk_1',
        px: 260,
        py: 430,
        dir: 'SE'
      }
    ];

    for (const a of demoAgents) {
      db.prepare(`
        INSERT INTO agent_instances (
          id, profile_id, runtime_type, runtime_identifier, display_name,
          status, current_room_id, current_workstation_id, metadata_json, last_seen_at, created_at, updated_at
        ) VALUES (?, ?, 'demo', ?, ?, ?, ?, ?, '{"is_demo": true}', ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = excluded.display_name, status = excluded.status,
          current_room_id = excluded.current_room_id, current_workstation_id = excluded.current_workstation_id,
          last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at
      `).run(
        a.id,
        a.profileId,
        `demo-worker-${a.id}`,
        a.displayName,
        a.status,
        a.roomId,
        a.wsId,
        now,
        past10m,
        now
      );

      // Office position
      db.prepare(`
        INSERT INTO office_positions (id, agent_instance_id, room_id, workstation_id, position_x, position_y, direction, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(agent_instance_id) DO UPDATE SET
          room_id = excluded.room_id, workstation_id = excluded.workstation_id,
          position_x = excluded.position_x, position_y = excluded.position_y,
          direction = excluded.direction, updated_at = excluded.updated_at
      `).run(
        `pos_${a.id}`,
        a.id,
        a.roomId,
        a.wsId,
        a.px,
        a.py,
        a.dir,
        now
      );
    }

    // 3. Demo Tasks (Parent task, subtasks, completed, running, waiting, failed)
    // Parent Task:
    db.prepare(`
      INSERT INTO agent_tasks (id, project_id, parent_task_id, title, description, status, priority, assigned_agent_id, created_by, requires_approval, started_at, created_at, updated_at)
      VALUES (?, ?, NULL, ?, ?, 'running', 'high', ?, 'director', 0, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
    `).run(
      'task_demo_parent',
      'proj_demo_saas',
      '[DEMO] Orchestrate SaaS Landing Page & Infrastructure',
      'Hermes orchestrates multi-agent delegation across UI/UX, Backend, and QA specialists.',
      'inst_demo_hermes',
      past10m,
      past10m,
      now
    );

    // Subtask 1: Research (Completed)
    db.prepare(`
      INSERT INTO agent_tasks (id, project_id, parent_task_id, title, description, status, priority, assigned_agent_id, created_by, requires_approval, started_at, completed_at, result_summary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'completed', 'normal', ?, 'director', 0, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, result_summary = excluded.result_summary, updated_at = excluded.updated_at
    `).run(
      'task_demo_sub_research',
      'proj_demo_saas',
      'task_demo_parent',
      '[DEMO] Market & Tech Stack Benchmark',
      'Analyze competitor landing pages and recommend performant isometric rendering approach.',
      'inst_demo_research',
      past10m,
      past5m,
      'Completed benchmark report. Recommended lightweight SVG with requestAnimationFrame.',
      past10m,
      past5m
    );

    // Subtask 2: Backend REST & SQLite Setup (Running)
    db.prepare(`
      INSERT INTO agent_tasks (id, project_id, parent_task_id, title, description, status, priority, assigned_agent_id, created_by, requires_approval, started_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'running', 'high', ?, 'director', 0, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
    `).run(
      'task_demo_sub_backend',
      'proj_demo_saas',
      'task_demo_parent',
      '[DEMO] Core Backend API & Realtime WebSockets',
      'Implement prepared statements, WAL mode, and WebSocket publisher.',
      'inst_demo_backend',
      past5m,
      past5m,
      now
    );

    // Subtask 3: Isometric Visual Interface (Running)
    db.prepare(`
      INSERT INTO agent_tasks (id, project_id, parent_task_id, title, description, status, priority, assigned_agent_id, created_by, requires_approval, started_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'running', 'high', ?, 'director', 0, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
    `).run(
      'task_demo_sub_frontend',
      'proj_demo_saas',
      'task_demo_parent',
      '[DEMO] SVG 2.5D Isometric Rendering Engine',
      'Render 12 studio rooms, camera pan/zoom, and avatar waypoints.',
      'inst_demo_frontend',
      past5m,
      past5m,
      now
    );

    // Subtask 4: QA & Vulnerability Audit (Waiting for Approval)
    db.prepare(`
      INSERT INTO agent_tasks (id, project_id, parent_task_id, title, description, status, priority, assigned_agent_id, created_by, requires_approval, started_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'waiting', 'critical', ?, 'director', 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, requires_approval = 1, updated_at = excluded.updated_at
    `).run(
      'task_demo_sub_qa',
      'proj_demo_saas',
      'task_demo_parent',
      '[DEMO] Production Deploy & Database Migration Verification',
      'Perform production migration and automated end-to-end security sweep.',
      'inst_demo_qa',
      past1m,
      past1m,
      now
    );

    // Subtask 5: Failed legacy migration task for failure testing demonstration
    db.prepare(`
      INSERT INTO agent_tasks (id, project_id, parent_task_id, title, description, status, priority, assigned_agent_id, created_by, requires_approval, started_at, completed_at, result_summary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'failed', 'low', ?, 'director', 0, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, result_summary = excluded.result_summary, updated_at = excluded.updated_at
    `).run(
      'task_demo_sub_failed',
      'proj_demo_saas',
      'task_demo_parent',
      '[DEMO] Deprecated Legacy Sync Service',
      'Attempted sync with retired external webhook.',
      'inst_demo_backend',
      past10m,
      past5m,
      'Connection timed out: legacy endpoint unreachable (code: ETIMEDOUT).',
      past10m,
      past5m
    );

    // 4. Task Dependencies (Subtasks 2 & 3 depend on Subtask 1, Subtask 4 depends on Subtask 2)
    db.prepare(`
      INSERT INTO agent_dependencies (id, task_id, depends_on_task_id, dependency_type, created_at)
      VALUES (?, ?, ?, 'finish_to_start', ?)
      ON CONFLICT(task_id, depends_on_task_id) DO NOTHING
    `).run('dep_demo_1', 'task_demo_sub_backend', 'task_demo_sub_research', past10m);

    db.prepare(`
      INSERT INTO agent_dependencies (id, task_id, depends_on_task_id, dependency_type, created_at)
      VALUES (?, ?, ?, 'finish_to_start', ?)
      ON CONFLICT(task_id, depends_on_task_id) DO NOTHING
    `).run('dep_demo_2', 'task_demo_sub_frontend', 'task_demo_sub_research', past10m);

    db.prepare(`
      INSERT INTO agent_dependencies (id, task_id, depends_on_task_id, dependency_type, created_at)
      VALUES (?, ?, ?, 'finish_to_start', ?)
      ON CONFLICT(task_id, depends_on_task_id) DO NOTHING
    `).run('dep_demo_3', 'task_demo_sub_qa', 'task_demo_sub_backend', past5m);

    // 5. Demo Deliverables
    db.prepare(`
      INSERT INTO deliverables (id, task_id, agent_instance_id, name, description, file_path, mime_type, file_size, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
    `).run(
      'deliv_demo_benchmark',
      'task_demo_sub_research',
      'inst_demo_research',
      '[DEMO] Architectural Benchmark & Tech Evaluation.pdf',
      'Comparative performance analysis for 2.5D SVG Isometric rendering in digital studio environments.',
      'storage/uploads/demo_benchmark_report.pdf',
      'application/pdf',
      245760,
      past5m,
      past5m
    );

    // 6. Demo Approval Request (High Risk: Production Deploy)
    db.prepare(`
      INSERT INTO approval_requests (
        id, task_id, requested_by, action_type, description, risk_level,
        payload_json, status, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'critical', ?, 'pending', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = 'pending', reviewed_by = NULL, reviewed_at = NULL, updated_at = excluded.updated_at
    `).run(
      'appr_demo_deploy',
      'task_demo_sub_qa',
      'inst_demo_qa',
      'deploy_production',
      '[DEMO] Requesting authorization to deploy production migration to live cluster.',
      JSON.stringify({ target: 'production-cluster-01', migrationVersion: 'v1.0.0', safetyChecks: 'passed' }),
      new Date(Date.now() + 24 * 3600000).toISOString(),
      past1m,
      now
    );

    // 7. Demo Activities
    const activities = [
      { id: 'act_demo_1', agent: 'inst_demo_hermes', task: 'task_demo_parent', type: 'task.decomposed', desc: 'Decomposed SaaS Launch objective into 5 specialist subtasks', time: past10m },
      { id: 'act_demo_2', agent: 'inst_demo_research', task: 'task_demo_sub_research', type: 'tool.executed', desc: 'Executed web search tool to gather isometric rendering benchmarks', time: past8m },
      { id: 'act_demo_3', agent: 'inst_demo_research', task: 'task_demo_sub_research', type: 'task.completed', desc: 'Delivered Architecture Benchmark PDF', time: past5m },
      { id: 'act_demo_4', agent: 'inst_demo_backend', task: 'task_demo_sub_backend', type: 'tool.executed', desc: 'Executing SQLite prepared statements migration test suite', time: past4m },
      { id: 'act_demo_5', agent: 'inst_demo_frontend', task: 'task_demo_sub_frontend', type: 'tool.executed', desc: 'Compiling SVG 2.5D Isometric viewport and room coordinate bounds', time: past2m },
      { id: 'act_demo_6', agent: 'inst_demo_qa', task: 'task_demo_sub_qa', type: 'approval.requested', desc: 'Submitted production deployment authorization request to Director', time: past1m }
    ];

    for (const act of activities) {
      db.prepare(`
        INSERT INTO agent_activities (id, agent_instance_id, session_id, task_id, activity_type, description, metadata_json, occurred_at, created_at)
        VALUES (?, ?, NULL, ?, ?, ?, '{"is_demo": true}', ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).run(act.id, act.agent, act.task, act.type, act.desc, act.time, act.time);
    }
  });

  tx();
  logger.info('DEMO workspace seeded with 7 agent instances, tasks, deliverables, and approval.');
}

export default seedDemoData;
