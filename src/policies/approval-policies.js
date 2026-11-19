export const SENSITIVE_ACTIONS = {
  DEPLOY_PRODUCTION: {
    type: 'deploy_production',
    riskLevel: 'critical',
    description: 'Deploy code changes to production server'
  },
  DATABASE_DESTRUCTIVE: {
    type: 'database_destructive',
    riskLevel: 'critical',
    description: 'Execute drop, truncate, or bulk deletion on database'
  },
  EXTERNAL_PUBLICATION: {
    type: 'external_publication',
    riskLevel: 'high',
    description: 'Publish public facing material or social media posts'
  },
  EXTERNAL_COMMUNICATION: {
    type: 'external_communication',
    riskLevel: 'medium',
    description: 'Send external client emails or notifications'
  },
  SECURITY_CONFIG_CHANGE: {
    type: 'security_config_change',
    riskLevel: 'high',
    description: 'Modify system security policy or credentials'
  },
  GRANT_PERMISSIONS: {
    type: 'grant_permissions',
    riskLevel: 'high',
    description: 'Escalate agent privileges or tool authorization'
  }
};

export function isActionSensitive(actionType) {
  const normalized = (actionType || '').toLowerCase();
  const exact = Object.values(SENSITIVE_ACTIONS).find(
    (action) => action.type === normalized
  );
  if (exact) return exact;

  // Heuristik nama tool/aksi nyata (wire format resmi Hermes hanya mengirim
  // tool_name, bukan action_type). Contoh: "deploy_app" -> deploy_production.
  const KEYWORD_HINTS = [
    { re: /deploy|release|ship[_-]?prod|produksi/, action: 'deploy_production' },
    { re: /drop|truncate|purge|wipe|bulk[_-]?delete/, action: 'database_destructive' },
    { re: /publish|tweet|instagram|linkedin|facebook|social[_-]?post/, action: 'external_publication' },
    { re: /email|broadcast|send[_-]?client|newsletter/, action: 'external_communication' },
    { re: /credential|secret|password|api[_-]?key|firewall|security[_-]?config/, action: 'security_config_change' },
    { re: /grant|escalate|sudo|chmod[_-]?root|authorize/, action: 'grant_permissions' }
  ];
  const hint = KEYWORD_HINTS.find((h) => h.re.test(normalized));
  if (hint) {
    const match = Object.values(SENSITIVE_ACTIONS).find((action) => action.type === hint.action);
    if (match) {
      return { ...match, description: `${match.description} (terdeteksi dari nama aksi/tool: "${actionType}")` };
    }
  }
  return null;
}
