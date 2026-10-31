// Deliberately separate fictional example; no fabricated revisions for Sarah or
// any existing program. These literal snapshots are the comparison's source.
export function programHistoryFixtures(changedAt) {
  const initial={id:'program_history_example',name:'History example',description:'Fictional revision comparison',frequency_days:1,days:[{id:'history_day',day_number:1,notes:'Easy pace',workout:{id:'history_workout',name:'Strength day',exercises:[{id:'history_squat',name:'Goblet Squat',sets:'3',reps:'8',default_load_value:30,default_load_unit:'lb'},{id:'history_row',name:'Cable Row',sets:'2',reps:'10'}]}}]};
  const updated=structuredClone(initial);
  updated.days[0].notes='Steady progression';updated.days[0].workout.exercises[0].sets='4';
  updated.days[0].workout.exercises.reverse();
  return {program_history_example:[
    {id:'history_revision_1',snapshot:initial,author:null,recorded_at:null,source:'Fictional stored fixture · earlier metadata unavailable'},
    {id:'history_revision_2',snapshot:updated,author:{id:'coach_marcus',name:'Marcus Rivera'},recorded_at:changedAt,source:'Fictional stored fixture · coach program edit'},
  ]};
}
