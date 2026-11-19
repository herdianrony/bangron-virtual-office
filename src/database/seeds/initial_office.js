import { hashPassword } from '../../utils/crypto.js';
import logger from '../../utils/logger.js';
import { OFFICE_ROOMS, OFFICE_WORKSTATIONS } from '../../services/office-layout.js';

export async function seedInitialOffice(db) {
  logger.info('Seeding initial office layout, director user, and core profiles...');

  const passwordHash = await hashPassword('DirectorPass123!');

  const tx = db.transaction(() => {
    // 1. Initial Director User
    const existingDirector = db.prepare('SELECT id FROM users WHERE email = ?').get('director@bangron.office');
    if (!existingDirector) {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO users (name, email, password_hash, role, is_active, created_at, updated_at)
        VALUES ('Bangron', 'director@bangron.office', ?, 'director', 1, ?, ?)
      `).run(passwordHash, now, now);
      logger.info('Created Director user (director@bangron.office)');
    } else {
      // Ensure password hash matches
      db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(passwordHash, 'director@bangron.office');
    }

    // 2. Office Rooms — architectural floor plan v2 (corridors + door metadata)
    const rooms = OFFICE_ROOMS;

    const now = new Date().toISOString();
    for (const r of rooms) {
      db.prepare(`
        INSERT INTO office_rooms (id, name, slug, department, description, position_x, position_y, width, height, metadata_json, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name, slug = excluded.slug, department = excluded.department,
          description = excluded.description, position_x = excluded.position_x, position_y = excluded.position_y,
          width = excluded.width, height = excluded.height, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at
      `).run(
        r.id, r.name, r.slug, r.department, r.description, r.px, r.py, r.w, r.h,
        JSON.stringify({ door: r.door, ...(r.entrance ? { entrance: true } : {}) }), now, now
      );
    }

    // 3. Office Workstations
    const workstations = OFFICE_WORKSTATIONS.map((ws) => ({
      id: ws.id, roomId: ws.roomId, name: ws.name, type: ws.type, px: ws.px, py: ws.py, cap: ws.cap
    }));

    for (const ws of workstations) {
      db.prepare(`
        INSERT INTO office_workstations (id, room_id, name, workstation_type, position_x, position_y, capacity, status, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'available', '{}', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          room_id = excluded.room_id, name = excluded.name, workstation_type = excluded.workstation_type,
          position_x = excluded.position_x, position_y = excluded.position_y, capacity = excluded.capacity,
          updated_at = excluded.updated_at
      `).run(ws.id, ws.roomId, ws.name, ws.type, ws.px, ws.py, ws.cap, now, now);
    }

    // 4. Specialist Agent Profiles
    const profiles = [
      {
        id: 'prof_hermes_ops',
        name: 'Hermes Main Orchestrator',
        slug: 'hermes-orchestrator',
        department: 'Operations',
        description: 'Lead orchestrator, analyzes Director instructions, plans subtasks, and delegates work to specialist agents.',
        systemRole: 'orchestrator',
        capabilities: ['planning', 'task_decomposition', 'subagent_delegation', 'result_aggregation'],
        allowedTools: ['delegate_task', 'inspect_subagent', 'reconcile_status', 'report_to_director'],
        defaultRoomId: 'room_ops'
      },
      {
        id: 'prof_dev_backend',
        name: 'Backend Developer',
        slug: 'backend-developer',
        department: 'Development',
        description: 'Implements REST APIs, data structures, authentication, and backend services.',
        systemRole: 'specialist',
        capabilities: ['api_design', 'database_modeling', 'business_logic', 'testing'],
        allowedTools: ['run_migrations', 'write_backend_code', 'query_database'],
        defaultRoomId: 'room_dev'
      },
      {
        id: 'prof_dev_frontend',
        name: 'Frontend Developer',
        slug: 'frontend-developer',
        department: 'Development',
        description: 'Builds interactive user interfaces, isometric renderers, and responsive web components.',
        systemRole: 'specialist',
        capabilities: ['ui_implementation', 'svg_isometric', 'state_management', 'realtime_ui'],
        allowedTools: ['write_frontend_code', 'bundle_assets', 'inspect_dom'],
        defaultRoomId: 'room_dev'
      },
      {
        id: 'prof_uiux_designer',
        name: 'UI/UX Designer',
        slug: 'uiux-designer',
        department: 'UI/UX',
        description: 'Designs design systems, user journeys, wireframes, and ergonomic micro-interactions.',
        systemRole: 'specialist',
        capabilities: ['wireframing', 'design_tokens', 'prototyping', 'usability_evaluation'],
        allowedTools: ['generate_svg_mockups', 'export_design_tokens'],
        defaultRoomId: 'room_uiux'
      },
      {
        id: 'prof_creative_artist',
        name: 'Brand & Creative Designer',
        slug: 'creative-designer',
        department: 'Creative Studio',
        description: 'Creates brand identities, visual assets, 2.5D isometric sprites, and marketing collateral.',
        systemRole: 'specialist',
        capabilities: ['vector_illustration', 'isometric_assets', 'brand_styleguide', 'motion_concepts'],
        allowedTools: ['render_svg_sprite', 'generate_palette'],
        defaultRoomId: 'room_creative'
      },
      {
        id: 'prof_qa_engineer',
        name: 'QA & Security Engineer',
        slug: 'qa-engineer',
        department: 'Quality Assurance',
        description: 'Executes integration tests, regression checks, and security audits.',
        systemRole: 'specialist',
        capabilities: ['test_automation', 'vulnerability_scanning', 'code_review', 'e2e_verification'],
        allowedTools: ['run_vitest', 'run_playwright', 'audit_dependencies'],
        defaultRoomId: 'room_qa'
      },
      {
        id: 'prof_research_analyst',
        name: 'Research Analyst',
        slug: 'research-analyst',
        department: 'Research',
        description: 'Conducts market analysis, tech stack research, and produces architectural documentation.',
        systemRole: 'specialist',
        capabilities: ['technical_research', 'competitor_benchmarking', 'documentation_synthesis'],
        allowedTools: ['search_docs', 'compile_whitepaper'],
        defaultRoomId: 'room_research'
      },
      {
        id: 'prof_marketing_lead',
        name: 'Content & Growth Strategist',
        slug: 'marketing-lead',
        department: 'Marketing',
        description: 'Develops product messaging, launch campaigns, and SEO content.',
        systemRole: 'specialist',
        capabilities: ['copywriting', 'seo_optimization', 'launch_campaigns'],
        allowedTools: ['generate_copy', 'check_seo_score'],
        defaultRoomId: 'room_marketing'
      }
    ];

    for (const p of profiles) {
      db.prepare(`
        INSERT INTO agent_profiles (
          id, name, slug, department, description, system_role,
          capabilities_json, allowed_tools_json, default_room_id, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name, slug = excluded.slug, department = excluded.department,
          description = excluded.description, system_role = excluded.system_role,
          capabilities_json = excluded.capabilities_json, allowed_tools_json = excluded.allowed_tools_json,
          default_room_id = excluded.default_room_id, updated_at = excluded.updated_at
      `).run(
        p.id,
        p.name,
        p.slug,
        p.department,
        p.description,
        p.systemRole,
        JSON.stringify(p.capabilities),
        JSON.stringify(p.allowedTools),
        p.defaultRoomId,
        now,
        now
      );
    }
  });

  tx();
  logger.info('Initial office, rooms, workstations, and agent profiles seeded successfully.');
}

export default seedInitialOffice;
