const {test}=require('node:test');
const assert=require('node:assert/strict');
const {emailConfigured,sendEmail}=require('../lib/providers');

test('Brevo: mapping, provider acceptance, failures and configuration',async(t)=>{
 const keys=['CUTLY_EMAIL_PROVIDER','CUTLY_EMAIL_FROM','BREVO_API_KEY','CUTLY_EMAIL_TRANSPORT','CUTLY_EMAIL_REPLY_TO'];
 const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 t.after(()=>{for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}});
 Object.assign(process.env,{CUTLY_EMAIL_PROVIDER:'brevo',CUTLY_EMAIL_FROM:'CUTLY <sender@example.com>',BREVO_API_KEY:'test-only',CUTLY_EMAIL_TRANSPORT:'',CUTLY_EMAIL_REPLY_TO:''});
 assert.equal(emailConfigured(),true);
 const message={to:'recipient@example.com',subject:'Test',text:'Test message',html:'<p>Test</p>',idempotencyKey:'notification-unique'};
 const mock=t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.equal(url,'https://api.brevo.com/v3/smtp/email');
  assert.equal(options.headers['api-key'],'test-only');
  const body=JSON.parse(options.body);
  assert.deepEqual(body.sender,{name:'CUTLY',email:'sender@example.com'});
  assert.deepEqual(body.to,[{email:message.to}]);
  assert.equal(body.headers.IdempotencyKey,message.idempotencyKey);
  return new Response(JSON.stringify({messageId:'test-receipt'}),{status:201});
 });
 assert.deepEqual(await sendEmail(message),{provider:'brevo',id:'test-receipt',status:'ACCEPTED'});
 mock.mock.mockImplementation(async()=>new Response('{}',{status:201}));
 await assert.rejects(sendEmail(message),{code:'email_provider_invalid_response'});
 mock.mock.mockImplementation(async()=>new Response('{}',{status:401}));
 await assert.rejects(sendEmail(message),e=>e.configuration===true);
 mock.mock.mockImplementation(async()=>new Response('{}',{status:429}));
 await assert.rejects(sendEmail(message),e=>e.permanent===false);
 process.env.BREVO_API_KEY='';
 assert.equal(emailConfigured(),false);
 await assert.rejects(sendEmail(message),{code:'email_provider_not_configured'});
});
