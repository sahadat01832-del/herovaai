// Unit tests for the single-speaker rule (owner steps in → AI steps back).
const svc = require('../src/services/wppConnectService');

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : (fail++, console.log(`  ✗ ${name}`)); };
const mkSession = () => ({ aiMutes: [], ownerMuteMinutes: 5 });

// 1. No mute on a fresh conversation → AI answers.
check('fresh chat: no active mute', svc.activeMute(mkSession(), '8801xxx').mute === null);

// 2. Owner reply arms a ~5 min mute; AI gate finds it.
{
  const s = mkSession();
  const m = svc.applyMute(s, '8801xxx@c.us', 'owner_reply');
  check('apply returns mute', Boolean(m) && m.reason === 'owner_reply');
  check('normalized to bare digits', m.customer === '8801xxx');
  const found = svc.activeMute(s, '8801xxx');
  check('gate sees the mute', Boolean(found.mute));
  const mins = (new Date(found.mute.until).getTime() - Date.now()) / 60000;
  check('window ≈ 5 min', mins > 4 && mins <= 5);
}

// 3. Mute is per-customer: owner chatting with A doesn't silence B.
{
  const s = mkSession();
  svc.applyMute(s, 'AAAA', 'owner_reply');
  check('A muted', Boolean(svc.activeMute(s, 'AAAA').mute));
  check('B NOT muted', svc.activeMute(s, 'BBBB').mute === null);
}

// 4. A second owner message re-arms (extends) the clock.
{
  const s = mkSession();
  const first = svc.applyMute(s, '8801xxx', 'owner_reply').until.getTime();
  // pretend 4 minutes passed by backdating the stored until
  s.aiMutes[0].until = new Date(first - 4 * 60 * 1000);
  const second = svc.applyMute(s, '8801xxx', 'owner_reply').until.getTime();
  check('re-arm extends past the (backdated) old expiry', second > first - 4 * 60 * 1000);
  const mins = (second - Date.now()) / 60000;
  check('re-armed ≈ 5 min from now', mins > 4 && mins <= 5);
}

// 5. Expiry → AI auto-resumes (gate finds nothing); expired rows pruned.
{
  const s = mkSession();
  svc.applyMute(s, '8801xxx', 'owner_reply');
  s.aiMutes[0].until = new Date(Date.now() - 1000); // expired 1s ago
  check('expired: gate clear', svc.activeMute(s, '8801xxx').mute === null);
  check('expired row pruned', s.aiMutes.length === 0);
}

// 6. Manual resume clears early.
{
  const s = mkSession();
  svc.applyMute(s, '8801xxx', 'manual');
  check('cleared', svc.clearMute(s, '8801xxx') === true);
  check('gate clear after resume', svc.activeMute(s, '8801xxx').mute === null);
}

// 7. Handoff intent detection (EN + Bengali + Romanized).
const hand = [
  'I want to talk to the real owner', 'connect me to a human please',
  'can I speak to the manager?', 'get me a live agent',
  'is the owner there?', 'anyone available?',
  'can i talk to a person?', 'owner ache?', 'owner ke din',
  'আসল মালিকের সাথে কথা বলতে চাই', 'ম্যানেজারকে ডাকুন', 'ফোন করুন',
  'মালিক আছে?', 'malik ache?', 'boss ke dao',
];
const noHand = [
  'what are your prices?', 'do you deliver to dhaka?',
  'this product is good, owner of this shop must be nice',
  'I am the owner, calling about stock',
  'the boss said the price is fixed',
  'hi', 'ok', 'thanks for the update',
  'মালিকানা সংক্রান্ত কাগজপত্র', // ownership paperwork — must NOT fire
];
hand.forEach(t => check(`handoff: ${JSON.stringify(t.slice(0, 40))}`, svc.wantsRealOwner(t) === true));
noHand.forEach(t => check(`no-handoff: ${JSON.stringify(t.slice(0, 40))}`, svc.wantsRealOwner(t) === false));

// 8. Normalization: wid and bare digits land on ONE row.
{
  const s = mkSession();
  svc.applyMute(s, '8801xxx@c.us');
  const row = s.aiMutes.length === 1 ? s.aiMutes[0] : null;
  check('wid normalized to bare digits', row && row.customer === '8801xxx');
  check('wid + digits land on the same row', row && Boolean(svc.activeMute(s, '8801xxx').mute));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
