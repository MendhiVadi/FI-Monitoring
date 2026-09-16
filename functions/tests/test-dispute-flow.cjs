const assert = require('node:assert/strict');
const test = require('node:test');
const { createHmac } = require('node:crypto');
process.env.GCLOUD_PROJECT = 'demo-forestwatch';
process.env.DISPUTE_OTP_SECRET = 'test-secret-not-a-real-key';
const deployed = require('../lib/index.js');
const { validateDisputeInput } = require('../lib/features/disputes/service.js');
const { assertFreshSession } = require('../lib/features/tickets/authorization.js');
const { hasValidMetaSignature } = require('../lib/features/whatsapp/webhook.js');
const contract = require('../lib/platform/contracts/dispute.json');
const input = { reporterName: 'Synthetic reporter', reporterType: contract.reporterTypes[0], otherPartyName: 'Synthetic party', otherPartyType: contract.partyTypes[0], disputeType: contract.disputeTypes[0], state: 'Maharashtra', district: 'Pune', village: '', description: 'A synthetic boundary concern for testing only.', location: {latitude:18.52,longitude:73.85}, locationConfirmed:true };
test('deployment surface includes all original functions and the new registry/geocoder', () => {
  assert.deepEqual(Object.keys(deployed).sort(), ['requestDisputeOtp','verifyDisputeOtp','submitDispute','purgeExpiredOtps','whatsappWebhook','updateTicketStatus','addTicketNote','listTickets','notifyWhatsAppOnTicketUpdate','notifyWhatsAppOnTicketCreated','geocodePlace'].sort());
});
test('intake rejects unsupported enums, mismatched districts and overlong text', () => {
  for (const bad of [{reporterType:'Individual'}, {otherPartyType:'__proto__'}, {disputeType:'invented'}, {district:'Mandla'}, {state:'__proto__'}, {description:'x'}, {description:'x'.repeat(2001)}, {reporterName:'x'.repeat(121)}, {locationConfirmed:false}, {immediateRisk:'maybe'}, {evidenceReferences:Array(11).fill('ref')}, {evidenceReferences:['x'.repeat(121)]}]) assert.throws(() => validateDisputeInput({...input,...bad}));
  assert.equal(validateDisputeInput(input).immediateRisk,'unknown');
  assert.deepEqual(validateDisputeInput({...input,evidenceReferences:['  DEMO-001  ']}).evidenceReferences,['DEMO-001']);
});
test('coordinates must be finite numbers in the supported India extent', () => {
  for (const location of [undefined,{latitude:NaN,longitude:77},{latitude:'28',longitude:77},{latitude:0,longitude:0},{latitude:28,longitude:181},{latitude:Infinity,longitude:70}]) assert.throws(() => validateDisputeInput({...input,location}), /latitude and longitude/);
  assert.deepEqual(validateDisputeInput(input).location,input.location);
});
test('staff session age uses signed authentication time and rejects future or expired claims', () => {
  const now=1800000000000, fresh={uid:'test',token:{auth_time:now/1000-100}};
  assert.equal(assertFreshSession(fresh,now),fresh);
  for (const seconds of [undefined,NaN,0,now/1000+61,now/1000-28800]) assert.throws(() => assertFreshSession({uid:'test',token:{auth_time:seconds}},now),{code:'unauthenticated'});
  assert.throws(() => assertFreshSession(undefined,now),{code:'unauthenticated'});
});
test('webhook verifies the original bytes and fails closed for malformed signatures', () => {
  const body=Buffer.from('{"synthetic":true}'), secret='test-only';
  const signature='sha256='+createHmac('sha256',secret).update(body).digest('hex');
  assert.equal(hasValidMetaSignature(body,signature,secret),true);
  for (const bad of ['',signature+'x',signature.slice(1),undefined]) assert.equal(hasValidMetaSignature(body,bad,secret),false);
  assert.equal(hasValidMetaSignature(Buffer.from('{}'),signature,secret),false);
});
test('WhatsApp payload correlates receipts and puts OTP in body and copy button', async () => {
  const original=global.fetch; let payload;
  global.fetch=async (_url, options)=>{payload=JSON.parse(options.body);return {ok:true,json:async()=>({messages:[{id:'synthetic-message'}]})};};
  try {
    const {sendWhatsAppTemplate}=require('../lib/features/whatsapp/client.js');
    await sendWhatsAppTemplate('+12025550123','otp_code',['123789'],'test-sender','test-token','test-correlation');
    assert.equal(payload.template.components[0].parameters[0].text,'123789');
    assert.equal(payload.template.components[1].parameters[0].text,'123789');
    assert.equal(payload.biz_opaque_callback_data,'test-correlation');
    global.fetch=async()=>({ok:true,json:async()=>({})});
    await assert.rejects(sendWhatsAppTemplate('+12025550123','request_created',[],'test','test'),/could not be confirmed/);
  } finally {global.fetch=original;}
});
