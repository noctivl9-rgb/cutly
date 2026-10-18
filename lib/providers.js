const crypto=require('node:crypto');

class ProviderError extends Error{constructor(code,status=503,{permanent=false,configuration=false}={}){super(code);this.name='ProviderError';this.code=code;this.status=status;this.permanent=permanent;this.configuration=configuration;}}
// Transport de test : écrit les e-mails dans un fichier au lieu de les envoyer. Jamais actif en production ni sur Netlify.
function fileTransport(){return process.env.CUTLY_EMAIL_TRANSPORT==='file'&&process.env.NODE_ENV!=='production'&&process.env.NETLIFY!=='true';}
function emailProvider(){return process.env.CUTLY_EMAIL_PROVIDER||'resend';}
function emailConfigured(){return fileTransport()||Boolean(process.env.CUTLY_EMAIL_FROM&&(emailProvider()==='brevo'?process.env.BREVO_API_KEY:emailProvider()==='resend'&&process.env.RESEND_API_KEY));}
function smsConfigured(){return Boolean(process.env.TWILIO_ACCOUNT_SID&&process.env.TWILIO_AUTH_TOKEN&&(process.env.TWILIO_MESSAGING_SERVICE_SID||process.env.TWILIO_FROM));}
function providerStatus(){return {email:emailConfigured()?(fileTransport()?'TEST_TRANSPORT':'CONFIGURED'):'NOT_CONFIGURED',sms:smsConfigured()?'CONFIGURED':'NOT_CONFIGURED'};}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
// Classe une réponse du fournisseur : réessayer (temporaire), abandonner (adresse refusée) ou attendre la configuration (clé / domaine).
// Le message du fournisseur (sans secret : jamais la clé) est conservé pour le diagnostic de l'administrateur.
function classifyEmailFailure(status,body){
 const message=String(body?.message||body?.error||'');
 const detail=error=>{error.providerStatus=status;error.providerMessage=message.replace(/s+/g,' ').slice(0,240);return error;};
 if(status===401||status===403||(status===400&&/api key/i.test(message))||/domain.*not.*verified|only send testing emails|sender.*(not valid|invalid|not verified|not validated)|unauthorized|key not found/i.test(message))return detail(new ProviderError('email_provider_configuration_rejected',502,{configuration:true}));
 if(status===408||status===429||status>=500)return detail(new ProviderError(`email_provider_unavailable_${status}`,502));
 return detail(new ProviderError(`email_provider_rejected_${status}`,502,{permanent:true}));
}
async function sendEmail({to,subject,text,html,idempotencyKey,tags}){
 if(fileTransport()){
  const file=process.env.CUTLY_EMAIL_OUTBOX_FILE||require('node:path').join(__dirname,'..','data','email-outbox.jsonl');
  const id=`file-${crypto.randomUUID()}`;require('node:fs').mkdirSync(require('node:path').dirname(file),{recursive:true});
  require('node:fs').appendFileSync(file,JSON.stringify({id,at:new Date().toISOString(),to,subject,text,html,tags,idempotencyKey})+'\n');
  return {provider:'file-test',id,status:'ACCEPTED'};
 }
 if(!emailConfigured())throw new ProviderError('email_provider_not_configured');
 if(emailProvider()==='brevo'){
  const raw=process.env.CUTLY_EMAIL_FROM.trim(),match=raw.match(/^([^<>]+)<([^<>]+)>$/);
  const sender=match?{name:match[1].trim(),email:match[2].trim()}:{name:'CUTLY',email:raw};
  if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(sender.email))throw new ProviderError('email_sender_invalid',503,{configuration:true});
  const payload={sender,to:[{email:to}],subject,textContent:text,htmlContent:html,headers:{IdempotencyKey:idempotencyKey||crypto.randomUUID()}};
  if(process.env.CUTLY_EMAIL_REPLY_TO)payload.replyTo={email:process.env.CUTLY_EMAIL_REPLY_TO};
  const response=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':process.env.BREVO_API_KEY,'content-type':'application/json',accept:'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)}).catch(()=>{throw new ProviderError('email_provider_unreachable',502);});
  const result=await response.json().catch(()=>null);
  if(!response.ok)throw classifyEmailFailure(response.status,result);
  if(typeof result?.messageId!=='string'||!result.messageId)throw new ProviderError('email_provider_invalid_response',502);
  return {provider:'brevo',id:result.messageId,status:'ACCEPTED'};
 }
 const payload={from:process.env.CUTLY_EMAIL_FROM,to:[to],subject,text,html};
 if(process.env.CUTLY_EMAIL_REPLY_TO)payload.reply_to=process.env.CUTLY_EMAIL_REPLY_TO;
 if(Array.isArray(tags)&&tags.length)payload.tags=tags.map(tag=>({name:String(tag.name).replace(/[^A-Za-z0-9_-]/g,'_').slice(0,256),value:String(tag.value).replace(/[^A-Za-z0-9_-]/g,'_').slice(0,256)}));
 const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${process.env.RESEND_API_KEY}`,'content-type':'application/json','idempotency-key':idempotencyKey||crypto.randomUUID()},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)}).catch(()=>{throw new ProviderError('email_provider_unreachable',502);});
 if(!response.ok)throw classifyEmailFailure(response.status,await response.json().catch(()=>null));
 const result=await response.json().catch(()=>null);if(!result?.id)throw new ProviderError('email_provider_invalid_response',502);return {provider:'resend',id:result.id,status:'ACCEPTED'};
}
async function sendSms({to,text}){
 if(!require('./verification-policy').smsEnabled)throw new ProviderError('sms_disabled');
 if(!smsConfigured())throw new ProviderError('sms_provider_not_configured');
 const account=process.env.TWILIO_ACCOUNT_SID;if(!/^AC[\da-f]{32}$/i.test(account))throw new ProviderError('sms_provider_invalid_configuration');
 if(!/^\+[1-9]\d{7,14}$/.test(String(to)))throw new ProviderError('sms_invalid_destination',400);
 const authorization=Buffer.from(`${account}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'),body=new URLSearchParams({To:to,Body:text});
 if(process.env.TWILIO_MESSAGING_SERVICE_SID)body.set('MessagingServiceSid',process.env.TWILIO_MESSAGING_SERVICE_SID);else body.set('From',process.env.TWILIO_FROM);
 const response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages.json`,{method:'POST',headers:{authorization:`Basic ${authorization}`,'content-type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(10000)}).catch(()=>{throw new ProviderError('sms_provider_outcome_unknown',502);});
 if(!response.ok)throw new ProviderError(`sms_provider_rejected_${response.status}`,502);
 const result=await response.json().catch(()=>null);if(!result?.sid)throw new ProviderError('sms_provider_invalid_response',502);return {provider:'twilio',id:result.sid,status:result.status||'ACCEPTED'};
}
function publicBaseUrl(){const raw=process.env.CUTLY_PUBLIC_BASE_URL;if(!raw)throw new ProviderError('public_base_url_not_configured');let url;try{url=new URL(raw);}catch{throw new ProviderError('public_base_url_invalid');}if(process.env.NODE_ENV==='production'&&url.protocol!=='https:')throw new ProviderError('public_base_url_https_required');if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new ProviderError('public_base_url_invalid');return url.origin;}
async function sendPhoneCode({to,code}){return sendSms({to,text:`Code CUTLY : ${code}. Valable 10 minutes. Ne partagez pas ce code.`});}
module.exports={ProviderError,emailConfigured,smsConfigured,providerStatus,sendEmail,sendSms,sendPhoneCode,publicBaseUrl,fileTransport,classifyEmailFailure,escapeHtml};
