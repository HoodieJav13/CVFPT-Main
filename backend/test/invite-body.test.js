const test=require('node:test');const assert=require('node:assert/strict');
const path=require.resolve('../src/supabase');require.cache[path]={id:path,filename:path,loaded:true,exports:{supabaseAdmin:{}}};
const {renderInviteMessage}=require('../src/services/accountRecovery');
test('render export preserves ordinary escaped invite and excludes health data',()=>{
 const msg=renderInviteMessage({client:{email:'fictional+test@example.invalid',health_notes:'HEALTH_CANARY',goals:'GOAL_CANARY'},coachName:'Coach <Test>'},{FRONTEND_URL:'https://app.example.invalid'});
 assert.deepEqual(msg.to,['fictional+test@example.invalid']);assert.match(msg.text,/signup\?email=fictional%2Btest%40example.invalid/);
 assert.match(msg.html,/Coach &lt;Test&gt;/);assert.doesNotMatch(JSON.stringify(msg),/HEALTH_CANARY|GOAL_CANARY|token=/);
});
