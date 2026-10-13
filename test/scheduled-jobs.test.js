const {test}=require('node:test');
const assert=require('node:assert/strict');
const {authorizedJobRequest,dispatchScheduledNotifications}=require('../lib/scheduled-jobs');
test('scheduler rejects missing, short and incorrect credentials without accessing the database',async()=>{
 assert.equal(authorizedJobRequest(undefined,'a'.repeat(64)),false);
 assert.equal(authorizedJobRequest('Bearer short','short'),false);
 assert.equal(authorizedJobRequest('Bearer '+'b'.repeat(64),'a'.repeat(64)),false);
 assert.equal(authorizedJobRequest('Bearer '+'a'.repeat(64),'a'.repeat(64)),true);
 const result=await dispatchScheduledNotifications(new Proxy({},{get(){throw new Error('Unauthorized database access');}}),undefined);
 assert.equal(result.status,401);
});
