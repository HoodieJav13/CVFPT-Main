import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from '@/lib/api';import {isPreviewMode} from '@/lib/previewFlag';import {useAuth} from '@/context/AuthContext';
import {pendingKey,writePending,listPending,clearPending,classifyRecovery} from '@/lib/clientCreateRecovery';
import {createIntentGuard} from '@/lib/clientInviteCommands';
import {Button} from '@/components/ui/button';import {Input} from '@/components/ui/input';import {Label} from '@/components/ui/label';import {Textarea} from '@/components/ui/textarea';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogFooter} from '@/components/ui/dialog';import {toast} from 'sonner';
const blank=()=>({name:'',email:'',phone:'',goals:'',health_notes:'',invite_now:false});
const warning='An earlier save may already have created a client. Discard only removes local recovery. Adding again can create a separate client with the same email.';
export default function ClientCreateDialog({onCreated}){
 const {user}=useAuth();const environment=`${isPreviewMode?'preview':'live'}:${window.location.origin}:${api.defaults.baseURL}`;
 const actorId=user?.profile?.id;const namespace={environment,actorId};const namespaceKey=JSON.stringify(namespace);
 const namespaceRef=useRef(namespaceKey);namespaceRef.current=namespaceKey;
 const guard=useRef(createIntentGuard());const contextRef=useRef(null);
 const [open,setOpen]=useState(false),[form,setForm]=useState(blank),[entries,setEntries]=useState([]),[busy,setBusy]=useState(false),[recovery,setRecovery]=useState(null),[message,setMessage]=useState(''),[durable,setDurable]=useState(true);
 const refreshEntries=useCallback(()=>setEntries(listPending({environment,actorId})),[environment,actorId]);
 useEffect(()=>{guard.current.next(null);contextRef.current=null;setOpen(false);setBusy(false);setForm(blank());setRecovery(null);setMessage('');setDurable(true);refreshEntries();
  const storage=e=>{if(contextRef.current&&e.key===pendingKey(contextRef.current)&&e.newValue===null){guard.current.next(null);contextRef.current=null;setOpen(false);setBusy(false);}if(!e.key||e.key.startsWith(pendingKey({environment,actorId,requestId:''}))){refreshEntries();}};
  window.addEventListener('storage',storage);return()=>{guard.current.next(null);window.removeEventListener('storage',storage);};
 },[namespaceKey,refreshEntries]);
 const isCurrent=(token)=>guard.current.isCurrent(token)&&namespaceRef.current===JSON.stringify({environment:token.context.environment,actorId:token.context.actorId})&&contextRef.current?.requestId===token.context.requestId;
 const start=()=>{if(!contextRef.current){contextRef.current={...namespace,requestId:crypto.randomUUID()};setForm(blank());setRecovery(null);setMessage('');setDurable(true);}setOpen(true);};
 const finish=(token,client,invite)=>{if(!isCurrent(token))return;clearPending(token.context);refreshEntries();guard.current.next(null);contextRef.current=null;setOpen(false);setForm(blank());setRecovery(null);setMessage('');setDurable(true);setBusy(false);toast.success(`${client.name||'Client'} added${invite?.status==='accepted'?' · Invite accepted for sending':''}`);onCreated();};
 const recover=async(entry)=>{
  contextRef.current=entry.context;const token=guard.current.next(entry.context);setOpen(true);setForm(blank());setRecovery('blocked');setBusy(true);setMessage('Checking the earlier save…');
  if(entry.corrupt){setBusy(false);setMessage("An earlier client save couldn't be read — check your client list before adding again");return;}
  try{const reply=classifyRecovery(await api.get(`/clients/create-requests/${entry.context.requestId}`));if(!isCurrent(token))return;
   if(reply.kind==='committed'){finish(token,reply.client,reply.invite);return;}
   setRecovery(reply.kind);setMessage(reply.kind==='absent'?'No saved client was found yet. Re-enter details to retry the same save. The earlier request may still finish.':'Recovery could not be verified. Retry lookup before re-entering details.');
  }catch{if(isCurrent(token)){setRecovery('blocked');setMessage('Recovery could not be verified. Retry lookup before re-entering details.');}}
  finally{if(isCurrent(token))setBusy(false);}
 };
 const discard=(context)=>{if(!window.confirm(warning))return;clearPending(context);if(contextRef.current?.requestId===context.requestId){guard.current.next(null);contextRef.current=null;setOpen(false);setForm(blank());setRecovery(null);setMessage('');setDurable(true);setBusy(false);}refreshEntries();};
 const submit=async e=>{e.preventDefault();if(recovery==='blocked'||!contextRef.current)return;const context={...contextRef.current};const token=guard.current.next(context);setBusy(true);setMessage('');
  const savedDurably=writePending(context,{state:'pending',created_at:new Date().toISOString()}).durable;refreshEntries();setDurable(savedDurably);
  try{const {data}=await api.post('/clients',{...form,request_id:context.requestId});if(isCurrent(token)&&classifyRecovery({status:200,data:{status:'committed',client:data?.client}}).kind==='committed')finish(token,data.client,data.invite);else if(isCurrent(token))setMessage('The save could not be confirmed. Retry this same save.');}
  catch(error){if(!isCurrent(token))return;if(error?.response?.data?.code==='request_mismatch'&&classifyRecovery({status:200,data:{status:'committed',client:error.response.data.client}}).kind==='committed'){finish(token,error.response.data.client,null);toast.info('The earlier save already created this client.');}else setMessage('The save could not be confirmed. Retry this same save or check the client list before discarding.');}
  finally{if(isCurrent(token))setBusy(false);}
 };
 return <div className="flex flex-wrap items-center gap-2">
  <Button className="rounded-xl" data-testid="add-client-button" onClick={start}>Add client</Button>
  {entries.map((entry,i)=><div key={entry.key} className="flex items-center gap-1"><Button size="sm" variant="outline" onClick={()=>recover(entry)} data-testid="recover-client-save">Recover pending save {i+1}</Button><Button size="sm" variant="ghost" onClick={()=>discard(entry.context)} aria-label={`Discard pending save ${i+1}`}>Discard</Button></div>)}
  <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-md" aria-describedby={undefined}><DialogHeader><DialogTitle>New client</DialogTitle></DialogHeader>
   {!durable&&<p role="status" className="text-sm text-muted-foreground" data-testid="client-save-durability-warning">Recovery after reload is unavailable. Keep this dialog open until the save is confirmed.</p>}
   {message&&<p role="status" className="text-sm text-muted-foreground" data-testid="client-save-message">{message}</p>}
   {recovery==='blocked'?<div className="space-y-3"><Button disabled={busy} onClick={()=>recover(entries.find(e=>e.context.requestId===contextRef.current?.requestId)||{context:contextRef.current,corrupt:false})}>Retry lookup</Button><Button variant="outline" onClick={()=>discard(contextRef.current)}>Discard pending save</Button></div>:<form onSubmit={submit} className="space-y-3.5">
    {['name','email','phone'].map(field=><div key={field} className="space-y-1.5"><Label htmlFor={`new-client-${field}`}>{field==='name'?'Full name *':field==='email'?'Email':'Phone'}</Label><Input id={`new-client-${field}`} type={field==='email'?'email':'text'} required={field==='name'||(field==='email'&&form.invite_now)} disabled={busy} value={form[field]} onChange={e=>setForm({...form,[field]:e.target.value})} data-testid={`client-${field}-input`}/></div>)}
    {['goals','health_notes'].map(field=><div key={field} className="space-y-1.5"><Label htmlFor={`new-client-${field}`}>{field==='goals'?'Goals':'Health notes'}</Label><Textarea id={`new-client-${field}`} rows={2} disabled={busy} value={form[field]} onChange={e=>setForm({...form,[field]:e.target.value})} data-testid={`client-${field}-input`}/></div>)}
    <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={form.invite_now} disabled={busy} onChange={e=>setForm({...form,invite_now:e.target.checked})} data-testid="client-send-invite-checkbox"/>Send app invite now</label>
    <DialogFooter><Button type="button" variant="outline" onClick={()=>setOpen(false)}>Cancel</Button><Button type="submit" disabled={busy} data-testid="client-save-button">{busy?'Saving…':'Add client'}</Button></DialogFooter>
   </form>}
  </DialogContent></Dialog>
 </div>;
}
