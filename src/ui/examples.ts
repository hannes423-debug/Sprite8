import hockeyUrl from '../../assets/examples/hockey-player.png';
import robotUrl from '../../assets/examples/robot.png';
import type { ExampleHints } from '../app/actions/project';

export interface Example {
  id: string;
  label: string;
  url: string;
  fileName: string;
  hints: ExampleHints;
}

/** Bundled example characters (assets/examples, CC0). */
export const EXAMPLES: Example[] = [
  {
    id: 'hockey',
    label: 'Hockey player (asymmetric)',
    url: hockeyUrl,
    fileName: 'hockey-player.png',
    hints: {
      name: 'hockey_player',
      symmetry: 'asymmetric',
      sourceDirection: 'S',
      description: 'ice hockey player in a red jersey with white stripes, dark helmet and pants, brown gloves, holding a wooden hockey stick, right-handed shot',
      features: [
        { name: 'Hockey stick', category: 'equipment', side: 'right', attachment: 'hand', notes: 'Blade on the ice on the right side of the body (right-handed shot).' },
        { name: 'Gloves', category: 'clothing', side: 'both', attachment: 'hand', notes: '' },
      ],
    },
  },
  {
    id: 'robot',
    label: 'Robot (symmetric)',
    url: robotUrl,
    fileName: 'robot.png',
    hints: {
      name: 'robot',
      symmetry: 'symmetric',
      sourceDirection: 'S',
      description: 'small round-headed robot with a teal visor, grey armour plates, orange chest light and antenna',
      features: [{ name: 'Antenna', category: 'accessory', side: 'center', attachment: 'head', notes: '' }],
    },
  },
];
