import { getDatabase } from '../../database/connection.js';
import { seedDemoData } from '../../database/seeds/demo_seed.js';
import { StateReconciler } from '../../integrations/hermes/state-reconciler.js';
import { VirtualOfficeService } from '../virtual-office/virtual-office.service.js';
import { eventPublisher } from '../../realtime/event-publisher.js';
import { sendSuccess, sendError } from '../../utils/response.js';
import { demoEngine } from './demo-engine.js';

let demoStepIndex = 0;

export class DemoController {
  constructor() {
    this.reconciler = new StateReconciler();
    this.officeService = new VirtualOfficeService();
  }

  getStatus = (req, res) => {
    return sendSuccess(res, {
      demoMode: true,
      currentStep: demoStepIndex,
      totalSteps: 5,
      description: 'Isolated simulated multi-agent digital studio pipeline',
      autoplay: demoEngine.getStatus()
    });
  };

  setAutoplay = (req, res) => {
    try {
      const enabled = !!(req.body && req.body.enabled);
      const status = demoEngine.setEnabled(enabled);
      eventPublisher.publish('demo.autoplay', { enabled, ...status });
      return sendSuccess(res, { enabled, ...status }, `Auto-play ${enabled ? 'started' : 'paused'}`);
    } catch (err) {
      return sendError(res, 'DEMO_AUTOPLAY_ERROR', err.message, [], 500);
    }
  };

  reset = (req, res) => {
    try {
      const db = getDatabase();
      demoStepIndex = 0;
      seedDemoData(db);
      eventPublisher.publish('demo.reset', { step: 0 });
      return sendSuccess(res, { step: 0 }, 'Demo data reset to initial state');
    } catch (err) {
      return sendError(res, 'DEMO_RESET_ERROR', err.message, [], 500);
    }
  };

  step = (req, res) => {
    try {
      demoStepIndex = (demoStepIndex + 1) % 6;
      let actionResult = {};

      switch (demoStepIndex) {
        case 1:
          // Step 1: Maya (UI/UX) walks to meeting room to collaborate with Hermes
          this.officeService.updateAgentPosition('inst_demo_uiux', {
            roomId: 'room_meeting',
            workstationId: 'ws_meeting_table',
            positionX: 130,
            positionY: 310,
            direction: 'NE'
          });
          actionResult = {
            step: 1,
            action: 'Maya walked to Conference Hub for cross-functional design review',
            agent: 'inst_demo_uiux',
            status: 'collaborating'
          };
          break;

        case 2:
          // Step 2: Alex (Backend) executes a tool event (write migration)
          this.reconciler.reconcile({
            event_id: `evt_demo_tool_${Date.now()}`,
            event_type: 'agent.tool.started',
            occurred_at: new Date().toISOString(),
            source: 'hermes_demo',
            instance_id: 'inst_demo_backend',
            task_id: 'task_demo_sub_backend',
            payload: {
              tool_name: 'apply_schema_migration',
              tool_input: { migration: '002_user_preferences' }
            }
          });
          actionResult = {
            step: 2,
            action: 'Alex started executing tool: apply_schema_migration',
            agent: 'inst_demo_backend',
            status: 'working'
          };
          break;

        case 3:
          // Step 3: Tool completes, but Alex continues working (verifying Rule: post_tool_call does not complete task)
          this.reconciler.reconcile({
            event_id: `evt_demo_tool_done_${Date.now()}`,
            event_type: 'agent.tool.completed',
            occurred_at: new Date().toISOString(),
            source: 'hermes_demo',
            instance_id: 'inst_demo_backend',
            task_id: 'task_demo_sub_backend',
            payload: {
              tool_name: 'apply_schema_migration',
              success: true
            }
          });
          actionResult = {
            step: 3,
            action: 'Alex completed migration tool; task remains running for verification',
            agent: 'inst_demo_backend',
            status: 'working'
          };
          break;

        case 4:
          // Step 4: Sarah (Frontend) finishes isometric visual engine task
          this.reconciler.reconcile({
            event_id: `evt_demo_fe_done_${Date.now()}`,
            event_type: 'agent.execution.ended',
            occurred_at: new Date().toISOString(),
            source: 'hermes_demo',
            instance_id: 'inst_demo_frontend',
            task_id: 'task_demo_sub_frontend',
            payload: {
              success: true,
              summary: '2.5D Isometric SVG Office renderer compiled and operational.'
            }
          });
          actionResult = {
            step: 4,
            action: 'Sarah completed task: SVG 2.5D Isometric Rendering Engine',
            agent: 'inst_demo_frontend',
            status: 'idle'
          };
          break;

        case 5:
          // Step 5: Marcus (QA) requests high-risk production deploy approval
          this.reconciler.reconcile({
            event_id: `evt_demo_qa_appr_${Date.now()}`,
            event_type: 'agent.tool.started',
            occurred_at: new Date().toISOString(),
            source: 'hermes_demo',
            instance_id: 'inst_demo_qa',
            task_id: 'task_demo_sub_qa',
            payload: {
              tool_name: 'deploy_production',
              action_type: 'deploy_production',
              description: 'Execute production container rollout v1.0.0'
            }
          });
          actionResult = {
            step: 5,
            action: 'Marcus intercepted by Policy Engine: Deploy to Production requires Director approval',
            agent: 'inst_demo_qa',
            status: 'waiting'
          };
          break;

        default:
          demoStepIndex = 0;
          actionResult = { step: 0, action: 'Cycle completed. Ready for next simulation run.' };
      }

      return sendSuccess(res, { step: demoStepIndex, ...actionResult });
    } catch (err) {
      return sendError(res, 'DEMO_STEP_ERROR', err.message, [], 500);
    }
  };
}

export const demoController = new DemoController();
export default demoController;
