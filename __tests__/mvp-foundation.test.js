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
});
