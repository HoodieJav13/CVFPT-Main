import test from 'node:test';
import assert from 'node:assert/strict';
import { asksForLoad } from '../../src/lib/exerciseLoad.js';
test('unweighted movements omit load; preserve weighted and unknown variants', () => {
  for (const ex of [{exercise_name:"World’s Greatest Stretch"}, {equipment:'Body weight'}, {category:'Stretching'}, {exercise_name:'Hip stretch',equipment:'Strap'}, {exercise_name:'Plank'}, {exercise_name:'Push-up'}]) assert.equal(asksForLoad(ex), false);
  for (const ex of [{exercise_name:'Goblet squat'}, {exercise_name:'Weighted pull-up', equipment:'Bodyweight'}, {exercise_name:'Plank', prescribed_load_value:5}, {exercise_name:'Cable stretch', equipment:'Cable'}, {}, {equipment:'Dumbbells'}]) assert.equal(asksForLoad(ex), true);
});
