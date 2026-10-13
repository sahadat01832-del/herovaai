const assert = require('node:assert/strict');
const test = require('node:test');
const { promptBlock } = require('../src/services/memoryProfile');

const profile = {
  enabled: true,
  businessName: 'Mango House',
  ownerName: 'Amina',
  ownerRole: 'founder',
  businessType: 'Cafe',
  businessDescription: 'Tea and desserts',
  catalog: [{ name: 'Mango tea', price: '৳120', kind: 'product' }],
  operations: { openingHours: '10:00-20:00' },
  policies: 'Returns are accepted within seven days.',
  entries: [{ key: 'delivery range', value: 'Dhaka city' }],
  guardrails: 'Never promise a refund outside the stated policy.',
  escalationContact: '+880 1700 000000',
  tone: 'warm',
  replyLength: 'short',
  language: 'English',
  greeting: 'Welcome to Mango House',
  signoff: 'Thank you',
};

test('owner memory gives business context without customer-service refusal rules', () => {
  const prompt = promptBlock(profile, { audience: 'owner' });
  assert.match(prompt, /person you are chatting with IS the owner/);
  assert.match(prompt, /Answer ordinary questions/);
  assert.match(prompt, /Mango tea.*৳120/);
  assert.match(prompt, /Never promise a refund outside the stated policy/);
  assert.doesNotMatch(prompt, /confirm with the team/);
  assert.doesNotMatch(prompt, /take their name, phone number and request/);
  assert.doesNotMatch(prompt, /Escalate to a human via/);
  assert.doesNotMatch(prompt, /Open with:/);
  assert.doesNotMatch(prompt, /Close with:/);
  assert.doesNotMatch(prompt, /Reply length:/);
});

test('customer replies retain the strict verified-facts and escalation guidance', () => {
  const prompt = promptBlock(profile);
  assert.equal(promptBlock(profile, { audience: 'customer' }), prompt);
  assert.match(prompt, /Speak as the business/);
  assert.match(prompt, /answer only from the facts listed below/);
  assert.match(prompt, /confirm with the team rather than guessing/);
  assert.match(prompt, /take their name, phone number and request/);
  assert.match(prompt, /Escalate to a human via \+880 1700 000000/);
  assert.match(prompt, /Reply length: one or two sentences/);
  assert.match(prompt, /Open with: "Welcome to Mango House"/);
  assert.match(prompt, /Close with: "Thank you"/);
});

test('disabled or empty memory stays absent for either audience', () => {
  assert.equal(promptBlock(null, { audience: 'owner' }), '');
  assert.equal(promptBlock({ ...profile, enabled: false }, { audience: 'owner' }), '');
  assert.equal(promptBlock({ enabled: true }, { audience: 'owner' }), '');
});
