/**
 * Bangron Virtual Office — canonical architectural floor plan (layout v2).
 *
 * Single source of truth for the office architecture, consumed by:
 *   - src/database/seeds/initial_office.js      (rooms + workstations upsert)
 *   - src/services/navigation.js                (corridor waypoint graph)
 *   - src/modules/virtual-office/virtual-office.service.js (state API → frontend)
 *   - src/modules/demo/demo-engine.js           (routine spots & idle breaks)
 *
 * Layout model (top-down, world units = pixels):
 *
 *   ┌────────────────────────────┬──────┬──────────────────────────┐
 *   │ Director Office            │      │ Operations Room          │  north band
 *   ├───────────────┬────────────┤ kor. ├────────┬────────┬────────┤  (doors face S)
 *   │ Meeting Room  └────────────┤ tengah│        │ UI/UX  │ QA Lab │
 *   ├──────────┬─────────┬───────┴══════┴────────┴────────┴────────┤
 *   │ Dev      │ Research│ Marketing│          │ Perpustakaan │ Ruang │  middle band
 *   │          │         │          │ koridor  │              │ Kopi  │  (doors face N)
 *   ├──────────┴─────────┴──────────┼─utara────┴──────────────┴───────┤
 *   │ Lounge    │ Creative Studio  │          │ Reception │ Server   │  south band
 *   │           │                  │          │  [ pintu utama ▼ ]   │  (doors face N)
 *   └───────────┴──────────────────┴──────────┴──────────────────────┘
 *
 * Every room opens onto a corridor (door metadata), so agents always walk
 * through hallways and never cut through walls. Two extra amenities support
 * idle behaviour: `room_coffee` (Ruang Kopi) and `room_library` (Perpustakaan).
 */

export const BUILDING_BOUNDS = { x: 14, y: 14, w: 992, h: 668 };

/** Rooms: px/py/w/h are the floor-plate rectangles; door.side is the edge that opens onto a corridor. */
export const OFFICE_ROOMS = [
  // North band — doors open south onto the main corridor
  { id: 'room_dir', name: 'Director Office', slug: 'director-office', department: 'Executive', description: 'Director command post and strategic control', px: 30, py: 40, w: 220, h: 255, door: { side: 'S' } },
  { id: 'room_meeting', name: 'Meeting Room', slug: 'meeting-room', department: 'General', description: 'Cross-functional sync and multi-agent collaboration', px: 250, py: 115, w: 205, h: 180, door: { side: 'S' } },
  { id: 'room_ops', name: 'Operations Room', slug: 'operations-room', department: 'Operations', description: 'Hermes Main Agent orchestration center', px: 500, py: 40, w: 170, h: 255, door: { side: 'S' } },
  { id: 'room_uiux', name: 'UI/UX Lab', slug: 'uiux-lab', department: 'UI/UX', description: 'Design systems, wireframes, and prototypes', px: 670, py: 145, w: 140, h: 150, door: { side: 'S' } },
  { id: 'room_qa', name: 'QA Laboratory', slug: 'qa-laboratory', department: 'Quality Assurance', description: 'Quality assurance, code review, security auditing', px: 810, py: 90, w: 160, h: 205, door: { side: 'S' } },

  // Middle band — doors open north onto the main corridor
  { id: 'room_dev', name: 'Development Room', slug: 'development-room', department: 'Development', description: 'Software architecture, backend, frontend, database engineering', px: 30, py: 340, w: 160, h: 140, door: { side: 'N' } },
  { id: 'room_research', name: 'Research Lab', slug: 'research-lab', department: 'Research', description: 'Deep technical research and competitive analysis', px: 190, py: 340, w: 140, h: 140, door: { side: 'N' } },
  { id: 'room_marketing', name: 'Marketing Room', slug: 'marketing-room', department: 'Marketing', description: 'Growth, campaigns, content and SEO', px: 330, py: 340, w: 125, h: 140, door: { side: 'N' } },
  { id: 'room_library', name: 'Perpustakaan', slug: 'library', department: 'General', description: 'Quiet reading room with technical books and reference archives', px: 500, py: 340, w: 235, h: 140, door: { side: 'N' } },
  { id: 'room_coffee', name: 'Ruang Kopi', slug: 'coffee-room', department: 'General', description: 'Pantry with an espresso bar for casual breaks and small talk', px: 735, py: 340, w: 235, h: 140, door: { side: 'N' } },

  // South band — doors open north onto the south corridor
  { id: 'room_lounge', name: 'Lounge', slug: 'lounge', department: 'General', description: 'Breakroom, informal syncs, and the lounge sofa', px: 30, py: 525, w: 220, h: 125, door: { side: 'N' } },
  { id: 'room_creative', name: 'Creative Studio', slug: 'creative-studio', department: 'Creative Studio', description: 'Visual branding, graphics, and motion assets', px: 250, py: 525, w: 205, h: 125, door: { side: 'N' } },
  { id: 'room_reception', name: 'Reception', slug: 'reception', department: 'General', description: 'Office entrance, visitor welcome area, and main gate', px: 500, py: 525, w: 230, h: 125, door: { side: 'N' }, entrance: true },
  { id: 'room_server', name: 'Server Room', slug: 'server-room', department: 'DevOps & Automation', description: 'High-density compute, CI/CD runners, and telemetry', px: 730, py: 525, w: 240, h: 125, door: { side: 'N' } }
];

/** Corridor rectangles. `entry: true` marks the front porch (creates the main-gate wall gap). */
export const OFFICE_CORRIDORS = [
  { id: 'corr_main', x: 30, y: 295, w: 940, h: 45 },
  { id: 'corr_south', x: 30, y: 480, w: 940, h: 45 },
  { id: 'corr_cross', x: 455, y: 30, w: 45, h: 620 },
  { id: 'corr_porch', x: 455, y: 650, w: 45, h: 16, entry: true }
];

/** Workstations (furniture anchors). Agents are seated at position_x/position_y. */
export const OFFICE_WORKSTATIONS = [
  { id: 'ws_dir_desk', roomId: 'room_dir', name: 'Director Command Station', type: 'executive_desk', px: 140, py: 235, cap: 1 },
  { id: 'ws_meeting_table', roomId: 'room_meeting', name: 'Conference Hub', type: 'conference_table', px: 352, py: 205, cap: 4 },
  { id: 'ws_ops_orchestrator', roomId: 'room_ops', name: 'Hermes Orchestration Station', type: 'command_pod', px: 585, py: 165, cap: 1 },
  { id: 'ws_uiux_desk_1', roomId: 'room_uiux', name: 'UI/UX Design Station', type: 'design_bench', px: 740, py: 250, cap: 1 },
  { id: 'ws_qa_desk_1', roomId: 'room_qa', name: 'QA Test & Security Station', type: 'qa_bench', px: 890, py: 230, cap: 1 },

  { id: 'ws_dev_desk_backend', roomId: 'room_dev', name: 'Backend Engineering Station', type: 'dev_desk', px: 85, py: 430, cap: 1 },
  { id: 'ws_dev_desk_frontend', roomId: 'room_dev', name: 'Frontend Engineering Station', type: 'dev_desk', px: 135, py: 430, cap: 1 },
  { id: 'ws_research_desk_1', roomId: 'room_research', name: 'Research Analyst Station', type: 'bench', px: 260, py: 430, cap: 1 },
  { id: 'ws_marketing_desk_1', roomId: 'room_marketing', name: 'Content Strategist Station', type: 'desk', px: 392, py: 430, cap: 1 },
  { id: 'ws_library_table', roomId: 'room_library', name: 'Library Reading Table', type: 'library_table', px: 617, py: 430, cap: 2 },
  { id: 'ws_coffee_bar', roomId: 'room_coffee', name: 'Espresso Bar', type: 'coffee_bar', px: 855, py: 445, cap: 3 },

  { id: 'ws_lounge_sofa', roomId: 'room_lounge', name: 'Lounge Sofa', type: 'couch', px: 140, py: 590, cap: 2 },
  { id: 'ws_creative_desk_1', roomId: 'room_creative', name: 'Digital Art Station', type: 'creative_bench', px: 352, py: 590, cap: 1 },
  { id: 'ws_reception_desk', roomId: 'room_reception', name: 'Front Desk', type: 'reception', px: 615, py: 588, cap: 1 },
  { id: 'ws_server_terminal', roomId: 'room_server', name: 'Infrastructure Terminal', type: 'terminal', px: 850, py: 590, cap: 1 }
];

/**
 * Named destinations for the demo engine & idle breaks.
 * x/y must sit inside the referenced room (agents walk the door → spot leg).
 */
export const DEMO_SPOTS = {
  meeting: { roomId: 'room_meeting', workstationId: 'ws_meeting_table', x: 352, y: 205, cap: 4, label: 'the Conference Hub' },
  lounge: { roomId: 'room_lounge', workstationId: 'ws_lounge_sofa', x: 140, y: 590, cap: 2, label: 'the Lounge Sofa' },
  server: { roomId: 'room_server', workstationId: 'ws_server_terminal', x: 850, y: 590, cap: 1, label: 'the Infrastructure Terminal' },
  uiux: { roomId: 'room_uiux', workstationId: 'ws_uiux_desk_1', x: 740, y: 250, cap: 1, label: 'the UI/UX Design Station' },
  director: { roomId: 'room_dir', workstationId: 'ws_dir_desk', x: 140, y: 235, cap: 1, label: 'the Director Command Station' },
  coffee: { roomId: 'room_coffee', workstationId: 'ws_coffee_bar', x: 855, y: 445, cap: 3, label: 'the Coffee Bar' },
  library: { roomId: 'room_library', workstationId: 'ws_library_table', x: 617, y: 430, cap: 2, label: 'the Library Reading Table' }
};

/** Where idle agents recharge (Director's favourite: coffee first, then library). */
export const BREAK_SPOTS = [DEMO_SPOTS.coffee, DEMO_SPOTS.library, DEMO_SPOTS.lounge];

export default {
  BUILDING_BOUNDS,
  OFFICE_ROOMS,
  OFFICE_CORRIDORS,
  OFFICE_WORKSTATIONS,
  DEMO_SPOTS,
  BREAK_SPOTS
};
