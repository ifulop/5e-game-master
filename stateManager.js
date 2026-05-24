// Phase 1 stub — full implementation in Phase 2
// Method signatures established here so the orchestrator and routing tests can reference them.

export class StateManager {
  constructor(campaignDir = 'campaign') {
    this._dir = campaignDir;
  }

  applyObjectChanges(changes) {
    console.log('[STUB] stateManager.applyObjectChanges called', changes);
  }

  applyAttitudeChanges(changes) {
    console.log('[STUB] stateManager.applyAttitudeChanges called', changes);
  }

  applyReconciliationBundle(updates) {
    console.log('[STUB] stateManager.applyReconciliationBundle called');
  }
}
