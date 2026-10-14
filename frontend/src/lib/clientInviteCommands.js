export function makeInviteCommand({kind,supersedesAttemptId=null,confirmDuplicateRisk=false},uuid=()=>crypto.randomUUID()){
 return Object.freeze({action_id:uuid(),kind,supersedes_attempt_id:supersedesAttemptId,confirm_duplicate_risk:confirmDuplicateRisk});
}
export function createIntentGuard(){let latest=null,sequence=0;return {
 next(context){latest=Object.freeze({context:context?Object.freeze({...context}):null,sequence:++sequence});return latest;},
 isCurrent(token){return token===latest&&token.context!==null;},
};}
