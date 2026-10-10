import {useEffect,useRef,useState} from 'react';
import {api} from '@/lib/api';import {isPreviewMode} from '@/lib/previewFlag';import {useAuth} from '@/context/AuthContext';
import {makeInviteCommand,createIntentGuard} from '@/lib/clientInviteCommands';import {Button} from '@/components/ui/button';import {Switch} from '@/components/ui/switch';
export default function ClientInviteCard({client,onIntent=()=>{},onCurrent=()=>{}}){
 const {user}=useAuth();const namespace={environment:`${isPreviewMode?'preview':'live'}:${window.location.origin}:${api.defaults.baseURL}`,actorId:user?.profile?.id,clientId:client.id};
 const key=JSON.stringify(namespace),contextRef=useRef(key);contextRef.current=key;const guard=useRef(createIntentGuard());
 const [current,setCurrent]=useState(client),[known,setKnown]=useState(true),[desired,setDesired]=useState(client.invited||Boolean(client.auth_user_id)),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[confirmation,setConfirmation]=useState(null),[retry,setRetry]=useState(null);
 useEffect(()=>{guard.current.next(null);setCurrent(client);setKnown(true);setDesired(client.invited||Boolean(client.auth_user_id));setMessage('');setConfirmation(null);setRetry(null);setBusy(false);return()=>guard.current.next(null);},[key]);
 useEffect(()=>{if(!busy){setCurrent(client);setDesired(client.invited||Boolean(client.auth_user_id));}},[client]);
 const isCurrent=t=>guard.current.isCurrent(t)&&contextRef.current===JSON.stringify({environment:t.context.environment,actorId:t.context.actorId,clientId:t.context.clientId});
 const refresh=async token=>{const {data}=await api.get(`/clients/${client.id}`);if(!isCurrent(token))return null;
  if(data?.id!==client.id||typeof data.invited!=='boolean')throw Error('unverified');setCurrent(data);setDesired(data.invited||Boolean(data.auth_user_id));setKnown(true);onCurrent(data);return data;};
 const run=async command=>{const token=guard.current.next({...namespace,actionId:command.action_id});onIntent();setBusy(true);setKnown(false);setConfirmation(null);setRetry(command);setMessage('Checking invitation state…');
  if(command.kind!=='resend')setDesired(command.kind==='switch_on');
  try{const body={action_id:command.action_id,supersedes_attempt_id:command.supersedes_attempt_id,confirm_duplicate_risk:command.confirm_duplicate_risk};
   const response=command.kind==='resend'?await api.post(`/clients/${client.id}/invite/resend`,body):await api.patch(`/clients/${client.id}/invite`,{...body,invited:command.kind==='switch_on'});
   if(!isCurrent(token))return;const result=response.data?.action?.result;if(response.data?.action?.action_id!==command.action_id||!['selected','switched_off','already_claimed','ineligible','withdrawn','stale','needs_confirmation'].includes(result?.outcome))throw Error('unverified');const state=await refresh(token);if(!state||!isCurrent(token))return;
   setRetry(null);if(result?.outcome==='stale'||result?.outcome==='needs_confirmation'){setConfirmation({kind:command.kind,risk:result.outcome==='needs_confirmation'||state.invite?.needs_confirmation});setMessage(result.outcome==='needs_confirmation'?'The earlier email may have been accepted. A new send could produce a duplicate.':'Another invitation action changed the current attempt. Review the current state before continuing.');}
   else if(result?.outcome==='already_claimed')setMessage('This account is already claimed.');
   else if(['ineligible','withdrawn'].includes(result?.outcome))setMessage('This client is not eligible for that invitation action.');
   else setMessage('Invitation state refreshed.');
  }catch{if(isCurrent(token)){setKnown(false);setMessage('Current invitation state could not be verified. Retry this change or retry the state lookup.');}}
  finally{if(isCurrent(token))setBusy(false);}
 };
 const fresh=(kind,risk=false)=>run(makeInviteCommand({kind,supersedesAttemptId:current.invite?.attempt_id||null,confirmDuplicateRisk:risk}));
 const lookup=async()=>{const token=guard.current.next({...namespace,actionId:'lookup'});setBusy(true);try{await refresh(token);if(isCurrent(token))setMessage('Invitation state refreshed.');}catch{if(isCurrent(token)){setKnown(false);setMessage('Current invitation state could not be verified.');}}finally{if(isCurrent(token))setBusy(false);}};
 const labels={accepted:'Accepted for sending',unknown:'Email outcome unknown',failed:'Email rejected',pending:'Email pending',unconfigured:'Email is not configured'};
 return <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3" data-testid="client-invite-card">
  <div className="flex items-center justify-between gap-4"><div><p className="font-medium text-sm">App invite</p><p className="text-sm text-muted-foreground" data-testid="client-claim-permission">Can claim account: {known?(current.auth_user_id?'already claimed':current.invited?'yes':'no'):'unable to verify'}</p></div>
   <Switch checked={desired} disabled={Boolean(current.auth_user_id)||!current.email||current.archived} onCheckedChange={v=>fresh(v?'switch_on':'switch_off')} aria-label="App invite" data-testid="client-invite-switch"/>
  </div>
  <p className="text-sm text-muted-foreground" data-testid="client-invite-outcome">{known?(labels[current.invite?.status]||'No tracked email attempt'):'Email outcome: unable to verify'}</p>
  {known&&current.invite?.next_retry_at&&<p className="text-xs text-muted-foreground">Next retry: {new Date(current.invite.next_retry_at).toLocaleString()}</p>}
  <p className="text-xs text-muted-foreground">Turning off prevents later sends and account claims. An email already handed over may still be accepted.</p>
  {message&&<p role="status" className="text-sm text-muted-foreground">{message}</p>}
  {known&&current.invited&&!current.auth_user_id&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>fresh('resend')}>{current.invite?.retryable?'Retry invite email':'Send invite again'}</Button>}
  {confirmation&&<Button size="sm" disabled={busy} onClick={()=>fresh(confirmation.kind,confirmation.risk)} data-testid="confirm-client-invite">{confirmation.risk?'Confirm new send despite duplicate risk':'Continue with current attempt'}</Button>}
  {retry&&!busy&&<Button size="sm" variant="outline" onClick={()=>run(retry)}>Retry invitation change</Button>}
  {!known&&!busy&&<Button size="sm" variant="outline" onClick={lookup}>Retry state lookup</Button>}
 </div>;
}
