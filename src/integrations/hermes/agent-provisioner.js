import { AgentRepository } from '../../database/repositories/agent.repository.js';
import { OfficeRepository } from '../../database/repositories/office.repository.js';
import { ActivityRepository } from '../../database/repositories/activity.repository.js';
import { eventPublisher } from '../../realtime/event-publisher.js';
import logger from '../../utils/logger.js';

/**
 * Auto-provisioning agen Kantor Virtual dari identitas Hermes yang sebenarnya.
 *
 * Wire format resmi Outbound Webhooks Hermes membawa `profile` (nama profil
 * Hermes yang memancarkan event) dan terkadang `agent_id`. Ketika identitas
 * tersebut belum terdaftar di database kantor, provisioner membuat:
 *   1. agent_profiles  (nama = nama profil/agen Hermes yang asli)
 *   2. agent_instances (id deterministik: inst_hermes_<slug>, tetap stabil
 *      lintas event sehingga sesi sticky dan status konsisten)
 *   3. office_positions (avatar langsung muncul di kantor isometrik)
 * lalu menyiarkan `agent.created` via WebSocket.
 */

// Heuristik penempatan ruang kerja berdasarkan nama agen (Inggris + Indonesia).
const ROOM_HINTS = [
  { re: /\b(ui|ux)\b|ui\/ux/i, department: 'UI/UX', roomId: 'room_uiux' },
  { re: /\b(dev|developer|backend|frontend|engineer|fullstack|program\w*|coder|api|pengembang|koder)\b/i, department: 'Development', roomId: 'room_dev' },
  { re: /\b(qa|test|security|audit|keamanan|pengujian)\b/i, department: 'Quality Assurance', roomId: 'room_qa' },
  { re: /\b(research|analyst|analysis|data|riset|peneliti)\b/i, department: 'Research', roomId: 'room_research' },
  { re: /\b(design\w*|creative|brand|visual|art|artist|illustrat\w*|desain)\b/i, department: 'Creative Studio', roomId: 'room_creative' },
  { re: /\b(marketing|content|growth|seo|copywrit\w*|social|pemasaran|konten|penulis)\b/i, department: 'Marketing', roomId: 'room_marketing' },
  { re: /\b(orchestr\w*|ops|operations|manager|coordinat\w*|supervisor|lead|director|koordinator)\b/i, department: 'Operations', roomId: 'room_ops' }
];

const DEFAULT_PLACEMENT = { department: 'General', roomId: 'room_lounge' };

export class HermesAgentProvisioner {
  constructor(db) {
    this.db = db;
    this.agentRepo = new AgentRepository(db);
    this.officeRepo = new OfficeRepository(db);
    this.activityRepo = new ActivityRepository(db);
  }

  slugify(name) {
    const slug = String(name || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    return slug || 'agent';
  }

  // Slug unik untuk agent_profiles (kolom slug UNIQUE).
  _uniqueProfileSlug(base) {
    let candidate = base;
    let n = 2;
    while (this.db.prepare('SELECT 1 FROM agent_profiles WHERE slug = ?').get(candidate)) {
      candidate = `${base}-${n++}`;
    }
    return candidate;
  }

  guessPlacement(name, explicitDepartment = null) {
    if (explicitDepartment) {
      const byDept = this.db.prepare('SELECT id FROM office_rooms WHERE department = ? ORDER BY id LIMIT 1').get(explicitDepartment);
      if (byDept) return { department: explicitDepartment, roomId: byDept.id };
    }
    for (const hint of ROOM_HINTS) {
      if (hint.re.test(name)) return { department: hint.department, roomId: hint.roomId };
    }
    return { ...DEFAULT_PLACEMENT };
  }

  // Workstation bebas = belum dipegang agent manapun (junction agent_instances.current_workstation_id).
  _findFreeWorkstation(roomId) {
    return this.db.prepare(`
      SELECT w.* FROM office_workstations w
      LEFT JOIN agent_instances ai ON ai.current_workstation_id = w.id
      WHERE w.room_id = ? AND ai.id IS NULL
      ORDER BY w.name ASC LIMIT 1
    `).get(roomId);
  }

  _computeSpreadPosition(roomId) {
    const room = this.officeRepo.getRoomById(roomId);
    if (!room) return { positionX: 350, positionY: 310 };
    const occupied = this.db.prepare('SELECT COUNT(*) AS c FROM office_positions WHERE room_id = ?').get(roomId).c;
    const px = room.position_x + room.width / 2 + (occupied % 4) * 26 - 39;
    const py = room.position_y + room.height / 2 + Math.floor(occupied / 4) * 26;
    return { positionX: Math.round(px), positionY: Math.round(py) };
  }

  getInstanceByRealName(name) {
    return this.agentRepo.getInstanceById(`inst_hermes_${this.slugify(name)}`);
  }

  /**
   * Buat (atau ambil) agen sesuai identitas asli Hermes. Idempoten:
   * panggilan ulang dengan nama yang sama mengembalikan instance yang sama.
   */
  provision({ displayName, agentId = null, department = null, systemRole = null, source = 'hermes' }) {
    const name = String(displayName || '').trim();
    if (!name) return null;

    // 1. Identitas eksplisit yang sudah terdaftar menang.
    if (agentId && this.agentRepo.getInstanceById(agentId)) {
      return this.agentRepo.getInstanceById(agentId);
    }

    // 2. Id deterministik dari nama asli → sticky lintas event.
    const slug = this.slugify(name);
    const instanceId = `inst_hermes_${slug}`;
    const existing = this.agentRepo.getInstanceById(instanceId);
    if (existing) return existing;

    // 3. Provision baru: profil + instance + posisi kantor + broadcast.
    const placement = this.guessPlacement(name, department);
    const room = this.officeRepo.getRoomById(placement.roomId);
    if (!room) {
      logger.warn({ roomId: placement.roomId, name }, 'Gagal provision agen: ruang kerja tidak ditemukan');
      return null;
    }

    const profile = this.agentRepo.createProfile({
      id: `prof_hermes_${slug}`,
      name,
      slug: this._uniqueProfileSlug(slug),
      department: placement.department,
      description: `Auto-provisioned from Hermes${source ? ` (${source})` : ''}. Real agent name: ${name}`,
      systemRole: systemRole || `Autonomous Hermes agent profile for ${name}.`,
      capabilities: [],
      allowedTools: [],
      defaultRoomId: placement.roomId
    });

    const workstation = this._findFreeWorkstation(placement.roomId);
    const position = workstation
      ? { positionX: workstation.position_x, positionY: workstation.position_y }
      : this._computeSpreadPosition(placement.roomId);

    let instance;
    try {
      instance = this.agentRepo.createInstance({
        id: instanceId,
        profileId: profile.id,
        runtimeType: 'hermes',
        runtimeIdentifier: agentId || `hermes-profile:${name}`,
        displayName: name,
        currentRoomId: placement.roomId,
        currentWorkstationId: workstation ? workstation.id : null,
        status: 'idle'
      });
    } catch (err) {
      // Rollback profil orphan bila instance gagal (race/id duplikat).
      logger.warn({ err, instanceId }, 'Gagal membuat instance Hermes; profil orphan dibersihkan');
      this.db.prepare('DELETE FROM agent_profiles WHERE id = ? AND id NOT IN (SELECT profile_id FROM agent_instances)').run(profile.id);
      return this.agentRepo.getInstanceById(instanceId);
    }

    if (workstation) {
      this.officeRepo.reserveWorkstation(workstation.id, instanceId);
    }
    this.officeRepo.upsertPosition({
      agentInstanceId: instanceId,
      roomId: placement.roomId,
      workstationId: workstation ? workstation.id : null,
      positionX: position.positionX,
      positionY: position.positionY,
      direction: 'SE'
    });

    const instanceWithPosition = this.agentRepo.getInstanceById(instanceId);

    // Aktivitas + broadcast realtime agar avatar langsung muncul tanpa reload.
    const activity = this.activityRepo.recordActivity({
      agentInstanceId: instanceId,
      sessionId: null,
      taskId: null,
      activityType: 'agent.provisioned',
      description: `Agent '${name}' joined the office (auto-provisioned from Hermes identity).`,
      metadata: { source, agent_id: agentId, profile_name: name, room: room.name },
      occurredAt: new Date().toISOString()
    });
    eventPublisher.publishAgentActivity(activity);
    eventPublisher.publishAgentCreated(instanceWithPosition);

    logger.info({ instanceId, name, room: room.name }, 'Agen baru di-provision dari identitas Hermes asli');
    return instanceWithPosition;
  }

  /**
   * Resolusi identitas dari satu event Hermes:
   *   agent_id terdaftar (pakai apa adanya) → nama asli (profile, fallback agent_id).
   * Mengembalikan instance atau null (pemanggil memutuskan fallback default).
   */
  resolveFromEvent(event) {
    if (event.agent_id && this.agentRepo.getInstanceById(event.agent_id)) {
      return this.agentRepo.getInstanceById(event.agent_id);
    }
    const realName = event.profile || event.agent_id;
    if (!realName) return null;
    return this.provision({ displayName: realName, agentId: event.agent_id, source: 'hermes-event' });
  }
}

export default HermesAgentProvisioner;
