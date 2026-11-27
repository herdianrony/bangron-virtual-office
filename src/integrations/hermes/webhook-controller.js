import { validateHermesSignature, validateHermesEvent } from './signature-validator.js';
import { normalizeHermesEvent } from './event-normalizer.js';
import { StateReconciler } from './state-reconciler.js';
import { HermesAgentProvisioner } from './agent-provisioner.js';
import { hermesAdapter } from './adapter.js';
import { getDatabase } from '../../database/connection.js';
import { EventRepository } from '../../database/repositories/event.repository.js';
import { sendSuccess, sendError } from '../../utils/response.js';
import logger from '../../utils/logger.js';

export class HermesWebhookController {
  constructor() {
    this.reconciler = new StateReconciler();
    this.provisioner = new HermesAgentProvisioner(getDatabase());
    this.eventRepo = new EventRepository(getDatabase());
  }

  handleWebhook = (req, res) => {
    // 1. Signature + replay protection (stable ID + signed-body timestamp).
    //    Freshness is bound to the HMAC-signed content, not an unsigned header.
    const sigCheck = validateHermesEvent(req);
    if (!sigCheck.valid) {
      return sendError(res, sigCheck.reason, 'Webhook signature verification failed', [], 401);
    }

    // 2. Event Normalization
    let normalizedEvent;
    try {
      normalizedEvent = normalizeHermesEvent(req.body);
    } catch (err) {
      logger.warn({ err }, 'Failed to normalize Hermes event');
      return sendError(res, 'MALFORMED_EVENT', err.message, [], 400);
    }

    // 3. Reconcile State
    try {
      const result = this.reconciler.reconcile(normalizedEvent);
      // Replayed delivery of an already-processed event: reject explicitly.
      // 409 is a 4xx, so Hermes outbound delivery treats it as final (no retry).
      if (result.status === 'ignored') {
        return sendError(res, 'DUPLICATE_EVENT', 'Event already processed; duplicate delivery rejected', [], 409);
      }
      return sendSuccess(res, {
        event_id: normalizedEvent.event_id,
        event_type: normalizedEvent.event_type,
        reconciled_status: result.status
      }, 'Hermes event ingested and reconciled successfully.');
    } catch (err) {
      logger.error({ err }, 'Hermes event reconciliation error');
      return sendError(res, 'RECONCILIATION_ERROR', err.message, [], 500);
    }
  };

  /**
   * Registrasi agen dengan nama asli Hermes SEBELUM event nyata datang.
   * Body: { "agents": [{ "name": "...", "department": "..." }] } atau { "name": "..." }.
   * Idempoten: nama yang sudah terdaftar dikembalikan tanpa duplikasi.
   */
  registerAgents = (req, res) => {
    const sigCheck = validateHermesSignature(req);
    if (!sigCheck.valid) {
      return sendError(res, sigCheck.reason, 'Webhook signature verification failed', [], 401);
    }

    const body = req.body || {};
    const list = Array.isArray(body.agents)
      ? body.agents
      : (body.name ? [body] : null);

    if (!list || list.length === 0) {
      return sendError(res, 'MALFORMED_REQUEST', 'Provide { "agents": [{ "name": "..." }] } or { "name": "..." }', [], 400);
    }
    if (list.length > 50) {
      return sendError(res, 'TOO_MANY_AGENTS', 'Maximum 50 agents per registration call', [], 400);
    }

    const results = [];
    for (const item of list) {
      const name = item && typeof item === 'object' ? String(item.name || '').trim() : '';
      if (!name) {
        results.push({ name: null, ok: false, reason: 'MISSING_NAME' });
        continue;
      }
      const existing = this.provisioner.getInstanceByRealName(name);
      const instance = existing || this.provisioner.provision({
        displayName: name,
        department: item.department || null,
        source: 'hermes-registration'
      });
      results.push({
        name,
        ok: Boolean(instance),
        agent_instance_id: instance ? instance.id : null,
        room: instance ? instance.room_name : null,
        workstation: instance ? instance.workstation_name : null,
        already_registered: Boolean(existing)
      });
    }

    return sendSuccess(res, { registered: results }, 'Hermes agent registration processed.');
  };

  getStatus = async (req, res) => {
    try {
      const [runtimeStatus, capabilities, modelOptions, health, sessions, jobs, recentEvents] = await Promise.all([
        hermesAdapter.getRuntimeStatus(),
        hermesAdapter.getCapabilities(),
        hermesAdapter.getModelOptions(),
        hermesAdapter.getHealthDetailed(),
        hermesAdapter.listSessions({ limit: 8 }),
        hermesAdapter.listJobs(),
        Promise.resolve(this.eventRepo.getRecentEvents(10))
      ]);

      return sendSuccess(res, {
        runtime: runtimeStatus,
        capabilities: {
          object: capabilities.object || 'hermes.api_server.capabilities',
          features: capabilities.features || {},
          endpoints: capabilities.endpoints || []
        },
        models: (modelOptions.providers || []).flatMap((p) => (p.models || []).map((id) => ({ id, provider: p.slug }))),
        currentModel: modelOptions.model || null,
        health: { status: health.status, readiness: health.readiness?.status || 'unknown' },
        sessions: { total: sessions.data?.length || 0, recent: (sessions.data || []).slice(0, 5) },
        jobs: jobs.jobs || [],
        recentEvents
      });
    } catch (err) {
      return sendError(res, 'STATUS_CHECK_ERROR', err.message, [], 500);
    }
  };

  // Jobs API — director-only control over Hermes scheduled work
  listJobs = async (req, res) => {
    try { return sendSuccess(res, await hermesAdapter.listJobs()); }
    catch (err) { return sendError(res, 'JOBS_FETCH_ERROR', err.message, [], 500); }
  };

  createJob = async (req, res) => {
    try { return sendSuccess(res, await hermesAdapter.createJob(req.body), 'Job created', null, 201); }
    catch (err) { return sendError(res, 'JOB_CREATE_ERROR', err.message, [], 500); }
  };

  controlJob = async (req, res) => {
    try { return sendSuccess(res, await hermesAdapter.controlJob(req.params.id, req.params.action), 'Job updated'); }
    catch (err) { return sendError(res, 'JOB_CONTROL_ERROR', err.message, [], 400); }
  };

  deleteJob = async (req, res) => {
    try { return sendSuccess(res, await hermesAdapter.deleteJob(req.params.id), 'Job deleted'); }
    catch (err) { return sendError(res, 'JOB_DELETE_ERROR', err.message, [], 500); }
  };
}

export const hermesWebhookController = new HermesWebhookController();
export default hermesWebhookController;
