import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import logger from '../../utils/logger.js';
import { HermesAgentProvisioner } from './agent-provisioner.js';

/**
 * Sync daftar profil Hermes ke dalam control plane.
 *
 * Sumber kebenaran: direktori ~/.hermes/profiles/<nama>/ (profil yang benar-benar
 * ada di mesin). API Server tidak menyediakan /v1/agents atau /v1/profiles, jadi
 * direktori profil adalah inventaris yang paling akurat. Setiap profil yang
 * belum ada di office di-provision sebagai agent_profiles + agent_instances +
 * posisi kantor; provisioner menyiarkan `agent.created` lewat WebSocket.
 */
export class HermesProfileSync {
  constructor(db = null, options = {}) {
    this.db = db;
    this.provisioner = options.provisioner || new HermesAgentProvisioner(db);
    this.profilesDir = options.profilesDir
      || process.env.HERMES_PROFILES_DIR
      || path.join(os.homedir(), '.hermes', 'profiles');
  }

  listProfileNames() {
    try {
      return fs.readdirSync(this.profilesDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .filter((n) => !n.startsWith('.'))
        .sort();
    } catch (err) {
      logger.warn({ err, dir: this.profilesDir }, 'Cannot read Hermes profiles directory');
      return [];
    }
  }

  sync() {
    const names = this.listProfileNames();
    const result = { discovered: names.length, created: [], existing: [], failed: [] };
    for (const name of names) {
      try {
        const existing = this.provisioner.getInstanceByRealName(name);
        if (existing) {
          result.existing.push(name);
          continue;
        }
        const instance = this.provisioner.provision({
          displayName: name,
          agentId: null,
          source: 'hermes-profile-sync'
        });
        if (instance) result.created.push(name);
        else result.failed.push(name);
      } catch (err) {
        logger.warn({ err, name }, 'Failed to sync Hermes profile');
        result.failed.push(name);
      }
    }
    logger.info({ ...result, failed: result.failed.length }, 'Hermes profile sync completed');
    return result;
  }
}

export default HermesProfileSync;
