export async function openScene() {
  console.log('[STUB] narrator.openScene called');
  return 'The scene opens before you. Torchlight flickers against damp stone walls. What do you do?';
}

export async function continueTurn(playerInput) {
  console.log('[STUB] narrator.continueTurn called');
  return 'The story continues. The world responds to your actions. What do you do next?';
}

export async function closeEncounter(resolverResult) {
  console.log('[STUB] narrator.closeEncounter called');
  return 'The encounter draws to a close. The dust settles around you.';
}

export async function closeCampaign() {
  console.log('[STUB] narrator.closeCampaign called');
  return 'Your adventure comes to an end. The tale of your deeds will be told for years to come.';
}
