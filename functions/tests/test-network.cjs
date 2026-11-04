const assert = require('node:assert/strict');
const test = require('node:test');
process.env.GCLOUD_PROJECT = 'demo-forestwatch';
process.env.DISPUTE_OTP_SECRET = 'test-secret-not-a-real-key';
const net = require('../lib/platform/network.js');
const rules = require('../lib/features/documents/rules.js');

const request = (forwardedFor, remoteAddress = '10.0.0.9') => ({ headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor }, socket: { remoteAddress }, ip: '203.0.113.99' });

test('the quota address is the entry our own proxy appended, never the one the client wrote', () => {
  // Cloud Run appends the connecting address to whatever the caller sent.
  assert.equal(net.clientAddress(request('1.2.3.4, 198.51.100.7'), 1), '198.51.100.7');
  assert.equal(net.clientAddress(request('1.2.3.4, 5.6.7.8, 198.51.100.7'), 1), '198.51.100.7');
  // Behind one more trusted hop (an external load balancer) count one further from the right.
  assert.equal(net.clientAddress(request('1.2.3.4, 198.51.100.7, 35.0.0.1'), 2), '198.51.100.7');
  // req.ip (Express "trust proxy" = leftmost) is never consulted.
  assert.notEqual(net.clientAddress(request('1.2.3.4, 198.51.100.7'), 1), '203.0.113.99');
});

test('a bare, bracketed or ported IPv6 address is normalised; garbage falls back to the socket', () => {
  assert.equal(net.clientAddress(request('2001:DB8::1'), 1), '2001:db8::1');
  assert.equal(net.clientAddress(request('[2001:db8::1]:4433'), 1), '2001:db8::1');
  assert.equal(net.clientAddress(request('198.51.100.7:51234'), 1), '198.51.100.7');
  assert.equal(net.clientAddress(request('::ffff:198.51.100.7'), 1), '::ffff:198.51.100.7');
  assert.equal(net.clientAddress(request('unknown, <script>'), 1), '10.0.0.9');
  assert.equal(net.clientAddress(request('999.1.1.1'), 1), '10.0.0.9');
  assert.equal(net.clientAddress(request(undefined), 1), '10.0.0.9');
  assert.equal(net.clientAddress(request('', 'nonsense'), 1), null);
  assert.equal(net.clientAddress(request(['1.1.1.1', '198.51.100.7']), 1), '198.51.100.7');
});

test('too few entries for the configured hops fall back to the socket rather than the client-written value', () => {
  assert.equal(net.clientAddress(request('1.2.3.4'), 2), '10.0.0.9');
});

test('TRUSTED_PROXY_HOPS is read defensively', () => {
  assert.equal(net.trustedProxyHops({}), 1);
  assert.equal(net.trustedProxyHops({ TRUSTED_PROXY_HOPS: '2' }), 2);
  for (const bad of ['0', '-1', '9', 'two', '1.5']) assert.equal(net.trustedProxyHops({ TRUSTED_PROXY_HOPS: bad }), 1, bad);
});

test('PDF sniffing still tolerates leading junk but refuses polyglots that are another file first', () => {
  assert.equal(rules.sniffDocumentType(Buffer.from('%PDF-1.7\n%...')), 'application/pdf');
  assert.equal(rules.sniffDocumentType(Buffer.from('\n\n%PDF-1.4')), 'application/pdf');
  assert.equal(rules.sniffDocumentType(Buffer.from('junk%PDF-1.7\n')), 'application/pdf');
  const polyglots = {
    html: Buffer.from('<!DOCTYPE html><script>1</script>%PDF-1.7'),
    svg: Buffer.from('  <svg xmlns="http://www.w3.org/2000/svg">%PDF-1.7</svg>'),
    bomXml: Buffer.from('﻿<?xml version="1.0"?>%PDF-1.7'),
    zip: Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.alloc(20), Buffer.from('%PDF-1.7')]),
    gif: Buffer.from('GIF89a........%PDF-1.7'),
    exe: Buffer.from('MZ\x90\x00%PDF-1.7'),
    tiff: Buffer.from('II*\0....%PDF-1.7'),
  };
  for (const [name, bytes] of Object.entries(polyglots)) assert.equal(rules.sniffDocumentType(bytes), null, name);
  // Images keep their own type even when "%PDF-" appears inside them.
  assert.equal(rules.sniffDocumentType(Buffer.from('\xff\xd8\xff\xe0%PDF-1.7', 'latin1')), 'image/jpeg');
  // A header past the first KiB is not a PDF.
  assert.equal(rules.sniffDocumentType(Buffer.concat([Buffer.alloc(1024, 0x20), Buffer.from('%PDF-1.7')])), null);
});

test('geocode per-address limiter counts within a minute and forgets expired windows', () => {
  const { overAddressLimit } = require('../lib/features/maps/geocode.js');
  const t0 = 1_700_000_000_000;
  for (let i = 0; i < 20; i++) assert.equal(overAddressLimit('a', t0 + i, 20), false, `request ${i + 1}`);
  assert.equal(overAddressLimit('a', t0 + 30, 20), true);
  assert.equal(overAddressLimit('b', t0 + 30, 20), false);
  assert.equal(overAddressLimit('a', t0 + 60_001, 20), false);
});
