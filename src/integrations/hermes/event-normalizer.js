import { generateId } from '../../utils/crypto.js';

// Peta normalisasi nama event. Mencakup dua sumber nama:
// 1) Nama hook Gateway/klasik Hermes: agent:start, agent:step, agent:end,
//    pre_tool_call, post_tool_call, subagent:spawn, subagent:exit
// 2) Nama hook resmi Outbound Webhooks (plugin-hook set): on_session_start,
//    on_session_end, subagent_start, subagent_stop, pre_llm_call, ...
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
  'pre_llm_call': 'agent.execution.step'
};

export function normalizeHermesEvent(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') {
    throw new Error('Event payload must be a non-null object');
  }

  // Wire format resmi Outbound Webhooks memakai "hook_event_name";
  // format internal/klasik memakai event_type/type/event.
  const rawType = rawEvent.hook_event_name || rawEvent.event_type || rawEvent.type || rawEvent.event;
  if (!rawType) {
    throw new Error('Event missing hook_event_name/event_type identifier');
  }

  const eventType = TYPE_MAP[rawType] || rawType;
  // Outbound webhooks: ID unik per delivery bernama delivery_id (Hermes retry
  // sekali sehingga ID yang sama bisa datang dua kali — dipakai untuk dedupe).
  const eventId = rawEvent.event_id || rawEvent.id || rawEvent.delivery_id || generateId('evt');
  const occurredAt = rawEvent.occurred_at || rawEvent.timestamp || new Date().toISOString();
  const source = rawEvent.source || 'hermes';

  const agentId = rawEvent.agent_id || rawEvent.agentId || rawEvent.profile_id || null;
  const instanceId = rawEvent.instance_id || rawEvent.instanceId || null;
  const sessionId = rawEvent.session_id || rawEvent.sessionId || null;
  const parentSessionId = rawEvent.parent_session_id || rawEvent.parentSessionId || null;
  const taskId = rawEvent.task_id || rawEvent.taskId || null;
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
