const express = require('express');
const { createStore } = require('./store');

function createApp(customStore) {
  const app = express();
  const store = customStore || createStore();

  app.use(express.json());

  function auth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.replace('Bearer ', '').trim();
    const user = store.getUserByToken(token);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = user;
    req.token = token;
    next();
  }

  app.post('/auth/register', (req, res) => {
    try {
      const { email, password, name } = req.body || {};
      const user = store.register({ email, password, name });
      return res.status(201).json({ user });
    } catch (err) {
      if (err.code === 'EMAIL_TAKEN') return res.status(409).json({ error: err.message });
      return res.status(400).json({ error: err.message });
    }
  });

  app.post('/auth/login', (req, res) => {
    try {
      const { email, password } = req.body || {};
      const session = store.login({ email, password });
      return res.json(session);
    } catch (err) {
      if (err.code === 'INVALID_CREDENTIALS') return res.status(401).json({ error: err.message });
      return res.status(400).json({ error: err.message });
    }
  });

  app.post('/auth/logout', auth, (req, res) => {
    store.logout(req.token);
    return res.status(204).send();
  });

  app.post('/households', auth, (req, res) => {
    const { name } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const household = store.createHousehold({ name, ownerId: req.user.id });
    return res.status(201).json({ household });
  });

  app.post('/households/:householdId/invites', auth, (req, res) => {
    try {
      const invite = store.createInvite({
        householdId: req.params.householdId,
        email: req.body?.email,
        invitedByUserId: req.user.id
      });
      return res.status(201).json({ invite: { code: invite.code, email: invite.email, status: invite.status } });
    } catch (err) {
      if (err.code === 'HOUSEHOLD_NOT_FOUND') return res.status(404).json({ error: err.message });
      if (err.code === 'FORBIDDEN') return res.status(403).json({ error: err.message });
      return res.status(400).json({ error: err.message });
    }
  });

  app.post('/invites/:code/accept', auth, (req, res) => {
    try {
      const result = store.acceptInvite({ code: req.params.code, userId: req.user.id });
      return res.status(200).json(result);
    } catch (err) {
      if (err.code === 'INVALID_INVITE') return res.status(404).json({ error: err.message });
      if (err.code === 'INVITE_EMAIL_MISMATCH') return res.status(403).json({ error: err.message });
      return res.status(400).json({ error: err.message });
    }
  });

  app.get('/households/:householdId/residents', auth, (req, res) => {
    const residents = store.listResidents(req.params.householdId);
    return res.json({ residents });
  });

  return app;
}

module.exports = { createApp };
