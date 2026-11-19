import appConfig from '../../config/app.js';
import databaseConfig from '../../config/database.js';
import securityConfig from '../../config/security.js';
import hermesConfig from '../../config/hermes.js';

export {
  appConfig,
  databaseConfig,
  securityConfig,
  hermesConfig
};

export default {
  app: appConfig,
  database: databaseConfig,
  security: securityConfig,
  hermes: hermesConfig
};
