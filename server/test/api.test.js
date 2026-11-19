import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import supertest from 'supertest';
import { SMTPServer } from 'smtp-server';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { connectDb } from '../src/db.js';
import { ReminderJob } from '../src/models.js';
import { processDueJobs } from '../src/worker.js';
import { config } from '../src/config.js';

let mongod;
let app;
before(async () => {
  mongod = await MongoMemoryServer.create();
  await connectDb(mongod.getUri());
  app = createApp();
});
after(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

const productInput = {
  name: 'Laptop Pro',
  brand: 'Northstar',
  model: '14',
  category: 'Electronics',
  serialNumber: '',
  purchaseDate: '2026-01-01',
  warrantyStartDate: '2026-01-01',
  warrantyMonths: 12,
  manualEndDate: '',
  terms: 'Parts and labour',
  notes: '',
};

test('full account, product, receipt, contact and reminder lifecycle is private', async () => {
  const alice = supertest.agent(app);
  const bob = supertest.agent(app);
  let response = await alice
    .post('/api/auth/register')
    .send({ name: 'Alice Owner', email: 'alice@example.com', password: 'strongpassword' });
  assert.equal(response.status, 201);
  response = await bob
    .post('/api/auth/register')
    .send({ name: 'Bob Other', email: 'bob@example.com', password: 'strongpassword' });
  assert.equal(response.status, 201);
  response = await alice.post('/api/products').send(productInput);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const productId = response.body.product.id;
  assert.equal(response.body.product.warrantyEndDate, '2026-12-31');
  assert.equal((await bob.get(`/api/products/${productId}`)).status, 404);
  assert.equal((await bob.patch(`/api/products/${productId}`).send(productInput)).status, 404);
  assert.equal((await bob.delete(`/api/products/${productId}`)).status, 404);

  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
  response = await alice
    .post(`/api/products/${productId}/documents`)
    .attach('file', pdf, { filename: 'invoice.pdf', contentType: 'application/pdf' });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const receiptId = response.body.document.id;
  assert.equal((await alice.get(`/api/products/${productId}/documents`)).body.documents.length, 1);
  const retrieved = await alice.get(`/api/documents/${receiptId}/file`);
  assert.equal(retrieved.status, 200);
  assert.match(retrieved.headers['content-type'], /application\/pdf/);
  assert.deepEqual(retrieved.body, pdf);
  assert.match(
    (await alice.get(`/api/documents/${receiptId}/file?download=1`)).headers['content-disposition'],
    /^attachment;/,
  );
  assert.equal((await bob.get(`/api/documents/${receiptId}/file`)).status, 404);
  assert.equal((await bob.delete(`/api/documents/${receiptId}`)).status, 404);

  response = await alice.post(`/api/products/${productId}/service-centers`).send({
    name: 'Northstar Support',
    phone: '1234567890',
    address: 'Main Street',
    website: 'https://example.com',
  });
  assert.equal(response.status, 201);
  const contactId = response.body.contact.id;
  assert.equal((await bob.get(`/api/products/${productId}/service-centers`)).status, 404);
  assert.equal(
    (await bob.patch(`/api/service-centers/${contactId}`).send({ name: 'Changed' })).status,
    404,
  );
  assert.equal((await bob.delete(`/api/service-centers/${contactId}`)).status, 404);
  assert.equal(
    (
      await alice.patch(`/api/service-centers/${contactId}`).send({
        name: 'Northstar Repairs',
        phone: '1234567890',
        address: 'Main Street',
        website: 'https://example.com',
      })
    ).body.contact.name,
    'Northstar Repairs',
  );

  response = await alice.get('/api/dashboard/summary');
  assert.equal(response.body.counts.total, 1);
  assert.equal(response.body.counts.receipts, 1);
  response = await bob.get('/api/dashboard/summary');
  assert.equal(response.body.counts.total, 0);

  response = await alice
    .put('/api/reminder-preferences')
    .send({ enabled: true, offsetsDays: [30, 7, 1] });
  assert.equal(response.status, 200);
  assert.equal(
    (await alice.get('/api/reminder-preferences')).body.emailConfigured,
    Boolean(config.smtp.host),
  );
  assert.equal((await alice.get('/api/reminders/history')).status, 200);

  response = await alice
    .patch(`/api/products/${productId}`)
    .send({ ...productInput, manualEndDate: '2026-11-30' });
  assert.equal(response.status, 200);
  assert.equal(response.body.product.endDateSource, 'manual');
  assert.equal((await alice.get('/api/products?search=Laptop&status=all')).body.products.length, 1);

  assert.equal((await alice.delete(`/api/products/${productId}`)).status, 204);
  assert.equal((await alice.get(`/api/documents/${receiptId}/file`)).status, 404);
  assert.equal((await alice.get(`/api/products/${productId}/service-centers`)).status, 404);
  assert.equal((await alice.get('/api/dashboard/summary')).body.counts.total, 0);
  assert.equal((await alice.post('/api/auth/logout')).status, 204);
  assert.equal((await alice.get('/api/products')).status, 401);
});

test('login replaces an existing session and logout revokes the current one', async () => {
  const agent = supertest.agent(app);
  const registered = await agent
    .post('/api/auth/register')
    .send({ name: 'Session Owner', email: 'session@example.com', password: 'strongpassword' });
  assert.equal(registered.status, 201);
  const oldCookie = registered.headers['set-cookie'][0].split(';')[0];
  assert.equal((await agent.get('/api/auth/me')).body.user.email, 'session@example.com');

  assert.equal(
    (
      await agent
        .post('/api/auth/login')
        .send({ email: 'session@example.com', password: 'wrongpassword' })
    ).status,
    401,
  );
  const signedIn = await agent
    .post('/api/auth/login')
    .send({ email: 'session@example.com', password: 'strongpassword' });
  assert.equal(signedIn.status, 200);
  assert.equal((await supertest(app).get('/api/auth/me').set('Cookie', oldCookie)).status, 401);
  assert.equal((await agent.get('/api/auth/me')).status, 200);
  assert.equal((await agent.post('/api/auth/logout')).status, 204);
  assert.equal((await agent.get('/api/auth/me')).status, 401);
});

test('document vault finds warranty proof and keeps it private', async () => {
  const owner = supertest.agent(app);
  const stranger = supertest.agent(app);
  await owner
    .post('/api/auth/register')
    .send({ name: 'Vault Owner', email: 'vault@example.com', password: 'strongpassword' });
  await stranger
    .post('/api/auth/register')
    .send({ name: 'Vault Stranger', email: 'stranger@example.com', password: 'strongpassword' });
  const product = await owner
    .post('/api/products')
    .send({ ...productInput, name: 'Travel Camera' });
  const productId = product.body.product.id;
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
  const uploaded = await owner
    .post(`/api/products/${productId}/documents`)
    .field('category', 'warranty_card')
    .field('note', 'Stamped at purchase')
    .attach('file', pdf, { filename: 'coverage.pdf', contentType: 'application/pdf' });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  const documentId = uploaded.body.document.id;
  assert.equal(uploaded.body.document.category, 'warranty_card');
  assert.equal((await owner.get('/api/documents?search=Travel%20Camera')).body.documents.length, 1);
  assert.equal((await owner.get('/api/documents?search=stamped')).body.documents.length, 1);
  assert.equal((await owner.get('/api/documents?category=invoice')).body.documents.length, 0);
  assert.equal((await owner.get(`/api/documents/${documentId}/file`)).status, 200);
  assert.equal((await stranger.get('/api/documents')).body.documents.length, 0);
  assert.equal((await stranger.get(`/api/documents/${documentId}/file`)).status, 404);
  assert.equal(
    (await stranger.patch(`/api/documents/${documentId}`).send({ category: 'manual', note: '' }))
      .status,
    404,
  );
  assert.equal((await stranger.delete(`/api/documents/${documentId}`)).status, 404);
  assert.equal((await owner.get('/api/dashboard/summary')).body.counts.documents, 1);
  assert.equal((await owner.get('/api/dashboard/summary')).body.counts.receipts, 0);
  const changed = await owner
    .patch(`/api/documents/${documentId}`)
    .send({ category: 'manual', note: 'Instructions for setup' });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.document.note, 'Instructions for setup');
  assert.equal((await owner.get('/api/documents?category=manual')).body.documents.length, 1);
  assert.equal((await owner.get(`/api/products/${productId}/receipts`)).status, 404);
  assert.equal((await owner.delete(`/api/documents/${documentId}`)).status, 204);
  assert.equal((await owner.get('/api/documents')).body.documents.length, 0);
});

test('invalid inputs and upload types return clear errors', async () => {
  const agent = supertest.agent(app);
  await agent
    .post('/api/auth/register')
    .send({ name: 'Test User', email: 'test@example.com', password: 'strongpassword' });
  const bad = await agent
    .post('/api/products')
    .send({ ...productInput, purchaseDate: '2026-02-30' });
  assert.equal(bad.status, 400);
  const product = await agent.post('/api/products').send(productInput);
  const upload = await agent
    .post(`/api/products/${product.body.product.id}/documents`)
    .attach('file', Buffer.from('not a receipt'), 'note.txt');
  assert.equal(upload.status, 400);
  const tooLarge = await agent
    .post(`/api/products/${product.body.product.id}/documents`)
    .attach(
      'file',
      Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(10 * 1024 * 1024)]),
      'too-large.pdf',
    );
  assert.equal(tooLarge.status, 400);
  assert.match(tooLarge.body.error, /10 MB/);
  assert.equal(
    (await agent.get(`/api/products/${product.body.product.id}/documents`)).body.documents.length,
    0,
  );
});

test('worker records one successful due email attempt', async () => {
  const agent = supertest.agent(app);
  await agent
    .post('/api/auth/register')
    .send({ name: 'Mail User', email: 'mail@example.com', password: 'strongpassword' });
  const futureEnd = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const product = await agent
    .post('/api/products')
    .send({ ...productInput, manualEndDate: futureEnd });
  const productId = product.body.product.id;
  const job = await ReminderJob.findOne({ productId });
  assert.ok(job);
  job.scheduledFor = new Date(Date.now() - 1000);
  await job.save();
  const deliveries = [];
  await processDueJobs(1, async (message) => {
    deliveries.push(message);
    return { messageId: 'test-1' };
  });
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].to, 'mail@example.com');
  assert.equal((await ReminderJob.findById(job.id)).status, 'sent');
  await processDueJobs(1, async (message) => {
    deliveries.push(message);
  });
  assert.equal(deliveries.length, 1);
});

test('configured SMTP transport delivers a due reminder to a local mail server', async () => {
  let message = '';
  const smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    onData(stream, _session, done) {
      stream.on('data', (chunk) => {
        message += chunk.toString();
      });
      stream.on('end', () => done());
      stream.on('error', done);
    },
  });
  await new Promise((resolve) => smtp.listen(0, '127.0.0.1', resolve));
  const previousSmtp = { ...config.smtp };
  config.smtp.host = '127.0.0.1';
  config.smtp.port = smtp.server.address().port;
  config.smtp.secure = false;
  config.smtp.user = '';
  config.smtp.pass = '';
  try {
    const agent = supertest.agent(app);
    await agent
      .post('/api/auth/register')
      .send({ name: 'SMTP User', email: 'smtp@example.com', password: 'strongpassword' });
    const futureEnd = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const product = await agent
      .post('/api/products')
      .send({ ...productInput, name: 'Camera', manualEndDate: futureEnd });
    const job = await ReminderJob.findOne({ productId: product.body.product.id });
    assert.ok(job);
    job.scheduledFor = new Date(Date.now() - 1000);
    await job.save();
    await processDueJobs(1);
    assert.match(message, /Camera/);
    assert.match(message, /smtp@example.com/);
    assert.equal((await ReminderJob.findById(job.id)).status, 'sent');
  } finally {
    Object.assign(config.smtp, previousSmtp);
    await new Promise((resolve) => smtp.close(resolve));
  }
});
