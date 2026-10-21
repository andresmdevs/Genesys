/**
 * Champion barrel. Importing this module registers every champion, so any
 * consumer that needs the roster only has to import from here.
 */

import './korvath.ts';
import './mordrax.ts';
import './vael.ts';
import './nyx.ts';
import './ysolde.ts';
import './pyrrhen.ts';
import './ryka.ts';
import './thessa.ts';
import './lumen.ts';
import './grommar.ts';

export { CHAMPIONS, championsByRole, getChampion, registerChampion } from './registry.ts';
