const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function normalizeRescueStart(input) {
 if(!input || Array.isArray(input) || !UUID.test(input.request_id||'') || typeof input.branch_id!=='string' || !input.branch_id.trim() || input.branch_id.length>80
  || typeof input.version!=='string' || !input.version || input.version.length>100 || typeof input.selection_version!=='string' || !input.selection_version || input.selection_version.length>100
  || !Number.isSafeInteger(input.revision) || input.revision<0 || !Number.isInteger(input.minutes) || input.minutes<1 || input.minutes>120
  || !Array.isArray(input.equipment) || input.equipment.length>2 || input.equipment.some(x=>!['dumbbells','cable'].includes(x))) throw Object.assign(Error('Invalid fallback choice. Reload and review your options.'),{status:400});
 return {request_id:input.request_id.toLowerCase(),branch_id:input.branch_id,version:input.version,revision:input.revision,selection_version:input.selection_version,minutes:input.minutes,equipment:[...new Set(input.equipment)].sort()};
}
function rescueErrorStatus(error) {
 if(error.status) return error.status;
 if(['42883','42P01','PGRST202','PGRST205'].includes(error.code)) return 503;
 if(/not found/i.test(error.message)) return 404;
 if(/coach access required/i.test(error.message)) return 403;
 if(/changed|no .*fallback|no fallback|fits|not active/i.test(error.message)) return 409;
 if(/invalid|keep at least|required|estimate must/i.test(error.message)) return 400;
 return 500;
}
module.exports={UUID,normalizeRescueStart,rescueErrorStatus};
