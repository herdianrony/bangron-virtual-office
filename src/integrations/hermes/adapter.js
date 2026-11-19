import { hermesConfig } from '../../config/index.js';
import logger from '../../utils/logger.js';

export class HermesAdapter {
  constructor(config = hermesConfig) {
    this.config = config;
  }

  async getRuntimeStatus() {
    return {
      connected: false,
      runtimeVerified: false,
      apiUrl: this.config.apiUrl || null,
      status: 'RUNTIME_UNVERIFIED',
      message: 'No supported Hermes runtime transport has been configured and verified. Webhook ingestion is a separate capability.'
    };
  }

  async dispatchTaskInstruction({ taskId, agentProfile }) {
    logger.warn(
      { taskId, agentProfile: agentProfile?.slug },
      'Task dispatch skipped: Hermes runtime transport is not verified'
    );

    return {
      dispatched: false,
      runtimeAvailable: false,
      reason: 'HERMES_RUNTIME_UNVERIFIED',
      message: 'Task is stored in Bangron Virtual Office, but no live Hermes execution was started.'
    };
  }
}

export const hermesAdapter = new HermesAdapter();
export default hermesAdapter;
