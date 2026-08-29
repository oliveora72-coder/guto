import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'test-secret-with-more-than-thirty-two-characters-123';
process.env.WEBHOOK_SIGNING_SECRET = 'webhook-secret-with-more-than-thirty-two-characters';

const lib = await import('../api/lib.js');

test('amountToCents trata decimal brasileiro e bloqueia valores inválidos', () => {
  assert.equal(lib.amountToCents('49,90'), 4990);
  assert.equal(lib.amountToCents(10), 1000);
  assert.throws(() => lib.amountToCents(0));
});

test('senha usa scrypt com salt e valida sem guardar texto puro', async () => {
  const hash = await lib.hashPassword('uma-senha-bem-segura');
  assert.match(hash, /^scrypt\$16384\$/);
  assert.equal(await lib.verifyPassword('uma-senha-bem-segura', hash), true);
  assert.equal(await lib.verifyPassword('senha-errada', hash), false);
});

test('sessão assinada detecta alteração', () => {
  const token = lib.signSession({ sub: 'user-1', role: 'merchant' }, 60);
  assert.equal(lib.verifySession(token).sub, 'user-1');
  assert.equal(lib.verifySession(`${token.slice(0, -2)}aa`), null);
});

test('segredos são cifrados com AES-GCM', () => {
  const secret = 'whsec_muito-secreto';
  const encrypted = lib.encryptSecret(secret);
  assert.notEqual(encrypted, secret);
  assert.equal(lib.decryptSecret(encrypted), secret);
});

test('taxa é calculada em centavos sem ponto flutuante financeiro', () => {
  assert.deepEqual(lib.calculateFee(10000, { fee_bps: 199, fixed_fee_cents: 49 }), { fee: 248, net: 9752 });
});
