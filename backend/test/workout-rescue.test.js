const test=require('node:test');const assert=require('node:assert/strict');
const { normalizeRescueStart, rescueErrorStatus }=require('../src/lib/workoutRescue');
const uuid='00000000-0000-4000-8000-000000000201';
const request={request_id:uuid,branch_id:'short',version:'rescue-v',revision:1,selection_version:'context',minutes:25,equipment:['dumbbells']};
test('Rescue start only forwards explicit choice/context, never prescriptions or actor fields',()=>{
 assert.deepEqual(normalizeRescueStart({...request,items:[{sets:99}],actor:'admin'}),request);
 for(const fields of [{request_id:'bad'},{revision:-1},{minutes:0},{minutes:'25'},{equipment:['unknown']},{selection_version:''},{branch_id:''}]) assert.throws(()=>normalizeRescueStart({...request,...fields}),/Invalid/);
});
test('Rescue errors fail closed; an unavailable migration never falls back to ordinary start',()=>{
 for(const [error,status] of [[{message:'Program not found'},404],[{message:'Coach access required'},403],[{message:'Original or options changed'},409],[{message:'No fallback fits'},409],[{message:'Invalid fallback'},400],[{code:'42883',message:'missing function'},503],[{message:'internal'},500]]) assert.equal(rescueErrorStatus(error),status);
});
