const request = require('supertest');
const { createApp } = require('../src/app');

describe('MVP foundation flows', () => {
  test('auth register/login/logout happy path and rejected login', async () => {
    const app = createApp();

    const register = await request(app).post('/auth/register').send({
      email: 'owner@example.com',
      password: 'StrongPass123',
      name: 'Owner'
    });
    expect(register.statusCode).toBe(201);

    const login = await request(app).post('/auth/login').send({
      email: 'owner@example.com',
      password: 'StrongPass123'
    });
    expect(login.statusCode).toBe(200);
    expect(login.body.token).toBeTruthy();

    const badLogin = await request(app).post('/auth/login').send({
      email: 'owner@example.com',
      password: 'wrong'
    });
    expect(badLogin.statusCode).toBe(401);

    const logout = await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${login.body.token}`);
    expect(logout.statusCode).toBe(204);

    const unauthorizedAfterLogout = await request(app)
      .post('/households')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ name: 'Casa A' });
    expect(unauthorizedAfterLogout.statusCode).toBe(401);
  });

  test('household invite join flow happy path and one invite rejection case', async () => {
    const app = createApp();

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
    await request(app).post('/auth/register').send({
      email: 'outsider@example.com',
      password: 'StrongPass123',
      name: 'Outsider'
    });

    const ownerLogin = await request(app).post('/auth/login').send({
      email: 'owner@example.com',
      password: 'StrongPass123'
    });
    const memberLogin = await request(app).post('/auth/login').send({
      email: 'member@example.com',
      password: 'StrongPass123'
    });
    const outsiderLogin = await request(app).post('/auth/login').send({
      email: 'outsider@example.com',
      password: 'StrongPass123'
    });

    const household = await request(app)
      .post('/households')
      .set('Authorization', `Bearer ${ownerLogin.body.token}`)
      .send({ name: 'Casa Principal' });
    expect(household.statusCode).toBe(201);

    const invite = await request(app)
      .post(`/households/${household.body.household.id}/invites`)
      .set('Authorization', `Bearer ${ownerLogin.body.token}`)
      .send({ email: 'member@example.com' });
    expect(invite.statusCode).toBe(201);

    const rejectWrongEmail = await request(app)
      .post(`/invites/${invite.body.invite.code}/accept`)
      .set('Authorization', `Bearer ${outsiderLogin.body.token}`);
    expect(rejectWrongEmail.statusCode).toBe(403);

    const accept = await request(app)
      .post(`/invites/${invite.body.invite.code}/accept`)
      .set('Authorization', `Bearer ${memberLogin.body.token}`);
    expect(accept.statusCode).toBe(200);

    const residents = await request(app)
      .get(`/households/${household.body.household.id}/residents`)
      .set('Authorization', `Bearer ${ownerLogin.body.token}`);
    expect(residents.statusCode).toBe(200);
    expect(residents.body.residents).toHaveLength(2);
    expect(residents.body.residents.map((r) => r.role).sort()).toEqual(['member', 'owner']);
    expect(new Set(residents.body.residents.map((r) => r.status))).toEqual(new Set(['accepted']));
  });

  test('shopping list supports add/list/check-off transitions', async () => {
    const app = createApp();

    await request(app).post('/auth/register').send({
      email: 'owner@example.com',
      password: 'StrongPass123',
      name: 'Owner'
    });
    const ownerLogin = await request(app).post('/auth/login').send({
      email: 'owner@example.com',
      password: 'StrongPass123'
    });

    const household = await request(app)
      .post('/households')
      .set('Authorization', `Bearer ${ownerLogin.body.token}`)
      .send({ name: 'Casa Principal' });

    const added = await request(app)
      .post(`/households/${household.body.household.id}/shopping-items`)
      .set('Authorization', `Bearer ${ownerLogin.body.token}`)
      .send({ text: 'Milk' });
    expect(added.statusCode).toBe(201);
    expect(added.body.item.checked).toBe(false);

    const checked = await request(app)
      .patch(`/households/${household.body.household.id}/shopping-items/${added.body.item.id}`)
      .set('Authorization', `Bearer ${ownerLogin.body.token}`)
      .send({ checked: true });
    expect(checked.statusCode).toBe(200);
    expect(checked.body.item.checked).toBe(true);
    expect(checked.body.item.checkedAt).toBeTruthy();

    const list = await request(app)
      .get(`/households/${household.body.household.id}/shopping-items`)
      .set('Authorization', `Bearer ${ownerLogin.body.token}`);
    expect(list.statusCode).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].checked).toBe(true);
  });

  test('chores, calendar, and alerts expose upcoming and overdue work', async () => {
    const app = createApp();

    await request(app).post('/auth/register').send({
      email: 'owner@example.com',
      password: 'StrongPass123',
      name: 'Owner'
    });
    const ownerLogin = await request(app).post('/auth/login').send({
      email: 'owner@example.com',
      password: 'StrongPass123'
    });

    const household = await request(app)
      .post('/households')
      .set('Authorization', `Bearer ${ownerLogin.body.token}`)
      .send({ name: 'Casa Principal' });
    const householdId = household.body.household.id;

    const now = '2026-01-01T12:00:00.000Z';
    const upcomingDue = '2026-01-01T20:00:00.000Z';
    const overdueDue = '2025-12-31T20:00:00.000Z';

    const upcomingChore = await request(app)
      .post(`/households/${householdId}/chores`)
      .set('Authorization', `Bearer ${ownerLogin.body.token}`)
      .send({
        title: 'Vacuum living room',
        ownerUserId: ownerLogin.body.user.id,
        dueDate: upcomingDue
      });
    expect(upcomingChore.statusCode).toBe(201);

    const doneChore = await request(app)
      .post(`/households/${householdId}/chores`)
      .set('Authorization', `Bearer ${ownerLogin.body.token}`)
      .send({
        title: 'Take out trash',
        ownerUserId: ownerLogin.body.user.id,
        dueDate: overdueDue
      });
    expect(doneChore.statusCode).toBe(201);

    const completeDoneChore = await request(app)
      .patch(`/households/${householdId}/chores/${doneChore.body.chore.id}`)
      .set('Authorization', `Bearer ${ownerLogin.body.token}`)
      .send({ status: 'done' });
    expect(completeDoneChore.statusCode).toBe(200);
    expect(completeDoneChore.body.chore.status).toBe('done');

    const overdueBill = await request(app)
      .post(`/households/${householdId}/bills`)
      .set('Authorization', `Bearer ${ownerLogin.body.token}`)
      .send({ title: 'Electric bill', dueDate: overdueDue });
    expect(overdueBill.statusCode).toBe(201);

    const calendar = await request(app)
      .get(`/households/${householdId}/calendar`)
      .set('Authorization', `Bearer ${ownerLogin.body.token}`);
    expect(calendar.statusCode).toBe(200);
    expect(calendar.body.events).toHaveLength(3);
    expect(new Set(calendar.body.events.map((e) => e.type))).toEqual(new Set(['chore', 'bill']));

    const alerts = await request(app)
      .get(`/households/${householdId}/alerts`)
      .query({ now, windowHours: 24 })
      .set('Authorization', `Bearer ${ownerLogin.body.token}`);
    expect(alerts.statusCode).toBe(200);
    expect(alerts.body.alerts).toHaveLength(2);
    expect(alerts.body.alerts.find((a) => a.type === 'chore').kind).toBe('upcoming');
    expect(alerts.body.alerts.find((a) => a.type === 'bill').kind).toBe('overdue');
  });
});
