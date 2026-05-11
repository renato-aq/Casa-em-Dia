const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

function createStore() {
  const users = new Map();
  const usersByEmail = new Map();
  const sessions = new Map();
  const households = new Map();
  const membersByHousehold = new Map();
  const invites = new Map();

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

  return {
    register,
    login,
    logout,
    getUserByToken,
    createHousehold,
    createInvite,
    acceptInvite,
    listResidents
  };
}

module.exports = { createStore };
