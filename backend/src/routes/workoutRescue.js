const express=require('express');
const {UUID,rescueErrorStatus}=require('../lib/workoutRescue');
const {logError}=require('../utils/logger');
function createWorkoutRescueRouter({db,auth}={}) {
 db ||= require('../supabase').supabaseAdmin;
 auth ||= require('../middleware/auth');
 const router=express.Router();router.use(auth.requireAuth);
 const route='/\:programId/days/\:dayId/rescue';
 function failure(res,error) {
  const status=rescueErrorStatus(error);
  if(status>=500) logError('workout rescue persistence error',error);
  return res.status(status).json({error:status===503?'Workout Rescue is unavailable until its database migration is applied.':status===500?'Could not load or save Workout Rescue. Try again.':error.message});
 }
 router.get(route,async(req,res)=>{
  const assignment=req.query.assignment_id??null;
  if(!UUID.test(req.params.programId)||!UUID.test(req.params.dayId)||(assignment!==null&&!UUID.test(assignment)))return res.status(400).json({error:'Invalid program or assignment'});
  try {
   const {data,error}=await db.rpc('read_workout_rescue',{p_program_id:req.params.programId,p_day_id:req.params.dayId,p_auth_id:req.user.authUserId,p_assignment_id:assignment});
   if(error)throw error;return res.json(data);
  }catch(error){return failure(res,error);}
 });
 router.put(route,auth.requireCoach,async(req,res)=>{
  if(!UUID.test(req.params.programId)||!UUID.test(req.params.dayId))return res.status(400).json({error:'Invalid program'});
  const body=req.body||{};
  if(typeof body.version!=='string'||!body.version||body.version.length>100||!Number.isSafeInteger(body.revision)||body.revision<0||!Array.isArray(body.branches)||body.branches.length>6)return res.status(400).json({error:'Invalid fallback options'});
  try {
   const {data,error}=await db.rpc('save_workout_rescue',{p_program_id:req.params.programId,p_day_id:req.params.dayId,p_auth_id:req.user.authUserId,p_version:body.version,p_revision:body.revision,p_branches:body.branches});
   if(error)throw error;return res.json(data);
  }catch(error){return failure(res,error);}
 });
 return router;
}
module.exports={createWorkoutRescueRouter};
