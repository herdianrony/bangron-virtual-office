import { generateId } from '../../utils/crypto.js';
import { parseEventTimestamp } from './event-timestamp.js';

// Peta normalisasi nama event. Mencakup tiga sumber nama:
// 1) Nama hook Gateway/klasik Hermes: agent:start, agent:step, agent:end,
//    pre_tool_call, post_tool_call, subagent:spawn, subagent:exit
// 2) Nama hook resmi Outbound Webhooks (plugin-hook set): on_session_start,
//    on_session_end, subagent_start, subagent_stop, pre_llm_call, ...
// 3) SSE events dari API Server (/v1/runs/{run_id}/events): message.delta, run.completed, run.failed, run.cancelled
// Referensi kontrak resmi:
// https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks
const TYPE_MAP = {
  'agent:start': 'agent.execution.started',
  'agent:step': 'agent.execution.step',
  'agent:end': 'agent.execution.ended',
  'pre_tool_call': 'agent.tool.started',
  'post_tool_call': 'agent.tool.completed',
  'subagent:spawn': 'agent.subagent.spawned',
  'subagent:exit': 'agent.subagent.exited',
  // Outbound Webhooks (plugin-hook set)
  'on_session_start': 'agent.execution.started',
  'on_session_end': 'agent.execution.ended',
  'on_session_finalize': 'agent.execution.ended',
  'subagent_start': 'agent.subagent.spawned',
  'subagent_stop': 'agent.subagent.exited',
  'pre_llm_call': 'agent.execution.step',
  // SSE events from API Server
  'message.delta': 'agent.execution.step',
  'run.completed': 'agent.execution.ended',
  'run.failed': 'agent.execution.failed',
  'run.cancelled': 'agent.execution.cancelled',
  'run.steered': 'agent.execution.steered',
  'approval.request': 'agent.approval.requested',
  'approval.response': 'agent.approval.resolved'
};

export function normalizeHermesEvent(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') {
    throw new Error('Event payload must be a non-null object');
  }

  // Wire format resmi Outbound Webhooks memakai "hook_event_name";
  // format internal/klasik memakai event_type/type/event.
  // SSE events dari API Server memakai field "event".
  const rawType = rawEvent.hook_event_name || rawEvent.event_type || rawEvent.type || rawEvent.event || rawEvent.event;
  if (!rawType) {
    throw new Error('Event missing hook_event_name/event_type identifier');
  }

  const eventType = TYPE_MAP[rawType] || rawType;
  // Outbound webhooks: ID unik per delivery bernama delivery_id (Hermes retry
  // sekali sehingga ID yang sama bisa datang dua kali — dipakai untuk dedupe).
  // SSE events: bisa pakai seq atau timestamp+run_id.
  // Normalize numeric IDs to strings to avoid SQLite type affinity issues (999 -> '999.0')
  let eventId = rawEvent.event_id || rawEvent.id || rawEvent.delivery_id || rawEvent.seq || generateId('evt');
  if (typeof eventId === 'number') {
    eventId = String(eventId);
  }
  // Timestamp resolution (S3 remediation — deterministic, never silently wrong):
  // - timestamp (native Hermes field) wins over occurred_at when both are present.
  //   This matches the validator's precedence so freshness validation and
  //   persisted timestamp are identical.
  // - Supported formats: unix seconds, unix milliseconds, ISO-8601 with zone
  //   (the native Hermes outbound-webhook format). See event-timestamp.js.
  // - Missing timestamp → ingest time (internal/demo/SSE paths; the /events
  //   webhook gate already requires a signed timestamp before normalization).
  // - Invalid timestamp → throw (controller answers 400 MALFORMED_EVENT).
  const rawTs =
    rawEvent.timestamp !== undefined && rawEvent.timestamp !== null && rawEvent.timestamp !== ''
      ? rawEvent.timestamp
      : rawEvent.occurred_at;
  let occurredAt;
  if (rawTs === undefined || rawTs === null || rawTs === '') {
    occurredAt = new Date().toISOString();
  } else {
    const tsMs = parseEventTimestamp(rawTs);
    if (tsMs === null) {
      throw new Error(`Invalid event timestamp: ${JSON.stringify(rawTs)}`);
    }
    occurredAt = new Date(tsMs).toISOString();
  }
  const source = rawEvent.source || 'hermes';

  const agentId = rawEvent.agent_id || rawEvent.agentId || rawEvent.profile_id || null;
  const instanceId = rawEvent.instance_id || rawEvent.instanceId || null;
  const sessionId = rawEvent.session_id || rawEvent.sessionId || rawEvent.run_id || null;
  const parentSessionId = rawEvent.parent_session_id || rawEvent.parentSessionId || null;
  const taskId = rawEvent.task_id || rawEvent.taskId || rawEvent.metadata?.bangron_task_id || null;
  const correlationId = rawEvent.correlation_id || rawEvent.correlationId || null;
  // Nama profil Hermes yang memancarkan event (di luar multiplexed profile = "default")
  const profile = rawEvent.profile || null;

  let payload;
  if (rawEvent.payload && typeof rawEvent.payload === 'object') {
    payload = { ...rawEvent.payload };
  } else if (rawEvent.data && typeof rawEvent.data === 'object') {
    payload = { ...rawEvent.data };
  } else {
    // Wire format resmi: field di top-level (tool_name, tool_input, session_id, ...)
    // plus metadata di objek "extra". Susun payload internal dari keduanya.
    payload = {};
    if (rawEvent.extra && typeof rawEvent.extra === 'object') {
      Object.assign(payload, rawEvent.extra);
    }
    if (rawEvent.tool_name) payload.tool_name = rawEvent.tool_name;
    if (rawEvent.tool_input !== undefined && rawEvent.tool_input !== null) {
      payload.tool_input = rawEvent.tool_input;
    } else if (rawEvent.args !== undefined && rawEvent.args !== null) {
      payload.tool_input = rawEvent.args;
    }
    if (rawEvent.iteration !== undefined) payload.iteration = rawEvent.iteration;
    if (rawEvent.tool_names) payload.tool_names = rawEvent.tool_names;
    if (rawEvent.message) payload.note = String(rawEvent.message).slice(0, 300);
    if (rawEvent.response) payload.summary = String(rawEvent.response).slice(0, 400);
    if (rawEvent.error) payload.error = rawEvent.error;
    // SSE message.delta events
    if (rawEvent.delta) payload.delta = rawEvent.delta;
    if (rawEvent.seq !== undefined) payload.seq = rawEvent.seq;
    if (rawEvent.output) payload.output = rawEvent.output;
    if (rawEvent.usage) payload.usage = rawEvent.usage;
    if (rawEvent.completed !== undefined) payload.completed = rawEvent.completed;
    if (rawEvent.failed !== undefined) payload.failed = rawEvent.failed;
    if (rawEvent.interrupted !== undefined) payload.interrupted = rawEvent.interrupted;
    if (rawEvent.turn_exit_reason) payload.turn_exit_reason = rawEvent.turn_exit_reason;
    if (rawEvent.runtime) payload.runtime = rawEvent.runtime;
  }
  // on_session_end membawa extra.completed (bukan success) — samakan semantiknya
  if (payload && payload.completed !== undefined && payload.success === undefined) {
    payload.success = payload.completed;
  }

  return {
    event_id: eventId,
    event_type: eventType,
    occurred_at: occurredAt,
    source,
    agent_id: agentId,
    instance_id: instanceId,
    session_id: sessionId,
    parent_session_id: parentSessionId,
    task_id: taskId,
    correlation_id: correlationId,
    profile,
    payload
  };
}

export default {
  normalizeHermesEvent
};
