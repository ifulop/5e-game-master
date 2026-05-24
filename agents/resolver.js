export async function evaluate(params) {
  console.log('[STUB] resolver.evaluate called');
  return {
    encounter_id: 'enc_001',
    turn: params.accumulated_inputs?.length ?? 0,
    revelation_triggers: [],
    resolution_triggered: null,
    object_state_changes: [],
    npc_attitude_changes: [],
    encounter_continues: true,
    requires_narrative_update: false,
    notes: 'stub response'
  };
}
