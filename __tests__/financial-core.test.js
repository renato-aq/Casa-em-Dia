const request = require('supertest');
const { createApp } = require('../src/app');

async function bootstrapHousehold(app) {
  await request(app).post('/auth/register').send({
    email: 'owner@example.com',
    password: 'StrongPass123',
    name: 'Owner'
  });
  await request(app).post('/auth/register').send({
    email: 'member@example.com',
    password: 'StrongPass123',
    name: 'Member'
  });

  const ownerLogin = await request(app).post('/auth/login').send({
    email: 'owner@example.com',
    password: 'StrongPass123'
  });
  const memberLogin = await request(app).post('/auth/login').send({
    email: 'member@example.com',
    password: 'StrongPass123'
  });

  const household = await request(app)
    .post('/households')
    .set('Authorization', `Bearer ${ownerLogin.body.token}`)
    .send({ name: 'Casa Principal' });

  const invite = await request(app)
    .post(`/households/${household.body.household.id}/invites`)
    .set('Authorization', `Bearer ${ownerLogin.body.token}`)
    .send({ email: 'member@example.com' });

  await request(app)
    .post(`/invites/${invite.body.invite.code}/accept`)
    .set('Authorization', `Bearer ${memberLogin.body.token}`);

  const residents = await request(app)
    .get(`/households/${household.body.household.id}/residents`)
    .set('Authorization', `Bearer ${ownerLogin.body.token}`);

  return {
    ownerToken: ownerLogin.body.token,
    memberToken: memberLogin.body.token,
    householdId: household.body.household.id,
    ownerId: ownerLogin.body.user.id,
    memberId: memberLogin.body.user.id,
    residents: residents.body.residents
  };
}

describe('Financial core', () => {
  test('bills support pending, paid, and overdue transitions', async () => {
    const app = createApp();
    const ctx = await bootstrapHousehold(app);

    const futureDue = new Date(Date.now() + (3 * 24 * 60 * 60 * 1000)).toISOString();
    const pastDue = new Date(Date.now() - (3 * 24 * 60 * 60 * 1000)).toISOString();

    const pendingBill = await request(app)
      .post(`/households/${ctx.householdId}/bills`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        title: 'Internet',
        amountCents: 12000,
        dueDate: futureDue,
        type: 'fixed',
        responsibleUserId: ctx.ownerId
      });
    expect(pendingBill.statusCode).toBe(201);
    expect(pendingBill.body.bill.status).toBe('pending');

    const overdueBill = await request(app)
      .post(`/households/${ctx.householdId}/bills`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        title: 'Water',
        amountCents: 5000,
        dueDate: pastDue,
        type: 'variable',
        responsibleUserId: ctx.memberId
      });
    expect(overdueBill.statusCode).toBe(201);
    expect(overdueBill.body.bill.status).toBe('overdue');

    const payBill = await request(app)
      .patch(`/households/${ctx.householdId}/bills/${pendingBill.body.bill.id}`)
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ markPaid: true });
    expect(payBill.statusCode).toBe(200);
    expect(payBill.body.bill.status).toBe('paid');

    const bills = await request(app)
      .get(`/households/${ctx.householdId}/bills`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`);
    expect(bills.statusCode).toBe(200);
    expect(new Set(bills.body.bills.map((bill) => bill.status))).toEqual(new Set(['paid', 'overdue']));
  });

  test('expense splits and net settlements are computed per resident', async () => {
    const app = createApp();
    const ctx = await bootstrapHousehold(app);

    const expense = await request(app)
      .post(`/households/${ctx.householdId}/expenses`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        description: 'Groceries',
        amountCents: 3000,
        paidByUserId: ctx.ownerId,
        participantUserIds: [ctx.ownerId, ctx.memberId]
      });
    expect(expense.statusCode).toBe(201);

    const settlements = await request(app)
      .get(`/households/${ctx.householdId}/settlements`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`);

    expect(settlements.statusCode).toBe(200);
    expect(settlements.body.balances[ctx.ownerId].netCents).toBe(1500);
    expect(settlements.body.balances[ctx.memberId].netCents).toBe(-1500);
    expect(settlements.body.transfers).toEqual([
      {
        fromUserId: ctx.memberId,
        toUserId: ctx.ownerId,
        amountCents: 1500
      }
    ]);
  });

  test('monthly close creates immutable snapshot and prevents duplicate month', async () => {
    const app = createApp();
    const ctx = await bootstrapHousehold(app);

    await request(app)
      .post(`/households/${ctx.householdId}/expenses`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        description: 'Energy',
        amountCents: 4000,
        paidByUserId: ctx.memberId,
        participantUserIds: [ctx.ownerId, ctx.memberId]
      });

    const close = await request(app)
      .post(`/households/${ctx.householdId}/monthly-close`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({ month: '2026-05' });
    expect(close.statusCode).toBe(201);

    const duplicate = await request(app)
      .post(`/households/${ctx.householdId}/monthly-close`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({ month: '2026-05' });
    expect(duplicate.statusCode).toBe(409);

    const closes = await request(app)
      .get(`/households/${ctx.householdId}/monthly-close`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`);

    expect(closes.statusCode).toBe(200);
    expect(closes.body.closes).toHaveLength(1);
    expect(closes.body.closes[0].month).toBe('2026-05');
    expect(closes.body.closes[0].balances[ctx.memberId].netCents).toBe(2000);
    expect(closes.body.closes[0].balances[ctx.ownerId].netCents).toBe(-2000);
  });

  test('dashboard, receipts, exports, and recurring reminders are available', async () => {
    const app = createApp();
    const ctx = await bootstrapHousehold(app);

    const bill = await request(app)
      .post(`/households/${ctx.householdId}/bills`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        title: 'Internet',
        amountCents: 10000,
        dueDate: '2026-05-10T10:00:00.000Z',
        responsibleUserId: ctx.ownerId
      });
    expect(bill.statusCode).toBe(201);

    const receipt = await request(app)
      .post(`/households/${ctx.householdId}/bills/${bill.body.bill.id}/receipts`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({ url: 'https://files.example.com/receipt-1.jpg', note: 'Paid via bank app' });
    expect(receipt.statusCode).toBe(201);
    expect(receipt.body.receipt.url).toContain('receipt-1.jpg');

    const pay = await request(app)
      .patch(`/households/${ctx.householdId}/bills/${bill.body.bill.id}`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({ markPaid: true });
    expect(pay.statusCode).toBe(200);

    await request(app)
      .post(`/households/${ctx.householdId}/expenses`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        description: 'Market',
        amountCents: 2000,
        paidByUserId: ctx.ownerId,
        participantUserIds: [ctx.ownerId, ctx.memberId]
      });

    const sub = await request(app)
      .post(`/households/${ctx.householdId}/subscriptions`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        name: 'Streaming',
        amountCents: 1990,
        cadenceDays: 30,
        nextRenewalDate: '2026-05-20T09:00:00.000Z'
      });
    expect(sub.statusCode).toBe(201);

    const reminders = await request(app)
      .get(`/households/${ctx.householdId}/subscriptions/reminders`)
      .query({ now: '2026-05-15T09:00:00.000Z', windowDays: 10 })
      .set('Authorization', `Bearer ${ctx.ownerToken}`);
    expect(reminders.statusCode).toBe(200);
    expect(reminders.body.reminders).toHaveLength(1);
    expect(reminders.body.reminders[0].kind).toBe('upcoming');

    const dashboard = await request(app)
      .get(`/households/${ctx.householdId}/dashboard`)
      .query({ now: '2026-05-15T09:00:00.000Z' })
      .set('Authorization', `Bearer ${ctx.ownerToken}`);
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.body.dashboard.totals.monthlyExpensesCents).toBe(2000);
    expect(dashboard.body.dashboard.totals.monthlyBillsPaidCents).toBe(10000);
    expect(dashboard.body.dashboard.totals.monthlySubscriptionCents).toBe(1990);

    const exported = await request(app)
      .get(`/households/${ctx.householdId}/reports/export`)
      .query({ format: 'excel', now: '2026-05-15T09:00:00.000Z' })
      .set('Authorization', `Bearer ${ctx.ownerToken}`);
    expect(exported.statusCode).toBe(200);
    expect(exported.text).toContain('section,metric,value');
    expect(exported.text).toContain('totals,monthlyBillsPaidCents,10000');
  });
});
