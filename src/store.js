const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

function createStore() {
  const users = new Map();
  const usersByEmail = new Map();
  const sessions = new Map();
  const households = new Map();
  const membersByHousehold = new Map();
  const invites = new Map();
  const billsByHousehold = new Map();
  const expensesByHousehold = new Map();
  const monthlyClosesByHousehold = new Map();
  const shoppingItemsByHousehold = new Map();
  const choresByHousehold = new Map();
  const subscriptionsByHousehold = new Map();

  function register({ email, password, name }) {
    const normalizedEmail = String(email).trim().toLowerCase();
    if (usersByEmail.has(normalizedEmail)) {
      const err = new Error('Email already registered');
      err.code = 'EMAIL_TAKEN';
      throw err;
    }
    const user = {
      id: uuidv4(),
      email: normalizedEmail,
      name: String(name || '').trim() || normalizedEmail,
      passwordHash: bcrypt.hashSync(password, 10)
    };
    users.set(user.id, user);
    usersByEmail.set(normalizedEmail, user.id);
    return { id: user.id, email: user.email, name: user.name };
  }

  function login({ email, password }) {
    const normalizedEmail = String(email).trim().toLowerCase();
    const userId = usersByEmail.get(normalizedEmail);
    if (!userId) {
      const err = new Error('Invalid credentials');
      err.code = 'INVALID_CREDENTIALS';
      throw err;
    }
    const user = users.get(userId);
    if (!bcrypt.compareSync(password, user.passwordHash)) {
      const err = new Error('Invalid credentials');
      err.code = 'INVALID_CREDENTIALS';
      throw err;
    }
    const token = uuidv4();
    sessions.set(token, user.id);
    return {
      token,
      user: { id: user.id, email: user.email, name: user.name }
    };
  }

  function logout(token) {
    sessions.delete(token);
  }

  function getUserByToken(token) {
    const userId = sessions.get(token);
    if (!userId) return null;
    const user = users.get(userId);
    return { id: user.id, email: user.email, name: user.name };
  }

  function createHousehold({ name, ownerId }) {
    const household = { id: uuidv4(), name: String(name).trim(), ownerId };
    households.set(household.id, household);
    membersByHousehold.set(household.id, [
      {
        userId: ownerId,
        role: 'owner',
        status: 'accepted'
      }
    ]);
    return household;
  }

  function createInvite({ householdId, email, invitedByUserId }) {
    if (!households.has(householdId)) {
      const err = new Error('Household not found');
      err.code = 'HOUSEHOLD_NOT_FOUND';
      throw err;
    }
    const membership = (membersByHousehold.get(householdId) || []).find(
      (m) => m.userId === invitedByUserId
    );
    if (!membership || membership.status !== 'accepted') {
      const err = new Error('Forbidden');
      err.code = 'FORBIDDEN';
      throw err;
    }
    const invite = {
      id: uuidv4(),
      code: uuidv4().replace(/-/g, '').slice(0, 10),
      householdId,
      email: String(email).trim().toLowerCase(),
      invitedByUserId,
      status: 'pending'
    };
    invites.set(invite.code, invite);
    return invite;
  }

  function acceptInvite({ code, userId }) {
    const invite = invites.get(code);
    if (!invite || invite.status !== 'pending') {
      const err = new Error('Invite invalid');
      err.code = 'INVALID_INVITE';
      throw err;
    }
    const user = users.get(userId);
    if (!user || user.email !== invite.email) {
      const err = new Error('Invite email mismatch');
      err.code = 'INVITE_EMAIL_MISMATCH';
      throw err;
    }
    const members = membersByHousehold.get(invite.householdId) || [];
    const existing = members.find((m) => m.userId === userId);
    if (!existing) {
      members.push({ userId, role: 'member', status: 'accepted' });
      membersByHousehold.set(invite.householdId, members);
    }
    invite.status = 'accepted';
    return { householdId: invite.householdId };
  }

  function listResidents(householdId) {
    const members = membersByHousehold.get(householdId) || [];
    return members.map((member) => {
      const user = users.get(member.userId);
      return {
        userId: member.userId,
        name: user ? user.name : 'Unknown',
        email: user ? user.email : '',
        role: member.role,
        status: member.status
      };
    });
  }

  function listAcceptedResidentIds(householdId) {
    return listResidents(householdId)
      .filter((resident) => resident.status === 'accepted')
      .map((resident) => resident.userId);
  }

  function assertAcceptedMember({ householdId, userId }) {
    if (!households.has(householdId)) {
      const err = new Error('Household not found');
      err.code = 'HOUSEHOLD_NOT_FOUND';
      throw err;
    }
    const accepted = listAcceptedResidentIds(householdId);
    if (!accepted.includes(userId)) {
      const err = new Error('Forbidden');
      err.code = 'FORBIDDEN';
      throw err;
    }
  }

  function getBillStatus(bill, now = new Date()) {
    if (bill.paidAt) return 'paid';
    if (new Date(bill.dueDate).getTime() < now.getTime()) return 'overdue';
    return 'pending';
  }

  function createBill({ householdId, createdByUserId, title, amountCents, dueDate, type, responsibleUserId }) {
    assertAcceptedMember({ householdId, userId: createdByUserId });
    const acceptedResidents = listAcceptedResidentIds(householdId);
    const finalResponsibleUserId = responsibleUserId || createdByUserId;
    if (!acceptedResidents.includes(finalResponsibleUserId)) {
      const err = new Error('Responsible resident not found');
      err.code = 'INVALID_RESPONSIBLE_RESIDENT';
      throw err;
    }

    const bill = {
      id: uuidv4(),
      householdId,
      title: String(title || '').trim(),
      amountCents: amountCents === undefined ? 0 : Number(amountCents),
      dueDate: dueDate ? new Date(dueDate).toISOString() : new Date().toISOString(),
      type: type === 'variable' ? 'variable' : 'fixed',
      responsibleUserId: finalResponsibleUserId,
      createdByUserId,
      createdAt: new Date().toISOString(),
      paidAt: null,
      paidByUserId: null,
      receipts: []
    };

    if (!bill.title || !Number.isFinite(bill.amountCents) || bill.amountCents < 0 || Number.isNaN(Date.parse(bill.dueDate))) {
      const err = new Error('Invalid bill payload');
      err.code = 'INVALID_BILL_PAYLOAD';
      throw err;
    }

    const bills = billsByHousehold.get(householdId) || [];
    bills.push(bill);
    billsByHousehold.set(householdId, bills);
    return { ...bill, status: getBillStatus(bill) };
  }

  function listBills({ householdId, actorUserId }) {
    assertAcceptedMember({ householdId, userId: actorUserId });
    const bills = billsByHousehold.get(householdId) || [];
    return bills.map((bill) => ({ ...bill, status: getBillStatus(bill) }));
  }

  function updateBill({ householdId, billId, actorUserId, patch }) {
    assertAcceptedMember({ householdId, userId: actorUserId });
    const bills = billsByHousehold.get(householdId) || [];
    const bill = bills.find((entry) => entry.id === billId);
    if (!bill) {
      const err = new Error('Bill not found');
      err.code = 'BILL_NOT_FOUND';
      throw err;
    }

    if (patch.title !== undefined) bill.title = String(patch.title).trim();
    if (patch.amountCents !== undefined) bill.amountCents = Number(patch.amountCents);
    if (patch.dueDate !== undefined) bill.dueDate = new Date(patch.dueDate).toISOString();
    if (patch.type !== undefined) bill.type = patch.type === 'variable' ? 'variable' : 'fixed';
    if (patch.responsibleUserId !== undefined) {
      const acceptedResidents = listAcceptedResidentIds(householdId);
      if (!acceptedResidents.includes(patch.responsibleUserId)) {
        const err = new Error('Responsible resident not found');
        err.code = 'INVALID_RESPONSIBLE_RESIDENT';
        throw err;
      }
      bill.responsibleUserId = patch.responsibleUserId;
    }
    if (patch.markPaid === true) {
      bill.paidAt = new Date().toISOString();
      bill.paidByUserId = actorUserId;
    }
    if (patch.markPaid === false) {
      bill.paidAt = null;
      bill.paidByUserId = null;
    }

    if (!bill.title || !Number.isFinite(bill.amountCents) || bill.amountCents < 0 || Number.isNaN(Date.parse(bill.dueDate))) {
      const err = new Error('Invalid bill payload');
      err.code = 'INVALID_BILL_PAYLOAD';
      throw err;
    }

    return { ...bill, status: getBillStatus(bill) };
  }

  function deleteBill({ householdId, billId, actorUserId }) {
    assertAcceptedMember({ householdId, userId: actorUserId });
    const bills = billsByHousehold.get(householdId) || [];
    const nextBills = bills.filter((entry) => entry.id !== billId);
    if (nextBills.length === bills.length) {
      const err = new Error('Bill not found');
      err.code = 'BILL_NOT_FOUND';
      throw err;
    }
    billsByHousehold.set(householdId, nextBills);
  }

  function createExpense({ householdId, actorUserId, description, amountCents, paidByUserId, participantUserIds }) {
    assertAcceptedMember({ householdId, userId: actorUserId });
    const acceptedResidents = listAcceptedResidentIds(householdId);
    if (!acceptedResidents.includes(paidByUserId)) {
      const err = new Error('Paid-by resident not found');
      err.code = 'INVALID_PAID_BY_RESIDENT';
      throw err;
    }

    const participants = Array.isArray(participantUserIds) && participantUserIds.length > 0
      ? participantUserIds
      : acceptedResidents;
    if (participants.some((userId) => !acceptedResidents.includes(userId))) {
      const err = new Error('Invalid expense participants');
      err.code = 'INVALID_EXPENSE_PARTICIPANTS';
      throw err;
    }

    const total = Number(amountCents);
    if (!Number.isFinite(total) || total <= 0) {
      const err = new Error('Invalid expense payload');
      err.code = 'INVALID_EXPENSE_PAYLOAD';
      throw err;
    }

    const share = Math.floor(total / participants.length);
    const remainder = total - (share * participants.length);
    const owedByUserId = {};
    participants.forEach((userId, index) => {
      owedByUserId[userId] = share + (index < remainder ? 1 : 0);
    });

    const expense = {
      id: uuidv4(),
      householdId,
      description: String(description || '').trim() || 'Expense',
      amountCents: total,
      paidByUserId,
      participantUserIds: [...participants],
      owedByUserId,
      createdByUserId: actorUserId,
      createdAt: new Date().toISOString()
    };

    const expenses = expensesByHousehold.get(householdId) || [];
    expenses.push(expense);
    expensesByHousehold.set(householdId, expenses);
    return expense;
  }

  function listExpenses({ householdId, actorUserId }) {
    assertAcceptedMember({ householdId, userId: actorUserId });
    return [...(expensesByHousehold.get(householdId) || [])];
  }

  function calculateSettlement({ householdId, actorUserId }) {
    assertAcceptedMember({ householdId, userId: actorUserId });
    const residents = listAcceptedResidentIds(householdId);
    const balances = {};
    residents.forEach((residentId) => {
      balances[residentId] = { paidCents: 0, owedCents: 0, netCents: 0 };
    });

    const expenses = expensesByHousehold.get(householdId) || [];
    expenses.forEach((expense) => {
      balances[expense.paidByUserId].paidCents += expense.amountCents;
      Object.entries(expense.owedByUserId).forEach(([residentId, owedCents]) => {
        balances[residentId].owedCents += owedCents;
      });
    });

    residents.forEach((residentId) => {
      balances[residentId].netCents = balances[residentId].paidCents - balances[residentId].owedCents;
    });

    const debtors = residents
      .map((residentId) => ({ userId: residentId, amountCents: -balances[residentId].netCents }))
      .filter((row) => row.amountCents > 0)
      .sort((a, b) => b.amountCents - a.amountCents);
    const creditors = residents
      .map((residentId) => ({ userId: residentId, amountCents: balances[residentId].netCents }))
      .filter((row) => row.amountCents > 0)
      .sort((a, b) => b.amountCents - a.amountCents);

    const transfers = [];
    let debtorIndex = 0;
    let creditorIndex = 0;
    while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
      const amountCents = Math.min(debtors[debtorIndex].amountCents, creditors[creditorIndex].amountCents);
      transfers.push({
        fromUserId: debtors[debtorIndex].userId,
        toUserId: creditors[creditorIndex].userId,
        amountCents
      });
      debtors[debtorIndex].amountCents -= amountCents;
      creditors[creditorIndex].amountCents -= amountCents;
      if (debtors[debtorIndex].amountCents === 0) debtorIndex += 1;
      if (creditors[creditorIndex].amountCents === 0) creditorIndex += 1;
    }

    return { balances, transfers };
  }

  function closeMonth({ householdId, actorUserId, month }) {
    assertAcceptedMember({ householdId, userId: actorUserId });
    if (!/^\d{4}-\d{2}$/.test(String(month || ''))) {
      const err = new Error('Month must be YYYY-MM');
      err.code = 'INVALID_MONTH';
      throw err;
    }

    const closes = monthlyClosesByHousehold.get(householdId) || [];
    if (closes.some((entry) => entry.month === month)) {
      const err = new Error('Month already closed');
      err.code = 'MONTH_ALREADY_CLOSED';
      throw err;
    }

    const settlement = calculateSettlement({ householdId, actorUserId });
    const snapshot = {
      id: uuidv4(),
      householdId,
      month,
      closedAt: new Date().toISOString(),
      closedByUserId: actorUserId,
      balances: JSON.parse(JSON.stringify(settlement.balances)),
      transfers: JSON.parse(JSON.stringify(settlement.transfers))
    };
    closes.push(snapshot);
    monthlyClosesByHousehold.set(householdId, closes);
    return snapshot;
  }

  function listMonthlyCloses({ householdId, actorUserId }) {
    assertAcceptedMember({ householdId, userId: actorUserId });
    return [...(monthlyClosesByHousehold.get(householdId) || [])];
  }

  function createShoppingItem({ householdId, actorUserId, text }) {
    assertAcceptedMember({ householdId, userId: actorUserId });
    const item = {
      id: uuidv4(),
      householdId,
      text: String(text || '').trim(),
      checked: false,
      checkedAt: null,
      createdAt: new Date().toISOString()
    };
    if (!item.text) {
      const err = new Error('Invalid shopping item');
      err.code = 'INVALID_SHOPPING_ITEM';
      throw err;
    }
    const items = shoppingItemsByHousehold.get(householdId) || [];
    items.push(item);
    shoppingItemsByHousehold.set(householdId, items);
    return item;
  }

  function listShoppingItems({ householdId, actorUserId }) {
    assertAcceptedMember({ householdId, userId: actorUserId });
    return [...(shoppingItemsByHousehold.get(householdId) || [])];
  }

  function updateShoppingItem({ householdId, itemId, actorUserId, checked }) {
    assertAcceptedMember({ householdId, userId: actorUserId });
    const items = shoppingItemsByHousehold.get(householdId) || [];
    const item = items.find((entry) => entry.id === itemId);
    if (!item) {
      const err = new Error('Shopping item not found');
      err.code = 'SHOPPING_ITEM_NOT_FOUND';
      throw err;
    }
    item.checked = Boolean(checked);
    item.checkedAt = item.checked ? new Date().toISOString() : null;
    return item;
  }

  function createChore({ householdId, actorUserId, title, ownerUserId, dueDate }) {
    assertAcceptedMember({ householdId, userId: actorUserId });
    const acceptedResidents = listAcceptedResidentIds(householdId);
    if (!acceptedResidents.includes(ownerUserId)) {
      const err = new Error('Chore owner not found');
      err.code = 'INVALID_CHORE_OWNER';
      throw err;
    }
    const chore = {
      id: uuidv4(),
      householdId,
      title: String(title || '').trim(),
      ownerUserId,
      dueDate: new Date(dueDate).toISOString(),
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    if (!chore.title || Number.isNaN(Date.parse(chore.dueDate))) {
      const err = new Error('Invalid chore payload');
      err.code = 'INVALID_CHORE_PAYLOAD';
      throw err;
    }
    const chores = choresByHousehold.get(householdId) || [];
    chores.push(chore);
    choresByHousehold.set(householdId, chores);
    return chore;
  }

  function updateChore({ householdId, choreId, actorUserId, status }) {
    assertAcceptedMember({ householdId, userId: actorUserId });
    const chores = choresByHousehold.get(householdId) || [];
    const chore = chores.find((entry) => entry.id === choreId);
    if (!chore) {
      const err = new Error('Chore not found');
      err.code = 'CHORE_NOT_FOUND';
      throw err;
    }
    if (status !== 'pending' && status !== 'done') {
      const err = new Error('Invalid chore status');
      err.code = 'INVALID_CHORE_STATUS';
      throw err;
    }
    chore.status = status;
    return chore;
  }

  function listCalendar({ householdId, actorUserId }) {
    assertAcceptedMember({ householdId, userId: actorUserId });
    const choreEvents = (choresByHousehold.get(householdId) || []).map((chore) => ({
      id: chore.id,
      type: 'chore',
      title: chore.title,
      dueDate: chore.dueDate,
      status: chore.status
    }));
    const billEvents = (billsByHousehold.get(householdId) || []).map((bill) => ({
      id: bill.id,
      type: 'bill',
      title: bill.title,
      dueDate: bill.dueDate,
      status: getBillStatus(bill)
    }));
    return [...choreEvents, ...billEvents].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  }

  function listAlerts({ householdId, actorUserId, now, windowHours }) {
    assertAcceptedMember({ householdId, userId: actorUserId });
    const nowDate = new Date(now || new Date().toISOString());
    const windowMs = Number(windowHours || 24) * 60 * 60 * 1000;
    const alerts = [];
    (choresByHousehold.get(householdId) || []).forEach((chore) => {
      if (chore.status === 'done') return;
      const dueMs = new Date(chore.dueDate).getTime();
      if (dueMs < nowDate.getTime()) return;
      if (dueMs <= nowDate.getTime() + windowMs) {
        alerts.push({ type: 'chore', kind: 'upcoming', sourceId: chore.id, dueDate: chore.dueDate, title: chore.title });
      }
    });
    (billsByHousehold.get(householdId) || []).forEach((bill) => {
      const status = getBillStatus(bill, nowDate);
      if (status === 'overdue') {
        alerts.push({ type: 'bill', kind: 'overdue', sourceId: bill.id, dueDate: bill.dueDate, title: bill.title });
      }
    });
    return alerts;
  }

  function addBillReceipt({ householdId, billId, actorUserId, receiptUrl, note }) {
    assertAcceptedMember({ householdId, userId: actorUserId });
    const bills = billsByHousehold.get(householdId) || [];
    const bill = bills.find((entry) => entry.id === billId);
    if (!bill) {
      const err = new Error('Bill not found');
      err.code = 'BILL_NOT_FOUND';
      throw err;
    }
    const finalUrl = String(receiptUrl || '').trim();
    if (!finalUrl) {
      const err = new Error('Receipt URL is required');
      err.code = 'INVALID_RECEIPT_PAYLOAD';
      throw err;
    }
    const receipt = {
      id: uuidv4(),
      url: finalUrl,
      note: String(note || '').trim(),
      uploadedByUserId: actorUserId,
      uploadedAt: new Date().toISOString()
    };
    bill.receipts.push(receipt);
    return receipt;
  }

  function createSubscription({ householdId, actorUserId, name, amountCents, cadenceDays, nextRenewalDate }) {
    assertAcceptedMember({ householdId, userId: actorUserId });
    const subscription = {
      id: uuidv4(),
      householdId,
      name: String(name || '').trim(),
      amountCents: Number(amountCents),
      cadenceDays: cadenceDays === undefined ? 30 : Number(cadenceDays),
      nextRenewalDate: new Date(nextRenewalDate).toISOString(),
      createdByUserId: actorUserId,
      createdAt: new Date().toISOString()
    };
    if (
      !subscription.name ||
      !Number.isFinite(subscription.amountCents) ||
      subscription.amountCents <= 0 ||
      !Number.isFinite(subscription.cadenceDays) ||
      subscription.cadenceDays <= 0 ||
      Number.isNaN(Date.parse(subscription.nextRenewalDate))
    ) {
      const err = new Error('Invalid subscription payload');
      err.code = 'INVALID_SUBSCRIPTION_PAYLOAD';
      throw err;
    }
    const subscriptions = subscriptionsByHousehold.get(householdId) || [];
    subscriptions.push(subscription);
    subscriptionsByHousehold.set(householdId, subscriptions);
    return subscription;
  }

  function listSubscriptions({ householdId, actorUserId }) {
    assertAcceptedMember({ householdId, userId: actorUserId });
    return [...(subscriptionsByHousehold.get(householdId) || [])];
  }

  function listSubscriptionReminders({ householdId, actorUserId, now, windowDays }) {
    assertAcceptedMember({ householdId, userId: actorUserId });
    const nowDate = new Date(now || new Date().toISOString());
    const maxDays = Number(windowDays || 30);
    const cutoffMs = nowDate.getTime() + (maxDays * 24 * 60 * 60 * 1000);
    return (subscriptionsByHousehold.get(householdId) || [])
      .filter((subscription) => {
        const renewalMs = new Date(subscription.nextRenewalDate).getTime();
        return renewalMs <= cutoffMs;
      })
      .map((subscription) => {
        const renewalMs = new Date(subscription.nextRenewalDate).getTime();
        const diffDays = Math.ceil((renewalMs - nowDate.getTime()) / (24 * 60 * 60 * 1000));
        return {
          subscriptionId: subscription.id,
          name: subscription.name,
          amountCents: subscription.amountCents,
          nextRenewalDate: subscription.nextRenewalDate,
          daysUntilRenewal: diffDays,
          kind: diffDays < 0 ? 'overdue' : 'upcoming'
        };
      })
      .sort((a, b) => new Date(a.nextRenewalDate).getTime() - new Date(b.nextRenewalDate).getTime());
  }

  function getDashboard({ householdId, actorUserId, now }) {
    assertAcceptedMember({ householdId, userId: actorUserId });
    const nowDate = new Date(now || new Date().toISOString());
    const monthPrefix = nowDate.toISOString().slice(0, 7);
    const bills = billsByHousehold.get(householdId) || [];
    const expenses = expensesByHousehold.get(householdId) || [];
    const subscriptions = subscriptionsByHousehold.get(householdId) || [];
    const settlement = calculateSettlement({ householdId, actorUserId });
    const billsWithStatus = bills.map((bill) => ({ ...bill, status: getBillStatus(bill, nowDate) }));
    const monthlyExpensesCents = expenses
      .filter((expense) => expense.createdAt.startsWith(monthPrefix))
      .reduce((sum, expense) => sum + expense.amountCents, 0);
    const monthlyBillsPaidCents = bills
      .filter((bill) => bill.paidAt && bill.paidAt.startsWith(monthPrefix))
      .reduce((sum, bill) => sum + bill.amountCents, 0);
    const upcomingDueCents = billsWithStatus
      .filter((bill) => bill.status === 'pending')
      .reduce((sum, bill) => sum + bill.amountCents, 0);
    const overdueDueCents = billsWithStatus
      .filter((bill) => bill.status === 'overdue')
      .reduce((sum, bill) => sum + bill.amountCents, 0);
    const monthlySubscriptionCents = subscriptions.reduce((sum, sub) => sum + sub.amountCents, 0);

    return {
      balances: settlement.balances,
      totals: {
        monthlyExpensesCents,
        monthlyBillsPaidCents,
        monthlySubscriptionCents,
        upcomingDueCents,
        overdueDueCents
      },
      counts: {
        billsPending: billsWithStatus.filter((bill) => bill.status === 'pending').length,
        billsOverdue: billsWithStatus.filter((bill) => bill.status === 'overdue').length,
        billsPaid: billsWithStatus.filter((bill) => bill.status === 'paid').length
      }
    };
  }

  function exportFinancialReport({ householdId, actorUserId, format, now }) {
    assertAcceptedMember({ householdId, userId: actorUserId });
    const dashboard = getDashboard({ householdId, actorUserId, now });
    if (format !== 'excel') {
      const err = new Error('Unsupported export format');
      err.code = 'UNSUPPORTED_EXPORT_FORMAT';
      throw err;
    }

    const rows = [
      ['section', 'metric', 'value'],
      ['totals', 'monthlyExpensesCents', dashboard.totals.monthlyExpensesCents],
      ['totals', 'monthlyBillsPaidCents', dashboard.totals.monthlyBillsPaidCents],
      ['totals', 'monthlySubscriptionCents', dashboard.totals.monthlySubscriptionCents],
      ['totals', 'upcomingDueCents', dashboard.totals.upcomingDueCents],
      ['totals', 'overdueDueCents', dashboard.totals.overdueDueCents],
      ['counts', 'billsPending', dashboard.counts.billsPending],
      ['counts', 'billsOverdue', dashboard.counts.billsOverdue],
      ['counts', 'billsPaid', dashboard.counts.billsPaid]
    ];
    return rows.map((row) => row.join(',')).join('\n');
  }

  return {
    register,
    login,
    logout,
    getUserByToken,
    createHousehold,
    createInvite,
    acceptInvite,
    listResidents,
    createBill,
    listBills,
    updateBill,
    deleteBill,
    createExpense,
    listExpenses,
    calculateSettlement,
    closeMonth,
    listMonthlyCloses,
    createShoppingItem,
    listShoppingItems,
    updateShoppingItem,
    createChore,
    updateChore,
    listCalendar,
    listAlerts,
    addBillReceipt,
    createSubscription,
    listSubscriptions,
    listSubscriptionReminders,
    getDashboard,
    exportFinancialReport
  };
}

module.exports = { createStore };
