import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import supertest from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { connectDb } from '../src/db.js';
import { config } from '../src/config.js';
import { Product, Receipt, User } from '../src/models.js';

let mongod;
let app;
before(async () => {
  mongod = await MongoMemoryServer.create();
  await connectDb(mongod.getUri());
  // Every request here shares one IP; the per-IP sign-in limit is not what these tests cover.
  config.limits.authPer15Min = 1000;
  app = createApp();
});
after(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

const productInput = {
  name: 'Air Purifier',
  brand: 'Breeze',
  purchaseDate: '2026-01-01',
  warrantyMonths: 12,
};
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
const storedFiles = () => mongoose.connection.db.collection('receipts.files').countDocuments();

async function signUp(email, password = 'long-enough-password') {
  const agent = supertest.agent(app);
  const response = await agent
    .post('/api/auth/register')
    .send({ name: 'Test Person', email, password });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return agent;
}

async function withLimits(changes, run) {
  const previous = { ...config.limits };
  Object.assign(config.limits, changes);
  try {
    await run();
  } finally {
    Object.assign(config.limits, previous);
  }
}

test('repeated wrong passwords lock sign-in without revealing which accounts exist', async () => {
  await signUp('locked@example.com');
  const login = (email, password) =>
    supertest(app).post('/api/auth/login').send({ email, password });
  const unknown = await login('nobody@example.com', 'whatever-password');
  for (let i = 0; i < config.limits.loginFailuresBeforeLock; i++) {
    const failed = await login('locked@example.com', 'wrong-password');
    assert.equal(failed.status, 401);
    assert.equal(failed.body.error, unknown.body.error);
  }
  const whileLocked = await login('locked@example.com', 'long-enough-password');
  assert.equal(whileLocked.status, 401);
  assert.equal(whileLocked.body.error, unknown.body.error);

  await User.updateOne(
    { email: 'locked@example.com' },
    { $set: { loginLockedUntil: new Date(0) } },
  );
  assert.equal((await login('locked@example.com', 'long-enough-password')).status, 200);
  assert.equal((await User.findOne({ email: 'locked@example.com' })).failedLogins, 0);
});

test('sign-up rejects short passwords and passwords bcrypt would truncate', async () => {
  const register = (password, email) =>
    supertest(app).post('/api/auth/register').send({ name: 'Short Pass', email, password });
  assert.equal((await register('nine-char', 'short@example.com')).status, 400);
  assert.equal((await register('密'.repeat(25), 'bytes@example.com')).status, 400);
  assert.equal((await register('ten-chars!', 'ok@example.com')).status, 201);
});

test('cross-site writes are refused even with a valid session', async () => {
  const agent = await signUp('csrf@example.com');
  const crossSite = await agent
    .post('/api/products')
    .set('Sec-Fetch-Site', 'cross-site')
    .send(productInput);
  assert.equal(crossSite.status, 403);
  const foreignOrigin = await agent
    .post('/api/products')
    .set('Origin', 'https://evil.example')
    .send(productInput);
  assert.equal(foreignOrigin.status, 403);
  const sameOrigin = await agent
    .post('/api/products')
    .set('Origin', config.appOrigin)
    .set('Sec-Fetch-Site', 'same-origin')
    .send(productInput);
  assert.equal(sameOrigin.status, 201);
});

test('uploads stream safely and leave no stray files behind', async () => {
  const owner = await signUp('owner@example.com');
  const stranger = await signUp('stranger@example.com');
  const productId = (await owner.post('/api/products').send(productInput)).body.product.id;
  const before = await storedFiles();

  const foreign = await stranger
    .post(`/api/products/${productId}/documents`)
    .attach('file', pdf, 'mine-now.pdf');
  assert.equal(foreign.status, 404);
  const disguised = await owner
    .post(`/api/products/${productId}/documents`)
    .attach('file', Buffer.from('<script>alert(1)</script>'), {
      filename: 'fake.pdf',
      contentType: 'application/pdf',
    });
  assert.equal(disguised.status, 400);
  const tooLarge = await owner
    .post(`/api/products/${productId}/documents`)
    .attach('file', Buffer.concat([pdf, Buffer.alloc(10 * 1024 * 1024)]), 'big.pdf');
  assert.equal(tooLarge.status, 400);
  const badNote = await owner
    .post(`/api/products/${productId}/documents`)
    .field('note', 'x'.repeat(301))
    .attach('file', pdf, 'note.pdf');
  assert.equal(badNote.status, 400);
  assert.equal(await storedFiles(), before);

  const uploaded = await owner
    .post(`/api/products/${productId}/documents`)
    .attach('file', pdf, 'रसीद.pdf');
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  assert.equal(uploaded.body.document.originalName, 'रसीद.pdf');
  assert.equal(uploaded.body.document.size, pdf.length);
  assert.equal(await storedFiles(), before + 1);
  const file = await owner.get(`/api/documents/${uploaded.body.document.id}/file?download=1`);
  assert.equal(file.status, 200);
  assert.deepEqual(file.body, pdf);
  assert.match(file.headers['content-disposition'], /filename\*=UTF-8''%E0%A4%B0/);
});

test('responses leave out owner and storage internals', async () => {
  const agent = await signUp('internals@example.com');
  const product = (await agent.post('/api/products').send(productInput)).body.product;
  const document = (
    await agent.post(`/api/products/${product.id}/documents`).attach('file', pdf, 'proof.pdf')
  ).body.document;
  const contact = (
    await agent.post(`/api/products/${product.id}/service-centers`).send({ name: 'Breeze Care' })
  ).body.contact;
  const listed = (await agent.get('/api/documents')).body.documents[0];
  for (const record of [product, document, contact, listed]) {
    assert.ok(record.id);
    for (const field of ['userId', 'gridFsFileId', '__v']) assert.equal(record[field], undefined);
  }
  const jobs = (await agent.get('/api/reminders/history')).body.jobs;
  assert.ok(jobs.length);
  for (const job of jobs) assert.equal(job.userId, undefined);
});

test('legacy receipt routes are gone', async () => {
  const agent = await signUp('legacy@example.com');
  const productId = (await agent.post('/api/products').send(productInput)).body.product.id;
  assert.equal((await agent.get(`/api/products/${productId}/receipts`)).status, 404);
  assert.equal(
    (await agent.post(`/api/products/${productId}/receipts`).attach('file', pdf, 'a.pdf')).status,
    404,
  );
});

test('per-account quotas stop runaway storage', async () => {
  const agent = await signUp('quota@example.com');
  let productId;
  await withLimits({ maxProducts: 1, maxDocuments: 1, maxContactsPerProduct: 1 }, async () => {
    productId = (await agent.post('/api/products').send(productInput)).body.product.id;
    assert.equal((await agent.post('/api/products').send(productInput)).status, 403);
    const contact = (name) =>
      agent.post(`/api/products/${productId}/service-centers`).send({ name });
    assert.equal((await contact('First Desk')).status, 201);
    assert.equal((await contact('Second Desk')).status, 403);
    const upload = () =>
      agent.post(`/api/products/${productId}/documents`).attach('file', pdf, 'proof.pdf');
    assert.equal((await upload()).status, 201);
    const blocked = await upload();
    assert.equal(blocked.status, 403);
    assert.match(blocked.body.error, /up to 1 documents/);
  });
  await withLimits({ maxStorageBytes: 1 }, async () => {
    const full = await agent
      .post(`/api/products/${productId}/documents`)
      .attach('file', pdf, 'more.pdf');
    assert.equal(full.status, 403);
    assert.match(full.body.error, /storage is full/);
  });
});

test('changing the password signs out other devices', async () => {
  const laptop = await signUp('change@example.com', 'original-password');
  const phone = supertest.agent(app);
  await phone
    .post('/api/auth/login')
    .send({ email: 'change@example.com', password: 'original-password' });
  assert.equal((await phone.get('/api/auth/me')).status, 200);

  const wrong = await laptop
    .post('/api/auth/password')
    .send({ currentPassword: 'not-my-password', newPassword: 'brand-new-password' });
  assert.equal(wrong.status, 401);
  const changed = await laptop
    .post('/api/auth/password')
    .send({ currentPassword: 'original-password', newPassword: 'brand-new-password' });
  assert.equal(changed.status, 204);
  assert.equal((await laptop.get('/api/auth/me')).status, 200);
  assert.equal((await phone.get('/api/auth/me')).status, 401);
  const login = (password) =>
    supertest(app).post('/api/auth/login').send({ email: 'change@example.com', password });
  assert.equal((await login('original-password')).status, 401);
  assert.equal((await login('brand-new-password')).status, 200);
});

test('deleting an account removes its data and files', async () => {
  const agent = await signUp('leaving@example.com');
  const productId = (await agent.post('/api/products').send(productInput)).body.product.id;
  await agent.post(`/api/products/${productId}/documents`).attach('file', pdf, 'proof.pdf');
  await agent.post(`/api/products/${productId}/service-centers`).send({ name: 'Breeze Care' });
  const user = await User.findOne({ email: 'leaving@example.com' }).lean();
  const filesBefore = await storedFiles();

  assert.equal(
    (await agent.delete('/api/auth/me').send({ password: 'wrong-password' })).status,
    401,
  );
  assert.equal(
    (await agent.delete('/api/auth/me').send({ password: 'long-enough-password' })).status,
    204,
  );
  assert.equal(await User.countDocuments({ _id: user._id }), 0);
  assert.equal(await Product.countDocuments({ userId: user._id }), 0);
  assert.equal(await Receipt.countDocuments({ userId: user._id }), 0);
  assert.equal(await storedFiles(), filesBefore - 1);
  assert.equal((await agent.get('/api/auth/me')).status, 401);
  const login = await supertest(app)
    .post('/api/auth/login')
    .send({ email: 'leaving@example.com', password: 'long-enough-password' });
  assert.equal(login.status, 401);
});
