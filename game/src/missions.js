// The story of Viceroy Bay: six missions for Dana Reyes, a courier who owes
// the wrong people money. Each mission is a list of stages; the world drives
// them, this file only describes them.
export const MISSIONS = [
  {
    id: 'm1',
    name: 'First Fare',
    brief: 'Rico needs a package across town. Get in a car and deliver it to the pier before the timer runs out.',
    reward: 250,
    intro: 'RICO: Dana! You owe the crew $4,000. Run this package to Sunset Pier and we call it even... for today.',
    stages: [
      { type: 'enterCar', text: 'Get in any car (walk close and press E)' },
      { type: 'goto', target: 'pier', radius: 90, time: 150, text: 'Deliver the package to Sunset Pier' },
    ],
  },
  {
    id: 'm2',
    name: 'Hot Wheels',
    brief: 'A client wants the coral Comet GT parked by Bayfront Mall. Steal it and bring it to your garage. The cops will notice.',
    reward: 400,
    intro: 'RICO: A buyer wants that coral Comet GT by the mall. Take it. Quietly... or not. Your call.',
    stages: [
      { type: 'stealCar', target: 'mall', text: 'Steal the coral Comet GT near Bayfront Mall' },
      { type: 'deliverCar', target: 'garage', radius: 110, time: 180, text: 'Bring the Comet GT to your garage' },
    ],
  },
  {
    id: 'm3',
    name: 'Getaway',
    brief: 'A job went loud. Drive Rico from VBPD Central to the park hideout while the police chase you. Lose them or outrun the timer.',
    reward: 600,
    intro: 'RICO: The job went loud! Pick me up by Central and drive like the whole city is watching. Because it is.',
    stages: [
      { type: 'goto', target: 'police', radius: 100, time: 120, text: 'Pick up Rico near VBPD Central' },
      { type: 'goto', target: 'park', radius: 110, time: 150, text: 'Lose the cops and reach Palm Court Park', wanted: 3 },
    ],
  },
  {
    id: 'm4',
    name: 'Street Justice',
    brief: 'The Harbor Boys are leaning on the diner. Go on foot, deal with four of them in the alley by Burger Barn, then walk away.',
    reward: 500,
    intro: 'MARA (diner owner): Those Harbor Boys want protection money. Dana, you are the only one they listen to. Fists or iron — your choice.',
    stages: [
      { type: 'combat', target: 'diner', count: 4, radius: 260, text: 'Deal with 4 Harbor Boys near Burger Barn' },
      { type: 'goto', target: 'garage', radius: 110, time: 120, text: 'Get back to your garage' },
    ],
  },
  {
    id: 'm5',
    name: 'Night Run',
    brief: 'Three rival drivers, five checkpoints, one winner. Beat the clock through the checkpoints in order.',
    reward: 700,
    intro: 'RICO: Street race tonight. Five gates, three rivals, winner takes $700. The Comet is yours for the night — do not scratch it.',
    stages: [
      { type: 'race', checkpoints: ['bank', 'hospital', 'pier', 'mall', 'garage'], time: 200, text: 'Race through the checkpoints in order' },
    ],
  },
  {
    id: 'm6',
    name: 'The Big Score',
    brief: 'The last job: hold the floor at Viceroy Trust Bank for 20 seconds while the alarm screams, then escape to the garage with five stars on you.',
    reward: 1500,
    intro: 'RICO: One last job and the debt is gone. Hold the bank floor for 20 seconds. Then run. Five stars, Dana. Make them count.',
    stages: [
      { type: 'goto', target: 'bank', radius: 120, time: 150, text: 'Reach Viceroy Trust Bank' },
      { type: 'hold', target: 'bank', radius: 150, hold: 20, text: 'Hold the bank floor — 20 seconds!' },
      { type: 'goto', target: 'garage', radius: 110, time: 180, text: 'Escape to your garage', wanted: 5 },
    ],
  },
];

export const DEBT_TOTAL = 4000;

// Cash the player earns outside missions (pickups, fares).
export const PICKUP_CASH = 50;
