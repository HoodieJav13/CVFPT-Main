// Mounted beneath workout-logs' requireAuth. The RPC repeats current actor and
// ownership checks inside its transaction; HTTP role checks aren't authority.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERDICTS=new Set(['pending','fixed','partial','nochange']);
function validRequest(body) {
 if(!body || typeof body!=='object' || Array.isArray(body) || !UUID.test(body.request_id||''))return false;
 const keys={create:['action','request_id','text','source_version'],edit:['action','request_id','text','source_version','cue_id','revision'],cancel:['action','request_id','cue_id','revision'],verdict:['action','request_id','cue_id','revision','verdict']}[body.action];
 if(!keys || Object.keys(body).some(k=>!keys.includes(k)))return false;
 if(['create','edit'].includes(body.action) && (typeof body.text!=='string' || !body.text.trim() || [...body.text.trim()].length>500 || !/^[a-f0-9]{32}$/.test(body.source_version||'')))return false;
 if(body.action!=='create' && (!UUID.test(body.cue_id||'') || !Number.isInteger(body.revision) || body.revision<1))return false;
 return body.action!=='verdict' || VERDICTS.has(body.verdict);
}
function cueErrorStatus(error){return ({P0400:400,P0403:403,P0404:404,P0409:409,'42P01':503,'42883':503,'PGRST202':503})[error?.code]||500;}
function registerCueRetryRoutes(router,{db}) {
 const path='/:id/exercises/:exerciseId/cue-retry';
 for(const method of ['get','post'])router[method](path,async(req,res)=>{
  if(method==='post' && !['coach','admin'].includes(req.user?.role))return res.status(403).json({error:'Coach access required'});
  if(!UUID.test(req.params.id)||!UUID.test(req.params.exerciseId) || (method==='post'&&!validRequest(req.body)))return res.status(400).json({error:'Invalid cue request'});
  try{
   const {data,error}=await db.rpc(method==='get'?'read_exercise_cues':'mutate_exercise_cue',{
    p_auth_user_id:req.user.authUserId,p_log_id:req.params.id,p_exercise_id:req.params.exerciseId,...(method==='post'?{p_request:req.body}:{})});
   if(error)throw error;return res.json(data);
  }catch(error){const status=cueErrorStatus(error);return res.status(status).json({error:status===503?'Coaching cues are currently unavailable.':status===500?'Could not save or load coaching cues. Try again.':error.message});}
 });
}
module.exports={registerCueRetryRoutes,validRequest,cueErrorStatus};
