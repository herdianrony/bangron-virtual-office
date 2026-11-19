import { hermesConfig } from '../../config/index.js';
import logger from '../../utils/logger.js';

export class HermesAdapter {
  constructor(config = hermesConfig) {
    this.config = config;
  }

  async getRuntimeStatus() {
    // In this environment, hermes CLI/server is not installed, verified as:
    // RUNTIME_UNAVAILABLE (MOCK / ADAPTER READY)
    return {
      connected: false,
      runtimeVerified: this.config.runtimeVerified,
      apiUrl: this.config.apiUrl,
      status: 'RUNTIME_UNAVAILABLE (ADAPTER READY)',
      message: 'Hermes Agent runtime is not reachable in current container environment. Webhook and Adapter layers are active and test-verified.'
    };
  }

  async dispatchTaskInstruction({ taskId, instruction, agentProfile, parameters = {} }) {
    logger.info({ taskId, agentProfile: agentProfile.slug }, 'Dispatching task instruction via Hermes Adapter');

    // If live API is configured and reachable
    if (this.config.runtimeVerified && this.config.apiUrl) {
      try {
        const response = await fetch(`${this.config.apiUrl}/v1/agent/dispatch`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`
          },
          body: JSON.stringify({
            taskId,
            instruction,
            profile: agentProfile,
            parameters
          })
        });

        if (!response.ok) {
          throw new Error(`Hermes API returned HTTP ${response.status}`);
        }

        return await response.json();
      } catch (err) {
        logger.error({ err, taskId }, 'Hermes API dispatch error');
        throw err;
      }
    }

    // Mock / Standalone execution acknowledgment when runtime is not verified
    return {
      dispatched: false,
      runtimeAvailable: false,
      message: 'Task created in Bangron Virtual Office. Simulated or demo execution can proceed.'
    };
  }
}

export const hermesAdapter = new HermesAdapter();
export default hermesAdapter;
