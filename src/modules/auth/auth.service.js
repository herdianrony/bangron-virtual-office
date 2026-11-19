import { getDatabase } from '../../database/connection.js';
import { UserRepository } from '../../database/repositories/user.repository.js';
import { AuditRepository } from '../../database/repositories/audit.repository.js';
import { comparePassword } from '../../utils/crypto.js';

export class AuthService {
  constructor(db = null) {
    this.db = db || getDatabase();
    this.userRepo = new UserRepository(this.db);
    this.auditRepo = new AuditRepository(this.db);
  }

  async login(identifier, password, clientMeta = {}) {
    const user = this.userRepo.findByEmailOrName(identifier);
    if (!user) {
      throw new Error('Invalid email, username, or password');
    }

    if (!user.is_active) {
      throw new Error('User account is deactivated');
    }

    const isValid = await comparePassword(password, user.password_hash);
    if (!isValid) {
      this.auditRepo.log({
        actorType: 'user',
        actorId: identifier,
        action: 'auth.login.failed',
        resourceType: 'user',
        resourceId: String(user.id),
        ipAddress: clientMeta.ip,
        userAgent: clientMeta.userAgent
      });
      throw new Error('Invalid email, username, or password');
    }

    this.userRepo.updateLastLogin(user.id);

    this.auditRepo.log({
      userId: user.id,
      actorType: 'user',
      actorId: String(user.id),
      action: 'auth.login.success',
      resourceType: 'user',
      resourceId: String(user.id),
      ipAddress: clientMeta.ip,
      userAgent: clientMeta.userAgent
    });

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    };
  }
}

export default AuthService;
