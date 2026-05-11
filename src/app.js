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

  function mapStoreError(err, res) {
    if (err.code === 'HOUSEHOLD_NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.code === 'FORBIDDEN') return res.status(403).json({ error: err.message });
    if (err.code === 'BILL_NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.code === 'SHOPPING_ITEM_NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.code === 'CHORE_NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.code === 'MONTH_ALREADY_CLOSED') return res.status(409).json({ error: err.message });
    if (err.code === 'EMAIL_TAKEN') return res.status(409).json({ error: err.message });
    if (err.code === 'INVALID_CREDENTIALS') return res.status(401).json({ error: err.message });
    if (err.code === 'INVALID_INVITE') return res.status(404).json({ error: err.message });
    if (err.code === 'INVITE_EMAIL_MISMATCH') return res.status(403).json({ error: err.message });
    if (err.code === 'UNSUPPORTED_EXPORT_FORMAT') return res.status(400).json({ error: err.message });
    return res.status(400).json({ error: err.message });
  }

  app.post('/auth/register', (req, res) => {
    try {
      const { email, password, name } = req.body || {};
      const user = store.register({ email, password, name });
      return res.status(201).json({ user });
    } catch (err) {
      return mapStoreError(err, res);
    }
  });

  app.post('/auth/login', (req, res) => {
    try {
      const { email, password } = req.body || {};
      const session = store.login({ email, password });
      return res.json(session);
    } catch (err) {
      return mapStoreError(err, res);
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
      return mapStoreError(err, res);
    }
  });

  app.post('/invites/:code/accept', auth, (req, res) => {
    try {
      const result = store.acceptInvite({ code: req.params.code, userId: req.user.id });
      return res.status(200).json(result);
    } catch (err) {
      return mapStoreError(err, res);
    }
  });

  app.get('/households/:householdId/residents', auth, (req, res) => {
    const residents = store.listResidents(req.params.householdId);
    return res.json({ residents });
  });

  app.post('/households/:householdId/shopping-items', auth, (req, res) => {
    try {
      const item = store.createShoppingItem({
        householdId: req.params.householdId,
        actorUserId: req.user.id,
        text: req.body?.text
      });
      return res.status(201).json({ item });
    } catch (err) {
      return mapStoreError(err, res);
    }
  });

  app.get('/households/:householdId/shopping-items', auth, (req, res) => {
    try {
      const items = store.listShoppingItems({ householdId: req.params.householdId, actorUserId: req.user.id });
      return res.json({ items });
    } catch (err) {
      return mapStoreError(err, res);
    }
  });

  app.patch('/households/:householdId/shopping-items/:itemId', auth, (req, res) => {
    try {
      const item = store.updateShoppingItem({
        householdId: req.params.householdId,
        itemId: req.params.itemId,
        actorUserId: req.user.id,
        checked: req.body?.checked
      });
      return res.json({ item });
    } catch (err) {
      return mapStoreError(err, res);
    }
  });

  app.post('/households/:householdId/chores', auth, (req, res) => {
    try {
      const chore = store.createChore({
        householdId: req.params.householdId,
        actorUserId: req.user.id,
        title: req.body?.title,
        ownerUserId: req.body?.ownerUserId,
        dueDate: req.body?.dueDate
      });
      return res.status(201).json({ chore });
    } catch (err) {
      return mapStoreError(err, res);
    }
  });

  app.patch('/households/:householdId/chores/:choreId', auth, (req, res) => {
    try {
      const chore = store.updateChore({
        householdId: req.params.householdId,
        choreId: req.params.choreId,
        actorUserId: req.user.id,
        status: req.body?.status
      });
      return res.json({ chore });
    } catch (err) {
      return mapStoreError(err, res);
    }
  });

  app.post('/households/:householdId/bills', auth, (req, res) => {
    try {
      const bill = store.createBill({
        householdId: req.params.householdId,
        createdByUserId: req.user.id,
        title: req.body?.title,
        amountCents: req.body?.amountCents,
        dueDate: req.body?.dueDate,
        type: req.body?.type,
        responsibleUserId: req.body?.responsibleUserId
      });
      return res.status(201).json({ bill });
    } catch (err) {
      return mapStoreError(err, res);
    }
  });

  app.get('/households/:householdId/bills', auth, (req, res) => {
    try {
      const bills = store.listBills({ householdId: req.params.householdId, actorUserId: req.user.id });
      return res.json({ bills });
    } catch (err) {
      return mapStoreError(err, res);
    }
  });

  app.patch('/households/:householdId/bills/:billId', auth, (req, res) => {
    try {
      const bill = store.updateBill({
        householdId: req.params.householdId,
        billId: req.params.billId,
        actorUserId: req.user.id,
        patch: req.body || {}
      });
      return res.json({ bill });
    } catch (err) {
      return mapStoreError(err, res);
    }
  });

  app.delete('/households/:householdId/bills/:billId', auth, (req, res) => {
    try {
      store.deleteBill({
        householdId: req.params.householdId,
        billId: req.params.billId,
        actorUserId: req.user.id
      });
      return res.status(204).send();
    } catch (err) {
      return mapStoreError(err, res);
    }
  });

  app.post('/households/:householdId/expenses', auth, (req, res) => {
    try {
      const expense = store.createExpense({
        householdId: req.params.householdId,
        actorUserId: req.user.id,
        description: req.body?.description,
        amountCents: req.body?.amountCents,
        paidByUserId: req.body?.paidByUserId,
        participantUserIds: req.body?.participantUserIds
      });
      return res.status(201).json({ expense });
    } catch (err) {
      return mapStoreError(err, res);
    }
  });

  app.get('/households/:householdId/expenses', auth, (req, res) => {
    try {
      const expenses = store.listExpenses({ householdId: req.params.householdId, actorUserId: req.user.id });
      return res.json({ expenses });
    } catch (err) {
      return mapStoreError(err, res);
    }
  });

  app.get('/households/:householdId/settlements', auth, (req, res) => {
    try {
      const settlement = store.calculateSettlement({ householdId: req.params.householdId, actorUserId: req.user.id });
      return res.json(settlement);
    } catch (err) {
      return mapStoreError(err, res);
    }
  });

  app.post('/households/:householdId/monthly-close', auth, (req, res) => {
    try {
      const close = store.closeMonth({
        householdId: req.params.householdId,
        actorUserId: req.user.id,
        month: req.body?.month
      });
      return res.status(201).json({ close });
    } catch (err) {
      return mapStoreError(err, res);
    }
  });

  app.get('/households/:householdId/monthly-close', auth, (req, res) => {
    try {
      const closes = store.listMonthlyCloses({ householdId: req.params.householdId, actorUserId: req.user.id });
      return res.json({ closes });
    } catch (err) {
      return mapStoreError(err, res);
    }
  });

  app.get('/households/:householdId/calendar', auth, (req, res) => {
    try {
      const events = store.listCalendar({ householdId: req.params.householdId, actorUserId: req.user.id });
      return res.json({ events });
    } catch (err) {
      return mapStoreError(err, res);
    }
  });

  app.get('/households/:householdId/alerts', auth, (req, res) => {
    try {
      const alerts = store.listAlerts({
        householdId: req.params.householdId,
        actorUserId: req.user.id,
        now: req.query?.now,
        windowHours: req.query?.windowHours
      });
      return res.json({ alerts });
    } catch (err) {
      return mapStoreError(err, res);
    }
  });

  app.get('/households/:householdId/dashboard', auth, (req, res) => {
    try {
      const dashboard = store.getDashboard({
        householdId: req.params.householdId,
        actorUserId: req.user.id,
        now: req.query?.now
      });
      return res.json({ dashboard });
    } catch (err) {
      return mapStoreError(err, res);
    }
  });

  app.post('/households/:householdId/bills/:billId/receipts', auth, (req, res) => {
    try {
      const receipt = store.addBillReceipt({
        householdId: req.params.householdId,
        billId: req.params.billId,
        actorUserId: req.user.id,
        receiptUrl: req.body?.url,
        note: req.body?.note
      });
      return res.status(201).json({ receipt });
    } catch (err) {
      return mapStoreError(err, res);
    }
  });

  app.get('/households/:householdId/reports/export', auth, (req, res) => {
    try {
      const format = req.query?.format || 'excel';
      const payload = store.exportFinancialReport({
        householdId: req.params.householdId,
        actorUserId: req.user.id,
        format,
        now: req.query?.now
      });
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="household-report.${format === 'excel' ? 'csv' : 'txt'}"`);
      return res.status(200).send(payload);
    } catch (err) {
      return mapStoreError(err, res);
    }
  });

  app.post('/households/:householdId/subscriptions', auth, (req, res) => {
    try {
      const subscription = store.createSubscription({
        householdId: req.params.householdId,
        actorUserId: req.user.id,
        name: req.body?.name,
        amountCents: req.body?.amountCents,
        cadenceDays: req.body?.cadenceDays,
        nextRenewalDate: req.body?.nextRenewalDate
      });
      return res.status(201).json({ subscription });
    } catch (err) {
      return mapStoreError(err, res);
    }
  });

  app.get('/households/:householdId/subscriptions', auth, (req, res) => {
    try {
      const subscriptions = store.listSubscriptions({
        householdId: req.params.householdId,
        actorUserId: req.user.id
      });
      return res.status(200).json({ subscriptions });
    } catch (err) {
      return mapStoreError(err, res);
    }
  });

  app.get('/households/:householdId/subscriptions/reminders', auth, (req, res) => {
    try {
      const reminders = store.listSubscriptionReminders({
        householdId: req.params.householdId,
        actorUserId: req.user.id,
        now: req.query?.now,
        windowDays: req.query?.windowDays
      });
      return res.status(200).json({ reminders });
    } catch (err) {
      return mapStoreError(err, res);
    }
  });

  return app;
}

module.exports = { createApp };
