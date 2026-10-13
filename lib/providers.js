const crypto=require('node:crypto');

class ProviderError extends Error{constructor(code,status=503){super(code);this.name='ProviderError';this.code=code;this.status=status;}}
function emailConfigured(){return Boolean(process.env.RESEND_API_KEY&&process.env.CUTLY_EMAIL_FROM);}
function smsConfigured(){return Boolean(process.env.TWILIO_ACCOUNT_SID&&process.env.TWILIO_AUTH_TOKEN&&(process.env.TWILIO_MESSAGING_SERVICE_SID||process.env.TWILIO_FROM));}
function providerStatus(){return {email:emailConfigured()?'CONFIGURED':'NOT_CONFIGURED',sms:smsConfigured()?'CONFIGURED':'NOT_CONFIGURED'};}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function sendEmail({to,subject,text,html,idempotencyKey}){
 if(!emailConfigured())throw new ProviderError('email_provider_not_configured');
 const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${process.env.RESEND_API_KEY}`,'content-type':'application/json','idempotency-key':idempotencyKey||crypto.randomUUID()},body:JSON.stringify({from:process.env.CUTLY_EMAIL_FROM,to:[to],subject,text,html}),signal:AbortSignal.timeout(10000)}).catch(()=>{throw new ProviderError('email_provider_unreachable',502);});
 if(!response.ok)throw new ProviderError(`email_provider_rejected_${response.status}`,502);
 const result=await response.json().catch(()=>null);if(!result?.id)throw new ProviderError('email_provider_invalid_response',502);return {provider:'resend',id:result.id,status:'ACCEPTED'};
}
async function sendSms({to,text}){
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
async function sendVerificationEmail({to,token,idempotencyKey,kind='verify-email'}){
 const url=new URL('/account.html',publicBaseUrl());url.searchParams.set(kind==='password-reset'?'resetPassword':'verifyEmail',token);
 const isReset=kind==='password-reset',subject=isReset?'Réinitialisez votre mot de passe CUTLY':'Vérifiez votre adresse e-mail CUTLY',action=isReset?'réinitialiser votre mot de passe':'vérifier votre adresse e-mail';
 const text=`Pour ${action}, ouvrez ce lien valable 30 minutes : ${url}`;
 return sendEmail({to,subject,text,html:`<p>Pour ${escapeHtml(action)}, <a href="${escapeHtml(url)}">ouvrez ce lien sécurisé</a>.</p><p>Ce lien expire dans 30 minutes et ne peut servir qu’une fois.</p>`,idempotencyKey});
}
async function sendPhoneCode({to,code}){return sendSms({to,text:`Votre code de vérification CUTLY est ${code}. Il expire dans 10 minutes.`});}
module.exports={ProviderError,emailConfigured,smsConfigured,providerStatus,sendEmail,sendSms,sendVerificationEmail,sendPhoneCode,publicBaseUrl};
