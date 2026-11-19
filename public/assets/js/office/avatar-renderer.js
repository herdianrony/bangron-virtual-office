import { iso } from './isometric.js';

export const DEPARTMENT_COLORS = {
  Operations: '#3b82f6',
  Development: '#10b981',
  'UI/UX': '#06b6d4',
  'Creative Studio': '#ec4899',
  'Quality Assurance': '#f59e0b',
  Research: '#8b5cf6',
  Marketing: '#f97316',
  General: '#6b7280',
  Executive: '#eab308'
};

export const STATUS_HALO_COLORS = {
  working: '#3b82f6',
  thinking: '#8b5cf6',
  walking: '#38bdf8',
  collaborating: '#06b6d4',
  waiting: '#f59e0b',
  completed: '#10b981',
  failed: '#ef4444',
  idle: '#6b7280',
  offline: '#374151'
};

export class AvatarRenderer {
  renderAvatar(agent) {
    const screenPos = iso.toScreen(agent.x || 0, agent.y || 0, agent.z || 0);
    const color = DEPARTMENT_COLORS[agent.department] || '#3b82f6';
    const haloColor = STATUS_HALO_COLORS[agent.status] || '#6b7280';
    const isFlipped = agent.direction === 'SW' || agent.direction === 'NW';

    // Simple walk cycle: legs lift alternately with a subtle body bob while
    // the agent is moving; standing agents keep both feet on the ground.
    const walkPhase = agent.walkPhase || 0;
    const liftA = agent.moving ? Math.max(0, Math.sin(walkPhase)) * 3.2 : 0;
    const liftB = agent.moving ? Math.max(0, -Math.sin(walkPhase)) * 3.2 : 0;
    const bob = agent.moving ? Math.abs(Math.sin(walkPhase)) * 1.3 : 0;

    // Status bubble text
    let bubbleText = '';
    if (agent.status === 'walking') bubbleText = agent.move_note || agent.moveNote || 'Walking...';
    else if (agent.status === 'thinking') bubbleText = 'Thinking...';
    else if (agent.status === 'collaborating') bubbleText = 'Syncing...';
    else if (agent.status === 'waiting') bubbleText = 'Approval Req';
    else if (agent.current_tool) bubbleText = `Tool: ${agent.current_tool}`;
    else if (agent.active_task_title) bubbleText = agent.active_task_title.substring(0, 18) + '...';

    return `
      <g class="agent-avatar-node" data-agent-id="${agent.id}" data-name="${this.escapeHtml(agent.display_name.replace('[DEMO] ', ''))} — ${this.escapeHtml(agent.status || 'idle')}" transform="translate(${screenPos.x}, ${screenPos.y})">
        <!-- Ground Shadow -->
        <ellipse cx="0" cy="2" rx="14" ry="7" fill="rgba(0, 0, 0, 0.45)" />

        <!-- Status Glow Aura -->
        <ellipse cx="0" cy="2" rx="18" ry="9" fill="none" stroke="${haloColor}" stroke-width="2" opacity="0.8">
          ${agent.status === 'working' || agent.status === 'thinking' ? `
            <animate attributeName="rx" values="16;20;16" dur="2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.4;0.9;0.4" dur="2s" repeatCount="indefinite" />
          ` : ''}
        </ellipse>

        <!-- Avatar Character Container (with direction orientation + walk bob) -->
        <g transform="translate(0, ${(-bob).toFixed(2)}) scale(${isFlipped ? -1 : 1}, 1)">
          <!-- Legs (alternating step lift) -->
          <rect x="-4" y="-10" width="3" height="${(10 - liftA).toFixed(2)}" rx="1.5" fill="#1f2937" />
          <rect x="1" y="-10" width="3" height="${(10 - liftB).toFixed(2)}" rx="1.5" fill="#111827" />

          <!-- Torso / Jacket -->
          <rect x="-7" y="-24" width="14" height="15" rx="3" fill="#1e293b" stroke="${color}" stroke-width="1.5" />
          <!-- Tie / Department accent stripe -->
          <line x1="0" y1="-23" x2="0" y2="-12" stroke="${color}" stroke-width="2" />

          <!-- Arms -->
          <rect x="-9" y="-22" width="3" height="11" rx="1.5" fill="#334155" />
          <rect x="6" y="-22" width="3" height="11" rx="1.5" fill="#334155" />

          <!-- Head -->
          <circle cx="0" cy="-30" r="7" fill="#fcd34d" stroke="#b45309" stroke-width="0.8" />

          <!-- Cyber Visor / Glasses -->
          <rect x="-5" y="-32" width="10" height="3.5" rx="1" fill="${color}" filter="drop-shadow(0 0 4px ${color})" />

          <!-- Headset with Mic -->
          <path d="M -7 -30 A 7 7 0 0 1 7 -30" fill="none" stroke="#475569" stroke-width="2" />
          <circle cx="7" cy="-29" r="2" fill="#0f172a" />
          <line x1="7" y1="-28" x2="3" y2="-25" stroke="#475569" stroke-width="1.2" />
        </g>

        <!-- Floating Name Tag -->
        <g transform="translate(0, -42)">
          <rect x="-40" y="-8" width="80" height="14" rx="3" fill="rgba(15, 23, 42, 0.85)" stroke="${haloColor}" stroke-width="0.8" />
          <text x="0" y="3" font-size="8" font-weight="600" fill="#f8fafc" text-anchor="middle" font-family="sans-serif">
            ${this.escapeHtml(agent.display_name.replace('[DEMO] ', ''))}
          </text>
        </g>

        <!-- Overhead Thought / Tool Bubble if active -->
        ${bubbleText ? `
          <g transform="translate(0, -60)" class="agent-speech-bubble">
            <rect x="-50" y="-10" width="100" height="16" rx="5" fill="rgba(30, 41, 59, 0.95)" stroke="${haloColor}" stroke-width="1" />
            <polygon points="-4,6 4,6 0,11" fill="rgba(30, 41, 59, 0.95)" />
            <text x="0" y="2" font-size="7.5" font-weight="600" fill="#38bdf8" text-anchor="middle" font-family="sans-serif">
              ${this.escapeHtml(bubbleText)}
            </text>
          </g>
        ` : ''}
      </g>
    `;
  }

  escapeHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

export const avatarRenderer = new AvatarRenderer();
export default avatarRenderer;
