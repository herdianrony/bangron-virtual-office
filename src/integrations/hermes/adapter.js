import { hermesConfig } from '../../config/index.js';
import logger from '../../utils/logger.js';

export class HermesAdapter {
  constructor(config = hermesConfig) {
    this.config = config;
    this.baseUrl = config.apiUrl || 'http://localhost:8642';
    this.apiKey = config.apiKey;
    this._capabilities = null;
    this._capabilitiesAt = 0;
    this.CAPABILITIES_TTL_MS = 5 * 60 * 1000;
  }

  /**
   * Ambil (dan cache) fitur yang benar-benar didukung API Server. Control plane
   * tidak boleh menebak dukungan run/stop/SSE dari versi atau asumsi.
   */
  async getCapabilities() {
    const now = Date.now();
    if (this._capabilities && now - this._capabilitiesAt < this.CAPABILITIES_TTL_MS) {
      return this._capabilities;
    }
    const empty = { object: 'hermes.api_server.capabilities', features: {} };
    try {
      const response = await fetch(`${this.baseUrl}/v1/capabilities`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      });
      if (!response.ok) return empty;
      const data = await response.json();
      this._capabilities = data && data.features ? data : empty;
      this._capabilitiesAt = now;
      return this._capabilities;
    } catch (err) {
      logger.warn({ err }, 'Hermes capabilities probe failed; failing closed');
      return empty;
    }
  }

  supports(feature) {
    return !!(this._capabilities && this._capabilities.features && this._capabilities.features[feature]);
  }

  async getRuntimeStatus() {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Hermes API returned ${response.status}`);
      }
      
      const data = await response.json();
      
      return {
        connected: true,
        runtimeVerified: this.config.runtimeVerified,
        apiUrl: this.config.apiUrl,
        status: 'CONNECTED',
        message: 'Hermes Agent runtime is reachable and verified.',
        models: data.data
      };
    } catch (err) {
      logger.error({ err }, 'Hermes runtime status check failed');
      return {
        connected: false,
        runtimeVerified: false,
        apiUrl: this.config.apiUrl,
        status: 'RUNTIME_UNVERIFIED',
        message: `Hermes Agent runtime is not reachable: ${err.message}`
      };
    }
  }

  /**
   * Dispatch a task to Hermes via the API server.
   * Returns the run_id for tracking.
   */
  async dispatchTaskInstruction({ taskId, instruction, agentProfile, parameters = {} }) {
    if (!this.config.runtimeVerified) {
      logger.warn({ taskId, agentProfile: agentProfile?.slug }, 'Task dispatch skipped: Hermes runtime not verified');
      return {
        dispatched: false,
        runtimeAvailable: false,
        reason: 'HERMES_RUNTIME_UNVERIFIED',
        message: 'HERMES_RUNTIME_VERIFIED is not set to true'
      };
    }

    if (!this.apiKey) {
      logger.error({ taskId }, 'Hermes API key not configured');
      return {
        dispatched: false,
        runtimeAvailable: false,
        reason: 'HERMES_API_KEY_MISSING',
        message: 'HERMES_API_KEY is not configured'
      };
    }

    try {
      logger.info({ taskId, agentProfile: agentProfile?.slug }, 'Dispatching task to Hermes');
      
      const response = await fetch(`${this.baseUrl}/v1/runs`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `bangron-task-${taskId}`
        },
        body: JSON.stringify({
          input: instruction,
          model: 'hermes-agent',
          // Pass task context for correlation
          metadata: {
            bangron_task_id: taskId,
            agent_profile: agentProfile?.slug,
            agent_name: agentProfile?.name
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Hermes API returned ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const runId = data.run_id;
      
      logger.info({ taskId, runId, agentProfile: agentProfile?.slug }, 'Task dispatched to Hermes successfully');
      
      return {
        dispatched: true,
        runtimeAvailable: true,
        runId,
        message: 'Task dispatched to Hermes and accepted for execution'
      };
    } catch (err) {
      logger.error({ err, taskId }, 'Hermes API dispatch error');
      return {
        dispatched: false,
        runtimeAvailable: true,
        reason: 'HERMES_DISPATCH_ERROR',
        message: `Failed to dispatch task: ${err.message}`
      };
    }
  }

  /**
   * Get the status of a Hermes run.
   */
  async getRunStatus(runId) {
    try {
      const response = await fetch(`${this.baseUrl}/v1/runs/${runId}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Hermes API returned ${response.status}`);
      }
      
      return await response.json();
    } catch (err) {
      logger.error({ err, runId }, 'Failed to get Hermes run status');
      throw err;
    }
  }

  /**
   * Stop a running Hermes run.
   */
  async stopRun(runId) {
    try {
      const response = await fetch(`${this.baseUrl}/v1/runs/${runId}/stop`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Hermes API returned ${response.status}`);
      }
      
      return await response.json();
    } catch (err) {
      logger.error({ err, runId }, 'Failed to stop Hermes run');
      throw err;
    }
  }
}

export const hermesAdapter = new HermesAdapter();
export default hermesAdapter;