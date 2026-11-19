export class Store {
  constructor() {
    this.state = {
      user: null,
      csrfToken: null,
      rooms: [],
      workstations: [],
      agents: new Map(), // agentId -> agent data
      tasks: [],
      approvals: [],
      activities: [],
      selectedAgentId: null,
      followAgentId: null,
      simulationSpeed: 1, // 1x, 2x, 4x
      runtimeStatus: { connected: false, text: 'Disconnected' },
      wsConnected: false
    };

    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(eventKey = 'all', payload = null) {
    for (const listener of this.listeners) {
      try {
        listener(eventKey, payload, this.state);
      } catch (err) {
        console.error('Store listener error:', err);
      }
    }
  }

  setState(partial) {
    Object.assign(this.state, partial);
    this.notify('state_updated');
  }

  updateAgent(agentId, updates) {
    const current = this.state.agents.get(agentId) || {};
    this.state.agents.set(agentId, { ...current, ...updates });
    this.notify('agent_updated', { agentId, updates });
  }

  getAgent(agentId) {
    return this.state.agents.get(agentId);
  }

  getAllAgents() {
    return Array.from(this.state.agents.values());
  }

  setAgents(agentsList) {
    this.state.agents.clear();
    for (const a of agentsList) {
      this.state.agents.set(a.id, a);
    }
    this.notify('agents_loaded');
  }

  addActivity(activity) {
    this.state.activities.unshift(activity);
    if (this.state.activities.length > 50) {
      this.state.activities.pop();
    }
    this.notify('activity_added', activity);
  }
}

export const store = new Store();
export default store;
