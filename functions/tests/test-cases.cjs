const assert = require('node:assert/strict');
const test = require('node:test');
process.env.GCLOUD_PROJECT = 'demo-forestwatch';
process.env.DISPUTE_OTP_SECRET = 'test-secret-not-a-real-key';
const admin = require('firebase-admin');
const masking = require('../lib/features/cases/masking.js');
const targets = require('../lib/features/cases/targets.js');
const { toMillis } = require('../lib/features/cases/time.js');
const buckets = require('../lib/features/insights/buckets.js');
const insights = require('../lib/features/insights/service.js');
const access = require('../lib/features/tickets/access.js');
const contract = require('../lib/platform/contracts/dispute.json');
const DAY = 86_400_000, now = 1_800_000_000_000;
// Synthetic people and numbers only.
const NAMES = ['Asha Rani Rao', 'Vikram Singh'];
const ticket = {
  status: 'investigating', statusLabel: 'Under Investigation', waFrom: '+919876543210', reporterUid: 'phone-synthetic',
  subject: 'Ownership dispute — Asha Rani Rao vs Vikram Singh',
  dispute: { reporterName: 'Asha Rani Rao', otherPartyName: 'Vikram Singh', reporterType: contract.reporterTypes[0], otherPartyType: contract.partyTypes[0],
    disputeType: contract.disputeTypes[1], state: 'Maharashtra', district: 'Pune', village: 'Synthetic village',
    description: 'Vikram fenced our plot. Call me on 98765 43210 or asha.rao@example.com; Aadhaar 2345 6789 0124, PAN ABCDE1234F. Survey no. 123/4, 2026-10-29.',
    location: { latitude: 18.520431, longitude: 73.856743 }, immediateRisk: 'yes' },
  createdAt: { seconds: 1_799_000_000, nanoseconds: 0 }, updatedAt: { seconds: 1_799_500_000, nanoseconds: 0 },
  assignedTo: 'officer-uid-1', assignedEmail: 'officer@example.gov.in', assignedName: 'Officer One', assignedAt: now,
  overdue: 'resolve', documents: { caseType: 'person_vs_person', count: 2, kinds: ['aadhaar', 'sale_deed'], flagged: 1 },
};
const leaks = (value) => {
  const text = JSON.stringify(value);
  return ['Asha', 'Vikram', 'Rani', '9876543210', '98765 43210', 'asha.rao@example.com', '2345 6789 0124', 'ABCDE1234F', 'officer@example.gov.in', 'officer-uid-1', 'phone-synthetic',
    'Officer One', 'Officer Two', 'two@example.gov.in', 'officer-uid-2']
    .filter(secret => text.includes(secret));
};

test('names become initials and phones keep only the last four digits', () => {
  assert.equal(masking.initials('Asha Rani Rao'), 'A. R. R.');
  assert.equal(masking.initials('  vikram   singh '), 'V. S.');
  for (const empty of ['', '   ', undefined, null, 42]) assert.equal(masking.initials(empty), '');
  assert.equal(masking.maskPhone('+919876543210'), '+91•••••3210');
  assert.equal(masking.maskPhone('+12025550123'), '+•••••0123');
  for (const bad of [undefined, null, '', '12', 919876543210]) assert.equal(masking.maskPhone(bad), null);
});

test('free text loses contact details, ID numbers and party names but keeps ordinary detail', () => {
  const out = masking.redactText(ticket.dispute.description, NAMES);
  assert.equal(out, 'V. fenced our plot. Call me on ••• or •••; Aadhaar •••, PAN •••. Survey no. 123/4, 2026-10-29.');
  assert.equal(masking.redactText('Called +91 98765-43210 twice', []), 'Called ••• twice');
  // Short name parts are not replaced on their own, so common words survive.
  assert.equal(masking.redactText('Al Bo met Al at the site', ['Al Bo']), 'A. B. met Al at the site');
  for (const bad of [undefined, null, 7]) assert.equal(masking.redactText(bad, NAMES), '');
});

test('Indic-script names mask by word, vowel signs included', () => {
  assert.equal(masking.initials('राम कुमार'), 'र. क.');
  assert.equal(masking.initials('முருகன் செல்வம்'), 'ம. ச.');
  assert.equal(masking.redactText('राम कुमार ने जमीन ली', ['राम कुमार']), 'र. क. ने जमीन ली');
  assert.equal(masking.redactText('कुमार ने जमीन ली', ['राम कुमार']), 'क. ने जमीन ली');
});

test('a viewer subject is rebuilt from its parts, so a name cut at 160 characters cannot leak', () => {
  const dispute = { disputeType: 'Compensation or rehabilitation dispute', reporterName: 'Revenue Village Survey Inspectorate', otherPartyName: 'Thiruvenkatachalapathy Padmanabhan' };
  const subject = (dispute.disputeType + ' — ' + 'x'.repeat(100) + ' vs ' + dispute.otherPartyName).slice(0, 160);
  const expected = 'Compensation or rehabilitation dispute — R. V. S. I. vs T. P.';
  assert.equal(masking.maskedTicket('t1', { subject, dispute }).subject, expected);
  assert.equal(masking.maskedListTicket({ subject, dispute }).subject, expected);
  // Legacy tickets without the parts still get the redacted stored subject.
  assert.equal(masking.maskedListTicket({ subject: 'Boundary — Asha Rao vs Ravi Kumar', dispute: {} }).subject, 'Boundary — Asha Rao vs Ravi Kumar');
});

test('locations are rounded to two decimals and invalid points are dropped', () => {
  assert.deepEqual(masking.roundLocation(ticket.dispute.location), { latitude: 18.52, longitude: 73.86 });
  for (const bad of [null, undefined, {}, { latitude: '18.5', longitude: 73 }, { latitude: NaN, longitude: 73 }, { latitude: 18, longitude: Infinity }]) {
    assert.equal(masking.roundLocation(bad), null);
  }
});

test('the masked case keeps the spec fields and leaks no personal data', () => {
  const out = masking.maskedTicket('t1', ticket);
  assert.deepEqual(Object.keys(out).sort(), ['assigned', 'assignedName', 'createdAt', 'dispute', 'documents', 'id', 'otherPartyName', 'overdue', 'phone',
    'reporterName', 'status', 'statusLabel', 'subject', 'updatedAt'].sort());
  assert.deepEqual(Object.keys(out.dispute).sort(), ['description', 'disputeType', 'district', 'immediateRisk', 'location', 'otherPartyType',
    'reporterType', 'state', 'village'].sort());
  assert.equal(out.reporterName, 'A. R. R.');
  assert.equal(out.otherPartyName, 'V. S.');
  assert.equal(out.phone, '+91•••••3210');
  assert.equal(out.subject, 'Ownership dispute — A. R. R. vs V. S.');
  assert.deepEqual(out.dispute.location, { latitude: 18.52, longitude: 73.86 });
  assert.equal(out.createdAt, 1_799_000_000_000);
  assert.equal(out.overdue, 'resolve');
  assert.equal(out.statusLabel, 'Under Investigation');
  // Staff names are initials too; `assigned` covers an assignee without a name.
  assert.equal(out.assignedName, 'O. O.');
  assert.equal(out.assigned, true);
  assert.deepEqual(leaks(out), []);
  // Missing pieces degrade to empty values rather than throwing.
  const bare = masking.maskedTicket('t2', { status: 'open' });
  assert.equal(bare.phone, null);
  assert.equal(bare.dispute.immediateRisk, 'unknown');
  assert.equal(bare.documents, null);
  assert.equal(bare.overdue, null);
  assert.equal(bare.assignedName, null);
  assert.equal(bare.assigned, false);
  assert.equal(masking.maskedTicket('t3', { status: 'open', assignedTo: 'officer-uid-2', assignedName: null }).assigned, true);
});

test('a viewer registry row drops staff identifiers and masks names, phone and subject', () => {
  const row = masking.maskedListTicket({ ...ticket, id: 't1', lastUpdatedBy: 'officer-uid-1', revision: 3, ackDueAt: now, openDocumentRequests: 1 });
  for (const key of ['assignedTo', 'assignedEmail', 'lastUpdatedBy', 'notificationPhone']) assert.equal(key in row, false, key);
  assert.equal(row.waFrom, '+91•••••3210');
  assert.equal(row.dispute.reporterName, 'A. R. R.');
  assert.equal(row.dispute.otherPartyName, 'V. S.');
  assert.deepEqual(row.dispute.location, { latitude: 18.52, longitude: 73.86 });
  assert.equal(row.assignedName, 'O. O.');
  assert.equal(row.assigned, true);
  // Workflow fields the registry needs pass through unchanged.
  assert.equal(row.revision, 3);
  assert.equal(row.ackDueAt, now);
  assert.equal(row.openDocumentRequests, 1);
  assert.deepEqual(leaks(row), []);
  const legacy = masking.maskedListTicket({ id: 't3', status: 'open' });
  assert.equal(legacy.waFrom, '');
  // Older projections without assignment fields stay without them.
  assert.equal('assigned' in legacy || 'assignedName' in legacy, false);
  const unassigned = masking.maskedListTicket({ id: 't4', status: 'open', assignedTo: null, assignedName: null });
  assert.equal(unassigned.assigned, false);
  assert.equal(unassigned.assignedName, null);
});

test('history entries show staff by role only and redact free text', () => {
  const stamp = { officerUid: 'officer-uid-1', officerEmail: 'officer@example.gov.in', officerName: 'Officer One', officerRole: 'DFO' };
  const status = masking.maskedEvent('e1', { kind: 'status', before: 'open', after: 'investigating', reason: 'Met Asha Rani Rao, phone 9876543210',
    ...stamp, at: { seconds: 1_799_600_000, nanoseconds: 0 }, revision: 2 }, NAMES);
  assert.deepEqual(status, { id: 'e1', kind: 'status', before: 'open', after: 'investigating', revision: 2, reason: 'Met A. R. R., phone •••',
    actor: 'DFO', at: 1_799_600_000_000 });
  const assignment = masking.maskedEvent('e2', { type: 'assignment', from: null, to: 'officer-uid-2', toEmail: 'two@example.gov.in', toName: 'Officer Two',
    reason: null, ...stamp, at: now }, NAMES);
  assert.equal(assignment.assigned, true);
  assert.equal(assignment.toName, 'O. T.');
  assert.equal(assignment.actor, 'DFO');
  const released = masking.maskedEvent('e3', { type: 'assignment', from: 'officer-uid-2', to: null, toEmail: null, toName: null, ...stamp, at: now }, NAMES);
  assert.equal(released.assigned, false);
  assert.equal(released.toName, null);
  assert.equal('to' in assignment || 'toEmail' in assignment || 'from' in assignment, false);
  assert.deepEqual(leaks([status, assignment]), []);
  const note = masking.maskedNote('n1', { text: 'Vikram Singh called from +91 98765 43210', officerUid: 'officer-uid-1', at: now }, NAMES);
  assert.deepEqual(note, { id: 'n1', text: 'V. S. called from •••', actor: 'Staff', at: now });
  assert.equal(masking.actorLabel({ type: 'escalation' }), 'System');
  assert.equal(masking.actorLabel({ type: 'document_replaced' }), 'Reporter');
  assert.equal(masking.actorLabel({ actorUid: 'u', officerRole: '  Tehsildar ' }), 'Tehsildar');
  // Older document reviews carry actorRole; a staff-triggered escalation keeps its role.
  assert.equal(masking.actorLabel({ type: 'document_review', actorUid: 'u', actorRole: 'Patwari' }), 'Patwari');
  assert.equal(masking.actorLabel({ type: 'escalation', ...stamp }), 'DFO');
  assert.equal(masking.actorLabel({ type: 'escalation', officerUid: 'u', officerName: 'Officer One' }), 'Staff');
  assert.equal(masking.actorLabel({ kind: 'status' }), null);
});

test('masked documents carry verdicts only: no files, ID numbers or extracted fields', () => {
  const out = masking.maskedDocument('d1', { kind: 'aadhaar', side: 'reporter', status: 'attached', idNumberFull: '234567890124', idNumberMasked: 'XXXX XXXX 0124',
    storage: { original: 'case-documents/d1/original' }, fileName: 'asha-aadhaar.jpg',
    screening: { risk: 'high', summary: 'QR signature failed for 2345 6789 0124 (Asha Rani Rao)', extracted: { name: 'Asha Rani Rao' }, checks: [] },
    review: { decision: 'reupload_requested', reason: 'Blurred', by: 'officer-uid-1', byEmail: 'officer@example.gov.in', at: { seconds: 1_799_700_000, nanoseconds: 0 } } }, NAMES);
  assert.deepEqual(out, { id: 'd1', kind: 'aadhaar', side: 'reporter', risk: 'high', summary: 'QR signature failed for ••• (A. R. R.)',
    review: { decision: 'reupload_requested', at: 1_799_700_000_000 } });
  const unscreened = masking.maskedDocument('d2', { kind: 'pan', side: 'other_party', screening: { risk: 'bogus' }, review: null }, NAMES);
  assert.equal(unscreened.risk, null);
  assert.equal(unscreened.side, 'other_party');
  assert.equal(unscreened.review, null);
});

test('dates normalise to milliseconds from every stored shape', () => {
  assert.equal(toMillis(5), 5);
  assert.equal(toMillis(new Date(7)), 7);
  assert.equal(toMillis({ seconds: 1, nanoseconds: 5_000_000 }), 1005);
  assert.equal(toMillis(admin.firestore.Timestamp.fromMillis(42_000)), 42_000);
  assert.equal(toMillis({ toMillis: () => 9 }), 9);
  for (const bad of [undefined, null, NaN, Infinity, 'x', {}, { seconds: NaN }, new Date(NaN), { toMillis: () => 'x' }]) assert.equal(toMillis(bad), null);
});

test('service targets come from the contract and are not legal deadlines', () => {
  assert.equal(targets.ACKNOWLEDGE_MS, contract.serviceTargets.acknowledgeDays * DAY);
  assert.equal(targets.RESOLVE_MS, contract.serviceTargets.resolveDays * DAY);
  assert.deepEqual(targets.dueDates(now), { ackDueAt: now + 3 * DAY, resolveDueAt: now + 30 * DAY });
  assert.deepEqual(targets.NON_TERMINAL_STATUSES, ['open', 'investigating', 'inspection_scheduled']);
  assert.equal(targets.waitingCutoff(now, 7), now - 7 * DAY);
});

test('overdue state: acknowledge first, then resolve; terminal and legacy cases are never overdue', () => {
  const due = targets.dueDates(now - 40 * DAY);
  const cases = [
    [{ status: 'open', firstActionAt: null, ...targets.dueDates(now - DAY) }, null],
    [{ status: 'open', firstActionAt: null, ...targets.dueDates(now - 3 * DAY - 1) }, 'acknowledge'],
    // Exactly at the target is not yet overdue.
    [{ status: 'open', firstActionAt: null, ...targets.dueDates(now - 3 * DAY) }, null],
    [{ status: 'open', ...targets.dueDates(now - 4 * DAY) }, 'acknowledge'],
    [{ status: 'investigating', firstActionAt: now - 2 * DAY, ...targets.dueDates(now - 4 * DAY) }, null],
    // Past both targets without any staff action reads as not acknowledged.
    [{ status: 'open', firstActionAt: null, ...due }, 'acknowledge'],
    [{ status: 'inspection_scheduled', firstActionAt: now - 30 * DAY, ...due }, 'resolve'],
    [{ status: 'resolved', firstActionAt: null, ...due }, null],
    [{ status: 'rejected', firstActionAt: now, ...due }, null],
    [{ status: 'open', firstActionAt: null }, null],
    [{ status: 'open', firstActionAt: null, ackDueAt: String(now - 10 * DAY), resolveDueAt: null }, null],
  ];
  for (const [input, expected] of cases) assert.equal(targets.computeOverdue(input, now), expected, JSON.stringify(input));
});

test('transitions are written once per change with overdueSince set on entry and cleared on exit', () => {
  assert.equal(targets.overdueTransition('acknowledge', 'acknowledge', now), null);
  assert.equal(targets.overdueTransition(null, null, now), null);
  // A legacy ticket without the field is "not overdue" already; the backfill adds the explicit null.
  assert.equal(targets.overdueTransition(undefined, null, now), null);
  assert.deepEqual(targets.overdueTransition(null, 'acknowledge', now), { overdue: 'acknowledge', overdueSince: now });
  assert.deepEqual(targets.overdueTransition('acknowledge', 'resolve', now), { overdue: 'resolve', overdueSince: now });
  assert.deepEqual(targets.overdueTransition('resolve', null, now), { overdue: null, overdueSince: null });
  assert.deepEqual(targets.overdueTransition('garbage', 'resolve', now), { overdue: 'resolve', overdueSince: now });
  assert.equal(targets.storedOverdue('garbage'), null);
});

test('escalation decisions over a case lifecycle', () => {
  // What the hourly job and the staff handlers decide at each point in time.
  const filed = now, state = { status: 'open', firstActionAt: null, overdue: null, ...targets.dueDates(filed) };
  const step = (at, patch = {}) => {
    Object.assign(state, patch);
    const transition = targets.overdueTransition(state.overdue, targets.computeOverdue(state, at), at);
    if (transition) Object.assign(state, transition);
    return transition && transition.overdue;
  };
  assert.equal(step(filed + 2 * DAY), null);
  assert.equal(state.overdue, null);
  assert.equal(step(filed + 3 * DAY + 1), 'acknowledge');
  assert.equal(state.overdueSince, filed + 3 * DAY + 1);
  // Nothing changes while the state holds, so no duplicate escalation event.
  assert.equal(step(filed + 4 * DAY), null);
  assert.equal(state.overdue, 'acknowledge');
  // The first staff action acknowledges the case and clears the flag.
  const at = filed + 5 * DAY;
  assert.equal(step(at, { status: 'investigating', ...targets.firstActionPatch(state, at) }), null);
  assert.equal(state.firstActionAt, at);
  assert.equal(state.overdue, null);
  assert.equal(state.overdueSince, null);
  assert.equal(step(filed + 31 * DAY), 'resolve');
  // Closing clears it; reopening after the target flags it again.
  assert.equal(step(filed + 32 * DAY, { status: 'resolved' }), null);
  assert.equal(state.overdue, null);
  assert.equal(step(filed + 33 * DAY, { status: 'open' }), 'resolve');
  // Later actions never move the first-action time.
  assert.deepEqual(targets.firstActionPatch(state, filed + 40 * DAY), {});
  assert.deepEqual(targets.firstActionPatch({}, 5), { firstActionAt: 5 });
});

test('legacy cases get due dates from createdAt and queryable nulls, once', () => {
  const created = { seconds: 1_700_000_000, nanoseconds: 0 };
  assert.deepEqual(targets.legacyBackfill({ createdAt: created, revision: 0 }, now), {
    ackDueAt: 1_700_000_000_000 + 3 * DAY, resolveDueAt: 1_700_000_000_000 + 30 * DAY, firstActionAt: null, overdue: null,
    assignedTo: null, assignedEmail: null, assignedName: null, assignedAt: null });
  // A case staff already worked counts as acknowledged at its last update.
  const touched = targets.legacyBackfill({ createdAt: created, updatedAt: { seconds: 1_700_100_000, nanoseconds: 0 }, revision: 3 }, now);
  assert.equal(touched.firstActionAt, 1_700_100_000_000);
  // Without any date the run time stands in.
  assert.equal(targets.legacyBackfill({}, now).ackDueAt, now + 3 * DAY);
  const current = { createdAt: created, ...targets.dueDates(1), firstActionAt: null, overdue: null, assignedTo: 'u' };
  assert.equal(targets.legacyBackfill(current, now), null);
  assert.deepEqual(targets.legacyBackfill({ ...current, overdue: undefined }, now), { overdue: null });
});

test('staff access levels: a missing level is a legacy officer, anything unknown is a viewer', () => {
  assert.deepEqual([...access.STAFF_ACCESS], contract.staffAccess.map(level => level.id));
  assert.equal(access.normalizeAccess(undefined), 'officer');
  for (const level of ['viewer', 'officer', 'admin']) assert.equal(access.normalizeAccess(level), level);
  for (const bad of [null, '', 'Admin', 'superuser', 1, {}]) assert.equal(access.normalizeAccess(bad), 'viewer');
  assert.equal(access.hasAccess('viewer', 'viewer'), true);
  assert.equal(access.hasAccess('viewer', 'officer'), false);
  assert.equal(access.hasAccess('officer', 'admin'), false);
  assert.equal(access.hasAccess('admin', 'officer'), true);
  assert.equal(access.validStaffUid('AbC123_x-y'), true);
  for (const bad of ['', 'a/b', '../x', 'x'.repeat(129), null]) assert.equal(access.validStaffUid(bad), false);
});

test('assignment permissions, input validation, list filters and the staff stamp', () => {
  const { assignmentAllowed, validateAssignInput } = require('../lib/features/tickets/handlers.js');
  const { parseAssignee } = require('../lib/features/tickets/list.js');
  const { staffStamp } = require('../lib/features/tickets/authorization.js');
  const officer = { uid: 'o1', access: 'officer' }, adminUser = { uid: 'a1', access: 'admin' }, viewer = { uid: 'v1', access: 'viewer' };
  assert.equal(assignmentAllowed(officer, null, 'o1'), true);
  assert.equal(assignmentAllowed(officer, 'o2', 'o1'), true);
  assert.equal(assignmentAllowed(officer, 'o1', null), true);
  assert.equal(assignmentAllowed(officer, null, 'o2'), false);
  assert.equal(assignmentAllowed(officer, 'o2', null), false);
  assert.equal(assignmentAllowed(adminUser, 'o2', 'o3'), true);
  assert.equal(assignmentAllowed(adminUser, 'o2', null), true);
  assert.equal(assignmentAllowed(viewer, null, 'v1'), false);
  const valid = { ticketId: 'AbCdEfGhIjKlMnOpQrSt', assigneeUid: 'o1', expectedRevision: 2, requestId: 'synthetic-request-0001' };
  assert.deepEqual(validateAssignInput(valid), { ...valid, reason: '' });
  assert.equal(validateAssignInput({ ...valid, assigneeUid: null, reason: '  hand back  ' }).reason, 'hand back');
  assert.equal(validateAssignInput({ ...valid, assigneeUid: undefined }).assigneeUid, null);
  for (const bad of [{ reason: 'x'.repeat(301) }, { reason: 5 }, { assigneeUid: 'a/b' }, { assigneeUid: 7 }, { expectedRevision: -1 },
    { expectedRevision: 1.5 }, { expectedRevision: '2' }, { requestId: 'short' }, { ticketId: '../x' }]) {
    assert.throws(() => validateAssignInput({ ...valid, ...bad }), { code: 'invalid-argument' }, JSON.stringify(bad));
  }
  assert.equal(parseAssignee('me', 'o1'), 'o1');
  assert.equal(parseAssignee('unassigned', 'o1'), null);
  assert.equal(parseAssignee('o2', 'o1'), 'o2');
  for (const none of [undefined, null, '', 'all']) assert.equal(parseAssignee(none, 'o1'), undefined);
  for (const bad of ['a/b', 5, {}]) assert.throws(() => parseAssignee(bad, 'o1'), { code: 'invalid-argument' });
  assert.deepEqual(staffStamp({ uid: 'o1', email: 'o@example.gov.in', access: 'officer', role: 'DFO', displayName: 'Officer One' }),
    { officerUid: 'o1', officerEmail: 'o@example.gov.in', officerName: 'Officer One', officerRole: 'DFO' });
  // Without a role label the access level stands in, as for document reviews.
  assert.deepEqual(staffStamp({ uid: 'a1', email: '', access: 'admin', role: null, displayName: null }),
    { officerUid: 'a1', officerEmail: null, officerName: null, officerRole: 'admin' });
});

test('insight weeks start on Monday 00:00 IST', () => {
  const monday = Date.parse('2026-10-25T18:30:00Z');
  assert.equal(buckets.weekStartIst(Date.parse('2026-10-29T12:00:00Z')), monday);
  assert.equal(buckets.weekStartIst(monday), monday);
  assert.equal(buckets.weekStartIst(monday + buckets.WEEK_MS - 1), monday);
  // Sunday 23:59:59 IST still belongs to the previous week.
  assert.equal(buckets.weekStartIst(monday - 1000), monday - buckets.WEEK_MS);
  const weeks = buckets.recentWeekStarts(Date.parse('2026-10-29T12:00:00Z'));
  assert.equal(weeks.length, 12);
  assert.equal(weeks[11], monday);
  for (let index = 1; index < weeks.length; index++) assert.equal(weeks[index] - weeks[index - 1], buckets.WEEK_MS);
  assert.equal(buckets.recentWeekStarts(now, 3).length, 3);
});

test('ageing buckets come from cumulative counts and never go negative', () => {
  assert.deepEqual(buckets.ageingBuckets(10, 6, 3, 1), { d0_7: 4, d8_30: 3, d31_90: 2, d90p: 1 });
  assert.deepEqual(buckets.ageingBuckets(0, 0, 0, 0), { d0_7: 0, d8_30: 0, d31_90: 0, d90p: 0 });
  // Counts taken a moment apart can disagree; the buckets clamp at zero.
  assert.deepEqual(buckets.ageingBuckets(2, 3, 1, 2), { d0_7: 0, d8_30: 2, d31_90: 0, d90p: 2 });
});

test('states: top ten shown, small and remaining counts folded into Other', () => {
  assert.deepEqual(buckets.foldStates([{ state: 'Kerala', count: 2 }, { state: 'Goa', count: 0 }, { state: 'Bihar', count: 5 }]),
    [{ state: 'Bihar', count: 5 }, { state: 'Other', count: 2 }]);
  assert.deepEqual(buckets.foldStates([{ state: 'Goa', count: 0 }]), []);
  const many = Array.from({ length: 12 }, (_, index) => ({ state: 'State ' + String(index).padStart(2, '0'), count: 20 - index }));
  const folded = buckets.foldStates(many);
  assert.equal(folded.length, 11);
  assert.deepEqual(folded.slice(0, 2), [{ state: 'State 00', count: 20 }, { state: 'State 01', count: 19 }]);
  assert.deepEqual(folded[10], { state: 'Other', count: 9 + 10 });
  // Ties order alphabetically so the chart is stable.
  assert.deepEqual(buckets.foldStates([{ state: 'Odisha', count: 4 }, { state: 'Assam', count: 4 }]).map(entry => entry.state), ['Assam', 'Odisha']);
});

test('case-type groups follow the contract mapping', () => {
  const groups = buckets.partyTypesByCaseType(contract.documents.caseTypeByPartyType, ['citizen_vs_government', 'person_vs_person']);
  assert.deepEqual(groups.person_vs_person, ['Individual / private person']);
  assert.deepEqual([...groups.citizen_vs_government, ...groups.person_vs_person].sort(), [...contract.partyTypes].sort());
  assert.deepEqual(buckets.partyTypesByCaseType({ a: 'x', b: 'unknown_type' }, ['x', 'y']), { x: ['a'], y: [] });
});

test('the insights cache is served for ten minutes and recomputed after', () => {
  const ttl = insights.INSIGHTS_TTL_MS, payload = { generatedAt: now };
  assert.equal(ttl, 10 * 60 * 1000);
  assert.equal(buckets.freshCache({ generatedAt: now - ttl + 1, insights: payload }, now, ttl), payload);
  for (const stale of [undefined, {}, { generatedAt: now - ttl, insights: payload }, { generatedAt: now + 120_000, insights: payload },
    { generatedAt: String(now), insights: payload }, { generatedAt: now }, { generatedAt: now, insights: 'x' }]) {
    assert.equal(buckets.freshCache(stale, now, ttl), null, JSON.stringify(stale));
  }
});

// An in-memory stand-in for the Firestore surface getInsights uses. Any
// document read (`get()` on a query) fails the test: insights must come from
// count() aggregations alone.
function fakeDb(collections) {
  const read = (doc, path) => path.split('.').reduce((value, key) => value == null ? undefined : value[key], doc);
  const ms = value => value && typeof value.toMillis === 'function' ? value.toMillis() : value;
  const passes = (doc, [field, op, expected]) => {
    const value = read(doc, field);
    if (op === '==') return value === expected;
    if (op === 'in') return value !== undefined && expected.includes(value);
    if (value === undefined || value === null) return false;
    if (op === '<') return ms(value) < ms(expected);
    if (op === '>=') return ms(value) >= ms(expected);
    throw new Error('Unsupported operator ' + op);
  };
  const calls = { counts: 0, writes: [] }, cache = {};
  const query = (name, filters) => ({
    where: (field, op, value) => {
      if (op === 'in') assert.ok(value.length > 0 && value.length <= 30, 'in-filter size for ' + field);
      return query(name, [...filters, [field, op, value]]);
    },
    count: () => ({ get: async () => {
      calls.counts++;
      return { data: () => ({ count: (collections[name] ?? []).filter(doc => filters.every(filter => passes(doc, filter))).length }) };
    } }),
    get: async () => { throw new Error('getInsights read documents from ' + name); },
    limit: () => { throw new Error('getInsights scanned ' + name); },
  });
  return { calls, cache, collection: name => name === 'insightsCache'
    ? { doc: id => ({ get: async () => ({ data: () => cache[id] }), set: async value => { cache[id] = value; calls.writes.push(id); } }) }
    : query(name, []) };
}

test('getInsights figures come from count() aggregations and carry no personal data', async () => {
  const at = ms => admin.firestore.Timestamp.fromMillis(ms);
  const nowIst = Date.parse('2026-10-29T12:00:00Z');
  const make = (status, ageDays, dispute, extra = {}) => ({ status, createdAt: at(nowIst - ageDays * DAY), overdue: null,
    dispute: { reporterName: 'Asha Rani Rao', otherPartyName: 'Vikram Singh', description: 'Call 9876543210', ...dispute }, ...extra });
  const individual = contract.partyTypes[0], forest = contract.partyTypes[1];
  const tickets = [
    ...Array.from({ length: 4 }, () => make('open', 1, { state: 'Maharashtra', disputeType: contract.disputeTypes[0], otherPartyType: individual })),
    make('investigating', 10, { state: 'Maharashtra', disputeType: contract.disputeTypes[1], otherPartyType: forest }, { overdue: 'acknowledge' }),
    make('inspection_scheduled', 40, { state: 'Odisha', disputeType: contract.disputeTypes[1], otherPartyType: forest }, { overdue: 'resolve' }),
    make('open', 100, { state: 'Odisha', disputeType: contract.disputeTypes[2], otherPartyType: forest }, { overdue: 'resolve' }),
    make('resolved', 50, { state: 'Odisha', disputeType: contract.disputeTypes[0], otherPartyType: individual }),
    // One case in Goa: too few to show on its own.
    make('rejected', 5, { state: 'Goa', disputeType: contract.disputeTypes[0], otherPartyType: forest }),
    // A legacy WhatsApp ticket without dispute details.
    { status: 'open', createdAt: at(nowIst - 2 * DAY), waFrom: '+919876543210' },
  ];
  const caseDocuments = [
    { status: 'attached', screening: { risk: 'low' }, review: null, idNumberFull: '234567890124' },
    { status: 'attached', screening: { risk: 'high' }, review: { decision: 'accepted' } },
    { status: 'attached', screening: { risk: 'altered' }, review: { decision: 'reupload_requested' } },
    { status: 'pending', screening: { risk: 'high' }, review: null },
  ];
  const db = fakeDb({ tickets, caseDocuments });
  const out = await insights.cachedInsights(db, nowIst);
  assert.equal(out.generatedAt, nowIst);
  assert.deepEqual(out.byStatus, { open: 6, investigating: 1, inspection_scheduled: 1, resolved: 1, rejected: 1 });
  assert.deepEqual(out.byCategory, contract.disputeTypes.map((label, index) => ({ label, count: [6, 2, 1][index] ?? 0 })));
  assert.deepEqual(out.byState, [{ state: 'Maharashtra', count: 5 }, { state: 'Odisha', count: 3 }, { state: 'Other', count: 1 }]);
  assert.deepEqual(out.byCaseType, { citizen_vs_government: 4, person_vs_person: 5, unknown: 1 });
  assert.deepEqual(out.ageing, { d0_7: 5, d8_30: 1, d31_90: 1, d90p: 1 });
  assert.equal(out.weeklyIntake.length, 12);
  assert.equal(out.weeklyIntake[11].weekStart, Date.parse('2026-10-25T18:30:00Z'));
  // Created 1 day ago (x4), 2 days ago and 5 days ago fall in the current week (from Monday).
  assert.equal(out.weeklyIntake[11].count, 5);
  assert.equal(out.weeklyIntake.reduce((sum, week) => sum + week.count, 0), 9);
  assert.deepEqual(out.overdue, { acknowledge: 1, resolve: 2 });
  assert.deepEqual(out.documents, { uploaded: 3, flagged: 2, reviewed: 2 });
  assert.deepEqual(leaks(out), []);
  assert.equal(JSON.stringify(out).includes('234567890124'), false);
  assert.deepEqual(db.calls.writes, ['current']);
  // Within ten minutes the snapshot is served without a single aggregation.
  const counted = db.calls.counts;
  assert.ok(counted > 0);
  assert.deepEqual(await insights.cachedInsights(db, nowIst + 9 * 60 * 1000), out);
  assert.equal(db.calls.counts, counted);
  const later = await insights.cachedInsights(db, nowIst + 10 * 60 * 1000);
  assert.equal(later.generatedAt, nowIst + 10 * 60 * 1000);
  assert.equal(db.calls.counts, counted * 2);
});
