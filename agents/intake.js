export async function run() {
  console.log('[STUB] intake.run called');
  return {
    party: [
      {
        name: 'Aria',
        class: 'Rogue',
        personality: 'sardonic, distrustful of authority',
        backstory_hook: 'fleeing a thieves guild in her home city',
        playstyle_notes: 'player prefers cunning over confrontation'
      },
      {
        name: 'Brom',
        class: 'Fighter',
        personality: 'loyal, straightforward, protective',
        backstory_hook: 'former city guard who left under unclear circumstances',
        playstyle_notes: 'player enjoys direct action and moral choices'
      }
    ],
    preferences: {
      tone: 'dark with moments of levity',
      primary_goal: 'uncover a political conspiracy',
      time_available: '3-4 hours',
      combat_ratio: 0.3,
      problem_solving_preference: 'investigation and social encounters',
      content_limits: ['no horror involving children']
    }
  };
}
