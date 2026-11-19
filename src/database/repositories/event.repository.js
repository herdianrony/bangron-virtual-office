export class EventRepository {
  constructor(db) {
    this.db = db;
  }

  findByEventId(eventId) {
    return this.db.prepare('SELECT * FROM agent_events WHERE event_id = ?').get(eventId);
  }

  getRecentEvents(limit = 50, filters = {}) {
    let query = 'SELECT * FROM agent_events WHERE 1=1';
    const params = [];

    if (filters.eventType) {
      query += ' AND event_type = ?';
      params.push(filters.eventType);
    }
    if (filters.taskId) {
      query += ' AND task_id = ?';
      params.push(filters.taskId);
    }
    if (filters.instanceId) {
      query += ' AND instance_id = ?';
      params.push(filters.instanceId);
    }

    query += ' ORDER BY occurred_at DESC LIMIT ?';
    params.push(limit);

    return this.db.prepare(query).all(...params);
  }

  /**
   * Records incoming event.
   * Returns { event, isDuplicate: boolean }
   */
  recordEvent({
    eventId,
    eventType,
    source = 'hermes',
    agentId = null,
    instanceId = null,
    sessionId = null,
    parentSessionId = null,
    taskId = null,
    correlationId = null,
    payload = {},
    occurredAt = null
  }) {
    const existing = this.findByEventId(eventId);
    if (existing) {
      return { event: existing, isDuplicate: true };
    }

    const now = new Date().toISOString();
    const eventTime = occurredAt || now;
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);

    this.db.prepare(`
      INSERT INTO agent_events (
        event_id, event_type, source, agent_id, instance_id,
        session_id, parent_session_id, task_id, correlation_id,
        payload_json, occurred_at, processing_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?)
    `).run(
      eventId,
      eventType,
      source,
      agentId,
      instanceId,
      sessionId,
      parentSessionId,
      taskId,
      correlationId,
      payloadStr,
      eventTime,
      now
    );

    const saved = this.findByEventId(eventId);
    return { event: saved, isDuplicate: false };
  }

  markProcessed(eventId, status = 'processed') {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE agent_events SET processing_status = ?, processed_at = ? WHERE event_id = ?').run(status, now, eventId);
  }
}

export default EventRepository;
