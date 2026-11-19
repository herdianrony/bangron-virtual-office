import { getDatabase } from '../../database/connection.js';
import { ActivityRepository } from '../../database/repositories/activity.repository.js';
import { sendSuccess, sendError } from '../../utils/response.js';

export class ActivityController {
  constructor(db = null) {
    this.db = db || getDatabase();
    this.activityRepo = new ActivityRepository(this.db);
  }

  getAll = (req, res) => {
    try {
      const limit = parseInt(req.query.limit || '50', 10);
      const activities = this.activityRepo.getRecentActivities(limit, {
        agentInstanceId: req.query.agentInstanceId,
        taskId: req.query.taskId
      });
      return sendSuccess(res, activities);
    } catch (err) {
      return sendError(res, 'ACTIVITIES_FETCH_ERROR', err.message, [], 500);
    }
  };
}

export const activityController = new ActivityController();
export default activityController;
