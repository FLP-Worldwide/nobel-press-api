const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const mocks = require('node-mocks-http');
const { PrismaPGlite } = require('pglite-prisma-adapter');
const { PGlite } = require('@electric-sql/pglite');


let db, app, prisma, author, buyer, admin, outsider, bookId, reviewId;
const attempts = new Map();
let charges = 0, failInitiation = false;
const tokens = {};
const realFetch = global.fetch;
const delivery = { name: 'Test Reader', email: 'reader@example.test', phone: '9000000001', addressLine1: 'Test street', city: 'Jaipur', state: 'Rajasthan', postalCode: '302001', country: 'India' };
async function call(route, role = 'author', method = 'GET', body, expected = 200, headers = {}) {
  const { req, res } = mocks.createMocks({ method, url: '/api' + route, headers: { authorization: `Bearer ${tokens[role]}`, 'content-type': 'application/json', ...headers }, body: body || {} }, { eventEmitter: EventEmitter });
  const ended = new Promise((resolve, reject) => { res.on('end', resolve); res.on('error', reject); });
  app.handle(req, res);
  await ended;
  const data = res._getJSONData();
  assert.equal(res.statusCode, expected, `${method} ${route}: ${JSON.stringify(data)}`);
  return data;
}
before(async () => {
  db = await PGlite.create();
  for (const dir of fs.readdirSync(path.join(__dirname, '../prisma/migrations')).filter(name => /^\d/.test(name)).sort()) {
    await db.exec(fs.readFileSync(path.join(__dirname, '../prisma/migrations', dir, 'migration.sql'), 'utf8'));
  }
  process.env.DATABASE_URL = 'postgresql://test:test@database.invalid:5432/isolated_test';
  process.env.nobel_book_api_DATABASE_URL = '';
  process.env.JWT_SECRET = 'isolated-commerce-test-only';
  process.env.NODE_ENV = 'test';
  process.env.VERCEL = '';
  process.env.PHONEPE_BASE_URL = 'https://mock-phonepe.invalid';
  process.env.PHONEPE_TOKEN_URL = `${process.env.PHONEPE_BASE_URL}/v1/oauth/token`;
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin, process.env.PHONEPE_BASE_URL, 'Tests must never call a real gateway');
    if (url.pathname === '/v1/oauth/token') return Response.json({ access_token: 'test-token' });
    if (url.pathname === '/checkout/v2/pay') {
      charges++;
      const body = JSON.parse(options.body);
      if (!attempts.has(body.merchantOrderId)) attempts.set(body.merchantOrderId, { state: 'PENDING', amount: body.amount, orderId: `provider-${charges}` });
      if (failInitiation) return Response.json({ message: 'Ambiguous provider failure' }, { status: 500 });
      return Response.json({ redirectUrl: `https://pay.example.test/${body.merchantOrderId}` });
    }
    const id = url.pathname.split('/')[4];
    return Response.json(attempts.get(id) || { state: 'PENDING', amount: 0 });
  };
  process.env.PHONEPE_CLIENT_ID = 'test'; process.env.PHONEPE_CLIENT_SECRET = 'test';
  process.env.PAYMENT_REDIRECT_URL = 'http://localhost:3000/payment/callback';
  const { PrismaClient } = require('../node_modules/.commerce-test-client');
  prisma = new PrismaClient({ adapter: new PrismaPGlite(db) });
  const prismaModule = require.resolve('../dist/utils/prisma');
  require.cache[prismaModule] = { id: prismaModule, filename: prismaModule, loaded: true, exports: { __esModule: true, default: prisma } };
  const { generateToken } = require('../dist/utils/auth');
  for (const role of ['author', 'buyer', 'admin', 'outsider']) {
    const user = await prisma.user.create({ data: { name: role, email: `${role}@example.test`, password: 'not-a-real-login', role: role === 'outsider' ? 'author' : role } });
    tokens[role] = generateToken(user.id);
    if (role === 'author') author = user;
    if (role === 'buyer') buyer = user;
    if (role === 'admin') admin = user;
    if (role === 'outsider') outsider = user;
  }
  app = require('../dist/app').default;
});
after(async () => {
  global.fetch = realFetch;
  if (prisma) await prisma.$disconnect();
  if (db) await db.close();
});

test('money calculations deduct print cost before commission, round in paise and exclude author-copy royalties', () => {
  const { getBookPricing, calculateOrderLine, money } = require('../dist/utils/commerce');
  const book = { title: 'Test', retailPrice: '249', printCost: '90', pageCount: 150 };
  const pricing = getBookPricing(book);
  assert.equal(pricing.platformCommission, 39.75); assert.equal(pricing.authorEarnings, 119.25);
  assert.equal(pricing.authorCopyPrice, 174.3); assert.equal(pricing.minimumSellingPrice, 128.58);
  const copies = calculateOrderLine(book, 5, 'AUTHOR_COPY');
  assert.equal(String(copies.lineTotal), '871.5'); assert.equal(String(copies.authorEarnings), '0');
  assert.throws(() => calculateOrderLine(book, 4, 'AUTHOR_COPY'));
  assert.throws(() => calculateOrderLine({ ...book, retailPrice: '100' }, 1, 'RETAIL'));
  for (const value of [true, null, '', -1, '1.001', 'NaN']) assert.throws(() => money(value));
  const pennies = getBookPricing({ ...book, retailPrice: '249.01' });
  assert.equal(pennies.authorEarnings, 119.26);
});

test('submitted revision locks before payment, stays out of queue, and verifies into review only once', async () => {
  const book = await prisma.book.create({ data: { userId: author.id, title: 'Immutable book', language: 'English', authorName: 'Test Author', description: 'Test description', authorBiography: 'Test biography', genre: 'Fiction', keywords: ['test'], termsAcceptedAt: new Date(), frontCoverUrl: 'https://example.test/cover.png',
    design: { create: { size: 'FIVE_X_EIGHT', bindingType: 'PAPERBACK', interior: 'BLACK_WHITE', paperType: 'CREAM', coverLamination: 'MATTE' } },
    chapters: { create: { title: 'First chapter', type: 'chapter', content: '<p>The exact submitted text.</p>' } } } });
  bookId = book.id;
  const submission = await call(`/books/${bookId}/submit-review`, 'author', 'POST', {}, 201);
  reviewId = submission.review.id;
  assert.equal(submission.book.status, 'PAYMENT_PENDING'); assert.equal(submission.review.status, 'PAYMENT_PENDING');
  assert.equal((await call('/reviews', 'admin')).reviews.length, 0);
  await call(`/books/${bookId}`, 'author', 'PUT', { title: 'Unsafe edit' }, 409);
  await call(`/reviews/${reviewId}/approve`, 'admin', 'POST', { pageCount: 150, printCost: 90 }, 409);
  await call(`/books/${bookId}/publishing-payment/initiate`, 'outsider', 'POST', {}, 409);
  const results = await Promise.all([call(`/books/${bookId}/publishing-payment/initiate`, 'author', 'POST', {}), call(`/books/${bookId}/publishing-payment/initiate`, 'author', 'POST', {})]);
  assert.equal(results[0].payment.id, results[1].payment.id); assert.equal(charges, 1);
  const payment = results[0].payment;
  const provider = attempts.get(payment.providerOrderId);
  provider.state = 'COMPLETED'; provider.amount = 1;
  await call(`/books/${bookId}/publishing-payment/status`, 'author', 'GET', undefined, 502);
  assert.equal((await prisma.book.findUnique({ where: { id: bookId } })).status, 'PAYMENT_PENDING');
  provider.amount = 19900;
  await Promise.all([call(`/books/${bookId}/publishing-payment/status`), call(`/books/${bookId}/publishing-payment/status`)]);
  assert.equal((await prisma.book.findUnique({ where: { id: bookId } })).status, 'IN_REVIEW');
  assert.equal((await call('/reviews', 'admin')).reviews.length, 1);
  assert.equal(await prisma.bookStatusEvent.count({ where: { bookId, newStatus: 'IN_REVIEW' } }), 1);
  await call(`/books/${bookId}/publish`, 'author', 'POST', { retailPrice: 249 }, 409);
});

test('approval requires print cost, author publishes with a safe price and exact approved revision', async () => {
  await call(`/reviews/${reviewId}/approve`, 'buyer', 'POST', { pageCount: 150, printCost: 90 }, 403);
  await call(`/reviews/${reviewId}/approve`, 'admin', 'POST', {}, 400);
  const approved = await call(`/reviews/${reviewId}/approve`, 'admin', 'POST', { pageCount: 150, printCost: '90.00', notes: 'Ready for readers' });
  assert.equal(approved.book.status, 'APPROVED');
  assert.equal((await call(`/books/${bookId}/pricing`)).pricing.authorCopyMinQty, 5);
  await call(`/books/${bookId}/publish`, 'author', 'POST', { retailPrice: 100 }, 409);
  const published = await call(`/books/${bookId}/publish`, 'author', 'POST', { retailPrice: 249 });
  assert.equal(published.book.status, 'PUBLISHED');
  await call(`/books/${bookId}/publish`, 'author', 'POST', { retailPrice: 249 });
  const proof = await call(`/reviews/${reviewId}`, 'admin');
  assert.match(proof.revision.snapshot.chapters[0].content, /exact submitted/);
});

let retailOrder, copyOrder;
test('retail checkout ignores caller prices, preserves cart until paid and reuses concurrent retries', async () => {
  const cart = await prisma.cart.create({ data: { userId: buyer.id, totalQty: 2, totalPrice: 2, items: { create: { bookId, qty: 2, price: 1 } } } });
  const body = { delivery, paymentMethod: 'UPI', shippingMethod: 'STANDARD', checkoutKey: 'checkout-test-retail', totalPrice: 1, userId: outsider.id };
  const results = await Promise.all([call('/checkout', 'buyer', 'POST', body, 201), call('/checkout', 'buyer', 'POST', body, 201)]);
  retailOrder = results[0].order;
  assert.equal(retailOrder.id, results[1].order.id); assert.equal(Number(retailOrder.totalPrice), 577);
  assert.equal(retailOrder.userId, buyer.id); assert.equal(Number(retailOrder.items[0].authorEarnings), 119.25);
  assert.ok(retailOrder.items[0].revisionId); assert.equal(await prisma.cartItem.count({ where: { cartId: cart.id } }), 1);
  await call('/checkout', 'buyer', 'POST', { ...body, delivery: { ...delivery, city: 'Delhi' } }, 400);
  await call(`/orders/${retailOrder.id}/payment/status`, 'outsider', 'GET', undefined, 404);
  await call(`/orders/${retailOrder.id}/fulfilment`, 'admin', 'PATCH', { status: 'PRINTING' }, 409);
  const started = await call(`/orders/${retailOrder.id}/payment/initiate`, 'buyer', 'POST', {});
  const retry = await call(`/orders/${retailOrder.id}/payment/initiate`, 'buyer', 'POST', {});
  assert.equal(started.payment.id, retry.payment.id); assert.equal(charges, 2);
  attempts.get(started.payment.providerOrderId).state = 'COMPLETED';
  await Promise.all([call(`/orders/${retailOrder.id}/payment/status`, 'buyer'), call(`/orders/${retailOrder.id}/payment/status`, 'buyer')]);
  assert.equal((await prisma.order.findUnique({ where: { id: retailOrder.id } })).status, 'PAID');
  assert.equal(await prisma.cartItem.count({ where: { cartId: cart.id } }), 0);
  assert.equal((await call(`/books/public/${bookId}`, 'buyer')).retailCopiesSold, 2);
});

test('author copies require owner and minimum five, discount 30%, never earn royalties or count as sales', async () => {
  await call(`/books/${bookId}/author-copies/quote`, 'author', 'POST', { quantity: 4 }, 400);
  await call(`/books/${bookId}/author-copies/quote`, 'outsider', 'POST', { quantity: 5 }, 403);
  const quote = await call(`/books/${bookId}/author-copies/quote`, 'author', 'POST', { quantity: 5 });
  assert.equal(Number(quote.quote.unitPrice), 174.3);
  const body = { delivery, quantity: 5, paymentMethod: 'CARD', shippingMethod: 'STANDARD', checkoutKey: 'author-copies-key' };
  copyOrder = (await call(`/books/${bookId}/author-copies/orders`, 'author', 'POST', body, 201)).order;
  assert.equal(Number(copyOrder.totalPrice), 950.5); assert.equal(Number(copyOrder.items[0].authorEarnings), 0);
  assert.equal((await call(`/books/${bookId}/author-copies/orders`, 'author', 'POST', body, 201)).order.id, copyOrder.id);
  const started = await call(`/orders/${copyOrder.id}/payment/initiate`, 'author', 'POST', {});
  attempts.get(started.payment.providerOrderId).state = 'COMPLETED';
  await call(`/orders/${copyOrder.id}/payment/status`);
  assert.equal((await call(`/books/public/${bookId}`, 'buyer')).retailCopiesSold, 2);
});

test('fulfilment enforces payment, stage ordering, tracking, role checks and immutable print proof', async () => {
  await call('/orders/fulfilment', 'buyer', 'GET', undefined, 403);
  assert.equal((await call('/orders/fulfilment', 'admin')).orders.length, 2);
  await call(`/orders/${retailOrder.id}/fulfilment`, 'admin', 'PATCH', { status: 'SHIPPED', carrier: 'Test', trackingNumber: '1' }, 409);
  await call(`/orders/${retailOrder.id}/fulfilment`, 'admin', 'PATCH', { status: 'PRINTING' });
  await call(`/orders/${retailOrder.id}/fulfilment`, 'admin', 'PATCH', { status: 'SHIPPED' }, 409);
  await call(`/orders/${retailOrder.id}/fulfilment`, 'admin', 'PATCH', { status: 'SHIPPED', carrier: 'Test', trackingNumber: 'TRACK123', trackingUrl: 'https://example.test/track/123' });
  await call(`/orders/${retailOrder.id}/fulfilment`, 'admin', 'PATCH', { status: 'DELIVERED' });
  const proof = await call(`/orders/${retailOrder.id}/items/${retailOrder.items[0].id}/proof`, 'admin');
  assert.match(proof.revision.snapshot.chapters[0].content, /exact submitted/);
  const order = (await call(`/orders/${retailOrder.id}`, 'buyer')).order;
  assert.equal(order.trackingNumber, 'TRACK123');
});

test('paid resubmissions are free, changes do not alter purchased revisions or prices', async () => {
  await call(`/books/${bookId}/revise`, 'author', 'POST', {});
  await call(`/books/${bookId}`, 'author', 'PUT', { title: 'Revised title' });
  const next = await call(`/books/${bookId}/submit-review`, 'author', 'POST', {}, 201);
  assert.equal(next.book.status, 'IN_REVIEW'); assert.equal(next.review.status, 'SUBMITTED');
  assert.equal(await prisma.publishingPayment.count({ where: { bookId } }), 1);
  const proof = await call(`/orders/${retailOrder.id}/items/${retailOrder.items[0].id}/proof`, 'admin');
  assert.equal(proof.revision.snapshot.book.title, 'Immutable book');
  await call(`/reviews/${next.review.id}/request-changes`, 'admin', 'POST', { notes: 'Please fix the ending.' });
  const again = await call(`/books/${bookId}/submit-review`, 'author', 'POST', {}, 201);
  assert.equal(again.book.status, 'IN_REVIEW');
  await call(`/reviews/${again.review.id}/approve`, 'admin', 'POST', { printCost: 90, pageCount: 150 });
  await call(`/books/${bookId}/publish`, 'author', 'POST', { retailPrice: 249 });
});

test('bestseller starts at 1000 verified retail copies and excludes refunded/cancelled orders', async () => {
  const original = await prisma.order.findUnique({ where: { id: retailOrder.id } });
  await prisma.orderItem.update({ where: { id: retailOrder.items[0].id }, data: { qty: 1000 } });
  assert.equal((await call(`/books/public/${bookId}`, 'buyer')).salesBadge, 'Bestseller');
  await prisma.order.update({ where: { id: retailOrder.id }, data: { status: 'CANCELLED' } });
  assert.equal((await call(`/books/public/${bookId}`, 'buyer')).retailCopiesSold, 0);
  await prisma.order.update({ where: { id: retailOrder.id }, data: { status: original.status } });
  await prisma.payment.updateMany({ where: { orderId: retailOrder.id }, data: { status: 'REFUNDED' } });
  assert.equal((await call(`/books/public/${bookId}`, 'buyer')).retailCopiesSold, 0);
});

test('ambiguous gateway failures stay pending and cannot create another charge; verified failures permit retry', async () => {
  const body = { delivery, quantity: 5, paymentMethod: 'UPI', shippingMethod: 'STANDARD', checkoutKey: 'ambiguous-attempt' };
  const order = (await call(`/books/${bookId}/author-copies/orders`, 'author', 'POST', body, 201)).order;
  failInitiation = true;
  const started = await call(`/orders/${order.id}/payment/initiate`, 'author', 'POST', {});
  const count = charges;
  assert.equal(started.payment.status, 'PENDING'); assert.equal(started.gateway.redirectUrl, null);
  await call(`/orders/${order.id}/payment/initiate`, 'author', 'POST', {});
  assert.equal(charges, count);
  attempts.get(started.payment.providerOrderId).state = 'FAILED';
  failInitiation = false;
  const retried = await call(`/orders/${order.id}/payment/initiate`, 'author', 'POST', {});
  assert.notEqual(retried.payment.id, started.payment.id); assert.equal(charges, count + 1);
});


test('authenticated payment and refund webhooks are idempotent and ignore forged browser claims', async () => {
  const { createHash } = require('node:crypto');
  process.env.PHONEPE_WEBHOOK_USERNAME = 'test-webhook';
  process.env.PHONEPE_WEBHOOK_PASSWORD = 'test-secret';
  const authorization = createHash('sha256').update('test-webhook:test-secret').digest('hex');
  const order = (await call(`/books/${bookId}/author-copies/orders`, 'author', 'POST', { delivery, quantity: 5, paymentMethod: 'UPI', shippingMethod: 'STANDARD', checkoutKey: 'webhook-test-order' }, 201)).order;
  const start = await call(`/orders/${order.id}/payment/initiate`, 'author', 'POST', {});
  const payload = { merchantOrderId: start.payment.providerOrderId, orderId: 'webhook-provider', state: 'COMPLETED', amount: 95050 };
  const body = { event: 'checkout.order.completed', payload };
  await call('/payments/phonepe/webhook', 'buyer', 'POST', body, 401);
  assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).status, 'PENDING');
  await call('/payments/phonepe/webhook', 'buyer', 'POST', body, 200, { authorization });
  await call('/payments/phonepe/webhook', 'buyer', 'POST', body, 200, { authorization });
  assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).status, 'PAID');
  const refund = { event: 'pg.refund.completed', payload: { originalMerchantOrderId: start.payment.providerOrderId, refundId: 'test-refund', state: 'COMPLETED', amount: 95050 } };
  await call('/payments/phonepe/webhook', 'buyer', 'POST', refund, 200, { authorization });
  await call('/payments/phonepe/webhook', 'buyer', 'POST', refund, 200, { authorization });
  assert.equal((await prisma.payment.findUnique({ where: { id: start.payment.id } })).status, 'REFUNDED');
  await call(`/orders/${order.id}/fulfilment`, 'admin', 'PATCH', { status: 'PRINTING' }, 409);
  await call('/payments/phonepe/webhook', 'buyer', 'POST', body, 200, { authorization });
  assert.equal((await prisma.payment.findUnique({ where: { id: start.payment.id } })).status, 'REFUNDED');
});

test('legacy unpaid review migration preserves snapshots and requeues only after payment', async () => {
  const legacy = await PGlite.create();
  try {
    await legacy.exec(fs.readFileSync(path.join(__dirname, '../prisma/migrations/20261015090000_postgres_baseline/migration.sql'), 'utf8'));
    await legacy.exec(`INSERT INTO "User" (id,name,email,password) VALUES (1,'Legacy','legacy@example.test','unused');
      INSERT INTO "Book" (id,"userId",title,language,"authorName",status,"updatedAt") VALUES (1,1,'Unpaid','English','Legacy','IN_REVIEW',NOW()), (2,1,'Paid','English','Legacy','APPROVED',NOW());
      INSERT INTO "BookRevision" (id,"bookId",version,snapshot,"contentHash") VALUES (1,1,1,'{"original":true}','hash-1'),(2,2,1,'{"original":true}','hash-2');
      INSERT INTO "BookReview" (id,"bookId","revisionId","submittedById",status) VALUES (1,1,1,1,'SUBMITTED'),(2,2,2,1,'APPROVED');
      INSERT INTO "PublishingPayment" ("bookId","revisionId","userId",amount,currency,status,"updatedAt") VALUES (2,2,1,199,'INR','PAID',NOW());`);
    for (const name of ['20261016090000_commerce', '20261016091000_review_fee_transition']) await legacy.exec(fs.readFileSync(path.join(__dirname, '../prisma/migrations', name, 'migration.sql'), 'utf8'));
    const rows = (await legacy.query('SELECT id,status FROM "Book" ORDER BY id')).rows;
    assert.deepEqual(rows, [{ id: 1, status: 'PAYMENT_PENDING' }, { id: 2, status: 'APPROVED' }]);
    assert.equal((await legacy.query('SELECT status FROM "BookReview" WHERE id = 1')).rows[0].status, 'PAYMENT_PENDING');
    assert.deepEqual((await legacy.query('SELECT snapshot FROM "BookRevision" WHERE id = 1')).rows[0].snapshot, { original: true });
  } finally { await legacy.close(); }
});

test('staff sign in is separate and admin manuscript mutations are forbidden', async () => {
  const hash = await require('bcrypt').hash('isolated-login-password', 4);
  await prisma.user.updateMany({ where: { id: { in: [admin.id, author.id, buyer.id] } }, data: { password: hash } });
  const credentials = { email: admin.email, password: 'isolated-login-password' };
  assert.equal((await call('/auth/admin/login', 'admin', 'POST', credentials)).user.role, 'admin');
  await call('/auth/login', 'admin', 'POST', credentials, 403);
  await call('/auth/admin/login', 'author', 'POST', { ...credentials, email: author.email }, 403);
  await call('/auth/admin/login', 'buyer', 'POST', { ...credentials, email: buyer.email }, 403);
  await call('/auth/admin/login', 'admin', 'POST', { ...credentials, password: 'incorrect' }, 401);
  assert.equal((await call('/auth/login', 'author', 'POST', { ...credentials, email: author.email, accountType: 'author' })).user.role, 'author');
  await call('/auth/login', 'author', 'POST', { ...credentials, email: author.email, accountType: 'buyer' }, 403);
  for (const [route, method] of [['/books', 'POST'], [`/books/${bookId}`, 'PUT'], [`/books/${bookId}/cover-design`, 'PUT'], [`/chapters/${bookId}`, 'POST'], [`/books/${bookId}/publish`, 'POST']]) {
    await call(route, 'admin', method, {}, 403);
  }
});

test('admin payments desk enforces roles, pagination, summaries and provider-only verification', async () => {
  for (const role of ['author', 'buyer']) {
    await call('/admin/payments', role, 'GET', undefined, 403);
    await call('/admin/payments/order/1/verify', role, 'POST', {}, 403);
  }
  for (const query of ['flow=invalid', 'status=invalid', 'page=-1', 'page=1.5']) await call(`/admin/payments?${query}`, 'admin', 'GET', undefined, 400);
  const fees = await call('/admin/payments?flow=review&status=PAID', 'admin');
  assert.equal(fees.payments.length, 1); assert.equal(Number(fees.summary.find(row => row.status === 'PAID')._sum.amount), 199);
  assert.equal(fees.payments[0].user.email, author.email);
  assert.equal(fees.payments[0].user.password, undefined);
  const all = await call('/admin/payments?flow=order', 'admin');
  assert.equal(all.total, await prisma.payment.count());
  assert.equal((await call('/admin/payments?flow=order&page=2', 'admin')).payments.length, 0);
  const pending = await prisma.payment.findFirst({ where: { status: 'PENDING' }, orderBy: { id: 'desc' } });
  const count = charges;
  const result = await call(`/admin/payments/order/${pending.id}/verify`, 'admin', 'POST', { status: 'PAID' });
  assert.equal(result.payment.status, 'PENDING', 'A browser claim cannot mark a payment paid');
  assert.equal(charges, count, 'Verification must never initiate a charge');
  const attempt = attempts.get(pending.providerOrderId);
  attempt.state = 'COMPLETED'; attempt.amount = 1;
  await call(`/admin/payments/order/${pending.id}/verify`, 'admin', 'POST', {}, 502);
  attempt.amount = Number(pending.amount) * 100;
  assert.equal((await call(`/admin/payments/order/${pending.id}/verify`, 'admin', 'POST', {})).payment.status, 'PAID');
  assert.equal((await prisma.order.findUnique({ where: { id: pending.orderId } })).status, 'PAID');
  await call('/admin/payments/order/99999/verify', 'admin', 'POST', {}, 404);
});

test('author insights use paid retail snapshots, include archived titles and isolate authors', async () => {
  await call('/author/dashboard', 'buyer', 'GET', undefined, 403);
  await call('/author/dashboard', 'admin', 'GET', undefined, 403);
  const baseline = await call('/author/dashboard');
  const title = await prisma.book.create({ data: { userId: author.id, title: 'Archived sales', authorName: 'Author', language: 'English', deletedAt: new Date(), retailPrice: 999 } });
  const otherTitle = await prisma.book.create({ data: { userId: outsider.id, title: 'Other author', authorName: 'Other', language: 'English' } });
  const template = await prisma.order.findUnique({ where: { id: retailOrder.id } });
  async function sale({ book = title.id, kind = 'RETAIL', status = 'PAID', paymentStatus = 'PAID', provider = 'PHONEPE', ref = true, earnings = '11.11', qty = 2 } = {}) {
    return prisma.order.create({ data: { ...template, id: undefined, checkoutKey: null, kind, status,
      items: { create: { bookId: book, title: 'Purchased title', qty, unitPrice: 30, lineTotal: 30 * qty, authorEarnings: earnings } },
      payments: { create: { userId: buyer.id, amount: 60, method: 'UPI', status: paymentStatus, provider, providerRef: ref ? `insights-${require('node:crypto').randomUUID()}` : null } },
    } });
  }
  await sale(); await sale({ earnings: null, qty: 1 });
  await sale({ kind: 'AUTHOR_COPY' }); await sale({ status: 'CANCELLED' });
  await sale({ paymentStatus: 'REFUNDED' }); await sale({ paymentStatus: 'PENDING' });
  await sale({ provider: 'UNVERIFIED' }); await sale({ ref: false });
  await sale({ book: otherTitle.id });
  const summary = await call('/author/dashboard');
  assert.equal(summary.retailCopiesSold, baseline.retailCopiesSold + 3);
  assert.equal(Number(summary.accruedEarnings), Number(baseline.accruedEarnings) + 22.22);
  assert.equal(summary.missingEarningsSnapshots, baseline.missingEarningsSnapshots + 1);
  assert.equal(summary.books.find(row => row.bookId === title.id).revenue, '90.00');
  assert.equal(summary.books.some(row => row.bookId === otherTitle.id), false);
  assert.equal((await call('/author/dashboard', 'outsider')).retailCopiesSold, 2);
});

let longBookId;
test('chapter creation scales past ten chapters without rewriting manuscript bodies', async () => {
  const book = await prisma.book.create({ data: { userId: author.id, title: 'Long Hindi manuscript', authorName: 'Test', language: 'Hindi' } });
  longBookId = book.id;
  const oldDate = new Date('2026-01-01T00:00:00Z');
  await prisma.bookChapter.createMany({ data: Array.from({ length: 40 }, (_, index) => ({ bookId: book.id, title: `Chapter ${index + 1}`, type: 'chapter', position: index * 2,
    content: `<p>${'एक नई कहानी। '.repeat(500)}</p>`, updatedAt: oldDate })) });
  const before = await prisma.bookChapter.findMany({ where: { bookId: book.id }, orderBy: { position: 'asc' } });
  // Simulate the per-query latency that makes a row-by-row reorder expire on
  // hosted databases. Bulk SQL must finish within a short interactive budget.
  const realTransaction = prisma.$transaction.bind(prisma);
  prisma.$transaction = (operation, options) => realTransaction(tx => operation(new Proxy(tx, {
    get(target, property) {
      if (property === 'bookChapter') return new Proxy(target.bookChapter, {
        get(model, key) {
          if (key === 'update') return async args => { await new Promise(resolve => setTimeout(resolve, 70)); return model.update(args); };
          return model[key];
        },
      });
      const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
    },
  })), { ...options, timeout: 1000 });
  let appended;
  try { appended = await call(`/chapters/${book.id}`, 'author', 'POST', { title: 'Chapter 41', type: 'chapter', content: '' }, 201, { 'idempotency-key': 'long-chapter-append' }); }
  finally { prisma.$transaction = realTransaction; }
  assert.equal(appended.position, 40);
  const originals = await prisma.bookChapter.findMany({ where: { id: { in: before.map(item => item.id) } }, orderBy: { id: 'asc' } });
  for (const item of originals) {
    assert.equal(item.content, before.find(old => old.id === item.id).content);
    assert.equal(item.updatedAt.toISOString(), oldDate.toISOString(), 'Adding a chapter must not make existing manuscripts look edited');
  }
  const added = await call(`/chapters/${book.id}`, 'author', 'POST', { title: 'Inserted section', type: 'section', content: '', afterChapterId: before[4].id }, 201, { 'idempotency-key': 'long-section-insert' });
  const ordered = await call(`/chapters/${book.id}`);
  assert.equal(ordered[5].id, added.id);
  assert.deepEqual(ordered.map(item => item.position), Array.from({ length: 42 }, (_, index) => index));
  assert.deepEqual(ordered.filter(item => item.id !== added.id && item.id !== appended.id).map(item => item.id), before.map(item => item.id));
});

test('chapter retries are idempotent, authorization and stale-anchor errors remain safe', async () => {
  const original = await prisma.bookChapter.findFirst({ where: { bookId: longBookId }, orderBy: { position: 'asc' } });
  const payload = { title: 'Retry-safe chapter', type: 'chapter', content: 'A new beginning', afterChapterId: original.id };
  const headers = { 'idempotency-key': 'same-chapter-request' };
  const first = await call(`/chapters/${longBookId}`, 'author', 'POST', payload, 201, headers);
  const second = await call(`/chapters/${longBookId}`, 'author', 'POST', payload, 201, headers);
  assert.equal(first.id, second.id);
  assert.equal(await prisma.bookChapter.count({ where: { bookId: longBookId, creationKey: headers['idempotency-key'] } }), 1);
  await call(`/chapters/${longBookId}`, 'author', 'POST', { ...payload, title: 'Different operation' }, 409, headers);
  await call(`/chapters/${longBookId}`, 'outsider', 'POST', payload, 403, headers);
  await call(`/chapters/${longBookId}`, 'buyer', 'POST', payload, 403, headers);
  const invalid = await call(`/chapters/${longBookId}`, 'author', 'POST', { ...payload, afterChapterId: 999999 }, 409, { 'idempotency-key': 'stale-anchor-request' });
  assert.equal(invalid.code, 'CHAPTER_LIST_CHANGED');
  await call(`/chapters/${longBookId}`, 'author', 'POST', payload, 400, { 'idempotency-key': 'bad key' });
  await prisma.book.update({ where: { id: longBookId }, data: { status: 'IN_REVIEW' } });
  const locked = await call(`/chapters/${longBookId}`, 'author', 'POST', payload, 409);
  assert.equal(locked.code, 'BOOK_LOCKED');
});

async function reviewReadyBook() {
  return prisma.book.create({ data: { userId: author.id, title: 'Long review manuscript', language: 'Hindi', authorName: 'Test Author', description: 'A complete test book', authorBiography: 'Test biography', categories: ['Fiction'], keywords: ['कहानी'], termsAcceptedAt: new Date(), frontCoverUrl: 'https://example.test/cover.png',
    design: { create: { size: 'FIVE_X_EIGHT', bindingType: 'PAPERBACK', interior: 'BLACK_WHITE', paperType: 'CREAM', coverLamination: 'MATTE' } },
    chapters: { create: Array.from({ length: 40 }, (_, position) => ({ title: `अध्याय ${position + 1}`, type: 'chapter', position, content: `<p>${'एक नई कहानी। '.repeat(1000)}</p>` })) },
  } });
}

test('large review submissions prepare bodies outside the transaction and retries reuse the locked submission', async () => {
  const book = await reviewReadyBook();
  const realTransaction = prisma.$transaction.bind(prisma);
  let preparedOutside = false;
  const findBook = prisma.book.findFirst;
  prisma.book.findFirst = async args => {
    if (args.include?.chapters) { preparedOutside = true; await new Promise(resolve => setTimeout(resolve, 100)); }
    return findBook.call(prisma.book, args);
  };
  prisma.$transaction = (operation, options) => {
    assert.ok(preparedOutside, 'Manuscript reading/preparation must happen before the write transaction');
    assert.equal(options.timeout, 15000, 'Submission needs an explicit bounded budget for hosted database latency');
    return realTransaction(tx => operation(new Proxy(tx, {
      get(target, property) {
        if (property === 'book') return new Proxy(target.book, { get(model, key) {
          if (key === 'findFirst') return args => { assert.equal(args.include, undefined, 'Do not re-read all chapter bodies under the lock'); return model.findFirst(args); };
          return model[key];
        } });
        if (property === 'bookRevision') return new Proxy(target.bookRevision, { get(model, key) {
          if (key === 'create') return args => { assert.ok(args.select && !args.select.snapshot, 'Do not return the full immutable manuscript on creation'); return model.create(args); };
          return model[key];
        } });
        const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
      },
    })), options);
  };
  let first;
  try { first = await call(`/books/${book.id}/submit-review`, 'author', 'POST', {}, 201); }
  finally { prisma.$transaction = realTransaction; prisma.book.findFirst = findBook; }
  assert.equal(first.book.status, 'PAYMENT_PENDING');
  assert.equal(first.revision.snapshot, undefined);
  const proof = await prisma.bookRevision.findUnique({ where: { id: first.revision.id } });
  assert.equal(proof.snapshot.chapters.length, 40);
  assert.match(proof.snapshot.chapters[39].content, /एक नई कहानी/);
  const again = await call(`/books/${book.id}/submit-review`, 'author', 'POST', {}, 201);
  assert.equal(again.review.id, first.review.id); assert.equal(again.alreadySubmitted, true);
  assert.equal(await prisma.bookRevision.count({ where: { bookId: book.id } }), 1);
  assert.equal(await prisma.bookStatusEvent.count({ where: { bookId: book.id } }), 1);
  assert.equal(await prisma.publishingPayment.count({ where: { bookId: book.id } }), 0);
  await call(`/books/${book.id}/submit-review`, 'outsider', 'POST', {}, 403);
  await call(`/books/${book.id}/submit-review`, 'buyer', 'POST', {}, 403);
});

test('submission rejects a draft changed after snapshot preparation without locking or saving a stale revision', async () => {
  const book = await reviewReadyBook();
  const findBook = prisma.book.findFirst;
  let edited = false;
  prisma.book.findFirst = async args => {
    const result = await findBook.call(prisma.book, args);
    if (args.include?.chapters && !edited) {
      edited = true;
      await prisma.book.update({ where: { id: book.id }, data: { title: 'A concurrent edit', updatedAt: new Date(result.updatedAt.getTime() + 1000) } });
    }
    return result;
  };
  let response;
  try { response = await call(`/books/${book.id}/submit-review`, 'author', 'POST', {}, 409); }
  finally { prisma.book.findFirst = findBook; }
  assert.equal(response.code, 'BOOK_CHANGED');
  assert.equal((await prisma.book.findUnique({ where: { id: book.id } })).status, 'DRAFT');
  assert.equal(await prisma.bookRevision.count({ where: { bookId: book.id } }), 0);
});

test('submission timeout rolls back all writes, offers safe recovery and succeeds once on retry', async () => {
  const book = await reviewReadyBook();
  const realTransaction = prisma.$transaction.bind(prisma);
  prisma.$transaction = (operation, options) => realTransaction(tx => operation(new Proxy(tx, {
    get(target, property) {
      if (property === 'bookStatusEvent') return new Proxy(target.bookStatusEvent, { get(model, key) {
        if (key === 'create') return () => { throw Object.assign(new Error('Private database timeout details'), { code: 'P2028' }); };
        return model[key];
      } });
      const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
    },
  })), options);
  let failed;
  try { failed = await call(`/books/${book.id}/submit-review`, 'author', 'POST', {}, 503); }
  finally { prisma.$transaction = realTransaction; }
  assert.equal(failed.code, 'SUBMISSION_UNAVAILABLE'); assert.equal(failed.retryable, true);
  assert.doesNotMatch(JSON.stringify(failed), /Private|Prisma|P2028/);
  assert.equal((await prisma.book.findUnique({ where: { id: book.id } })).status, 'DRAFT');
  assert.equal(await prisma.bookRevision.count({ where: { bookId: book.id } }), 0);
  assert.equal(await prisma.bookReview.count({ where: { bookId: book.id } }), 0);
  assert.equal(await prisma.bookStatusEvent.count({ where: { bookId: book.id } }), 0);
  await call(`/books/${book.id}/submit-review`, 'author', 'POST', {}, 201);
  assert.equal(await prisma.bookReview.count({ where: { bookId: book.id } }), 1);
});
