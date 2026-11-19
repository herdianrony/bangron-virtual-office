import { iso } from './isometric.js';

export class OfficeRenderer {
  renderRooms(rooms = []) {
    return rooms.map((room) => this.renderRoom(room)).join('\n');
  }

  renderRoom(room) {
    const { id, name, position_x: px, position_y: py, width: w, height: h, department } = room;
    const floorPath = iso.getIsoPolygonPath(px, py, w, h);

    // Wall heights in Z dimension
    const wallH = 28;
    const p1 = iso.toScreen(px, py, 0);
    const p2 = iso.toScreen(px + w, py, 0);
    const p4 = iso.toScreen(px, py + h, 0);

    const p1Top = iso.toScreen(px, py, wallH);
    const p2Top = iso.toScreen(px + w, py, wallH);
    const p4Top = iso.toScreen(px, py + h, wallH);

    // North-West wall polygon: p1 -> p4 -> p4Top -> p1Top
    const nwWall = `M ${p1.x} ${p1.y} L ${p4.x} ${p4.y} L ${p4Top.x} ${p4Top.y} L ${p1Top.x} ${p1Top.y} Z`;
    // North-East wall polygon: p1 -> p2 -> p2Top -> p1Top
    const neWall = `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} L ${p2Top.x} ${p2Top.y} L ${p1Top.x} ${p1Top.y} Z`;

    const labelPos = iso.toScreen(px + w / 2, py + 14, 0);

    return `
      <g class="room-group" data-room-id="${id}">
        <!-- Isometric North Walls -->
        <path d="${nwWall}" fill="#162032" stroke="#24344d" stroke-width="1.2" />
        <path d="${neWall}" fill="#1c293f" stroke="#24344d" stroke-width="1.2" />

        <!-- Isometric Floor -->
        <path d="${floorPath}" fill="#111827" stroke="#2c3e55" stroke-width="1" class="room-floor" />

        <!-- Interior Floor Ambient Grid Tile Pattern -->
        <path d="${floorPath}" fill="url(#iso-grid-pattern)" opacity="0.35" />

        <!-- Room Title Badge -->
        <g transform="translate(${labelPos.x}, ${labelPos.y})" pointer-events="none">
          <rect x="-55" y="-12" width="110" height="18" rx="4" fill="rgba(15, 23, 42, 0.75)" stroke="#374151" stroke-width="0.8" />
          <text x="0" y="1" font-size="9" font-weight="700" fill="#93c5fd" text-anchor="middle" font-family="sans-serif">
            ${name}
          </text>
        </g>
      </g>
    `;
  }

  renderFurniture(workstations = []) {
    return workstations.map((ws) => this.renderWorkstationFurniture(ws)).join('\n');
  }

  renderWorkstationFurniture(ws) {
    const { id, workstation_type, position_x: px, position_y: py, name, occupied_by_agent_id } = ws;
    const base = iso.toScreen(px, py, 0);
    const top = iso.toScreen(px, py, 14);

    if (workstation_type === 'terminal' || ws.room_id === 'room_server') {
      // High-density Server Rack
      const rTop = iso.toScreen(px, py, 45);
      return `
        <g class="furniture-server" data-ws-id="${id}" transform="translate(${base.x}, ${base.y})">
          <ellipse cx="0" cy="0" rx="14" ry="7" fill="rgba(0,0,0,0.5)" />
          <!-- Server chassis -->
          <path d="M -12 -5 L 12 5 L 12 -40 L -12 -50 Z" fill="#0f172a" stroke="#38bdf8" stroke-width="1" />
          <path d="M 12 5 L 20 1 L 20 -44 L 12 -40 Z" fill="#1e293b" />
          <!-- Blinking Server LEDs -->
          <circle cx="-5" cy="-15" r="1.5" fill="#10b981"><animate attributeName="opacity" values="0.2;1;0.2" dur="0.8s" repeatCount="indefinite" /></circle>
          <circle cx="2" cy="-15" r="1.5" fill="#06b6d4"><animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="indefinite" /></circle>
          <circle cx="-5" cy="-25" r="1.5" fill="#10b981"><animate attributeName="opacity" values="0.3;1;0.3" dur="0.9s" repeatCount="indefinite" /></circle>
          <circle cx="2" cy="-25" r="1.5" fill="#3b82f6"><animate attributeName="opacity" values="1;0.4;1" dur="1.5s" repeatCount="indefinite" /></circle>
        </g>
      `;
    }

    if (workstation_type === 'conference_table') {
      // Large Conference Meeting Table
      return `
        <g class="furniture-conference" data-ws-id="${id}" transform="translate(${base.x}, ${base.y})">
          <ellipse cx="0" cy="0" rx="36" ry="18" fill="rgba(0,0,0,0.4)" />
          <!-- Table Surface -->
          <ellipse cx="0" cy="-10" rx="34" ry="17" fill="#1e293b" stroke="#3b82f6" stroke-width="1.5" />
          <ellipse cx="0" cy="-10" rx="20" ry="10" fill="#0f172a" stroke="#1d4ed8" stroke-width="0.8" />
          <!-- Central Hologram Projector -->
          <ellipse cx="0" cy="-10" rx="5" ry="2.5" fill="#06b6d4" />
          <line x1="0" y1="-10" x2="0" y2="-25" stroke="#38bdf8" stroke-width="1" stroke-dasharray="2,2" />
        </g>
      `;
    }

    if (workstation_type === 'couch') {
      // Lounge Sofa
      return `
        <g class="furniture-sofa" data-ws-id="${id}" transform="translate(${base.x}, ${base.y})">
          <ellipse cx="0" cy="0" rx="24" ry="12" fill="rgba(0,0,0,0.35)" />
          <path d="M -22 -6 C -22 -14 22 -14 22 -6 L 22 2 C 22 10 -22 10 -22 2 Z" fill="#334155" stroke="#475569" stroke-width="1" />
          <ellipse cx="0" cy="-2" rx="18" ry="7" fill="#475569" />
        </g>
      `;
    }

    // Default Workstation Desk + Glowing PC Monitor
    return `
      <g class="furniture-desk" data-ws-id="${id}" transform="translate(${base.x}, ${base.y})">
        <!-- Floor Shadow -->
        <ellipse cx="0" cy="0" rx="20" ry="10" fill="rgba(0, 0, 0, 0.4)" />
        <!-- Desk legs -->
        <line x1="-15" y1="0" x2="-15" y2="-12" stroke="#1e293b" stroke-width="2.5" />
        <line x1="15" y1="0" x2="15" y2="-12" stroke="#1e293b" stroke-width="2.5" />
        <!-- Desk Surface -->
        <polygon points="-18,-14 0,-22 18,-14 0,-6" fill="#1e293b" stroke="#334155" stroke-width="1.2" />
        <!-- Computer Monitor -->
        <line x1="0" y1="-14" x2="0" y2="-20" stroke="#475569" stroke-width="2" />
        <rect x="-8" y="-30" width="16" height="10" rx="1" fill="#0f172a" stroke="#06b6d4" stroke-width="1" />
        <!-- Screen Glow -->
        <rect x="-7" y="-29" width="14" height="8" fill="#0284c7" opacity="0.85">
          <animate attributeName="opacity" values="0.75;1;0.75" dur="3s" repeatCount="indefinite" />
        </rect>
        <!-- Workstation Status Ring -->
        <circle cx="0" cy="8" r="3" fill="${occupied_by_agent_id ? '#3b82f6' : '#10b981'}" opacity="0.9" />
      </g>
    `;
  }
}

export const officeRenderer = new OfficeRenderer();
export default officeRenderer;
