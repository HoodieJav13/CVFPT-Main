// Minimal, detached snapshot of the existing authorized WholeWeek read.
// Names, notes, effort, check-ins and health data are intentionally not retained.
import { ACTIVITY_TYPES, addDays, isCalendarDate, mondayOf } from './outsideActivities.js';
const keys=(value,expected)=>value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).sort().join('|')===expected.sort().join('|');
const count=value=>Number.isSafeInteger(value)&&value>=0;
const text=(value,max)=>typeof value==='string'&&value.length>0&&Array.from(value).length<=max;
export function validReviewContext(c,scope) {
  if(!keys(c,['caseId','caseLabel','weekStart','pt_status','pt_completed_count','outside_activities','outside_partial','activity_collection']))return false;
  if(c.caseId!==scope.caseId||c.weekStart!==scope.weekStart||c.caseLabel!=='Client'||!isCalendarDate(c.weekStart)||mondayOf(c.weekStart)!==c.weekStart)return false;
  if(!['available','unavailable'].includes(c.pt_status)||(c.pt_status==='available'?!count(c.pt_completed_count):c.pt_completed_count!==null))return false;
  if(typeof c.outside_partial!=='boolean'||!['on','default_off','coach_off','client_opted_out'].includes(c.activity_collection))return false;
  if(!Array.isArray(c.outside_activities)||c.outside_activities.length>100)return false;
  return c.outside_activities.every(row=>keys(row,['id','occurred_on','activity_type','label','duration_seconds'])&&text(row.id,200)&&isCalendarDate(row.occurred_on)&&row.occurred_on>=c.weekStart&&row.occurred_on<=addDays(c.weekStart,6)&&ACTIVITY_TYPES.includes(row.activity_type)&&(row.label===null||text(row.label,80))&&(row.duration_seconds===null||(count(row.duration_seconds)&&row.duration_seconds>0&&row.duration_seconds<=86400)))
    &&new Set(c.outside_activities.map(row=>row.id)).size===c.outside_activities.length;
}
export function contextFromWeek(data,{clientId,weekStart}) {
  if(data?.contract!==1||data.client_id!==clientId||data.week_start!==weekStart||!['coach','admin'].includes(data.viewer_role)||!Array.isArray(data.activities))throw new Error('This client week could not be verified.');
  if (!Object.hasOwn(data, 'next_cursor') || typeof data.truncated !== 'boolean'
    || (data.next_cursor !== null && !keys(data.next_cursor, ['id','client_id','week_start','occurred_on']))
    || data.truncated !== (data.next_cursor !== null)) throw new Error('This week has unverified pagination.');
  const cursor = data.next_cursor;
  if (cursor && (!text(cursor.id,200) || cursor.client_id !== clientId || cursor.week_start !== weekStart
    || !isCalendarDate(cursor.occurred_on) || cursor.occurred_on < weekStart || cursor.occurred_on > addDays(weekStart,6))) throw new Error('This week has an invalid page cursor.');
  const c={caseId:clientId,caseLabel:'Client',weekStart,pt_status:data.pt_workouts?.status,pt_completed_count:data.pt_workouts?.status==='available'?data.pt_workouts.completed_count:null,activity_collection:data.preferences?.activity_collection,outside_partial:data.truncated,outside_activities:data.activities.map(row=>({id:row.id,occurred_on:row.occurred_on,activity_type:row.activity_type,label:row.label,duration_seconds:row.duration_seconds}))};
  if(!validReviewContext(c,{caseId:clientId,weekStart}))throw new Error('This client week has an unsupported format.');
  return c;
}
