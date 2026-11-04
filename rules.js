// Tavern Moot Forums: every rule lives here, on the server (ADR 0097).
//
// Pages only ASK. They read collections directly (readers are enforced by core) but never write
// them: there is deliberately no `collections.write` hook, so every change goes through one of the
// actions below, which check who is asking.
//
// Model
//   sections   -> organisational headers in the toolbox
//   categories -> boards (parent: a section). access: 'open' | 'announce' | 'private'
//   threads    -> parent: a category.   posts -> parent: a thread (the first post opens the thread)
//   roles      -> admin-made roles: { name, color, admin, moderator, banned, grants, members }
//   reads      -> one per member per category: when they last looked (drives unread counters)
//   nav        -> one per member: "open this category/thread" hand-off from the toolbox to the tab
//
// Permission levels, low to high: none < read < post < moderate < admin.

const LEVELS = ['none', 'read', 'post', 'moderate', 'admin'];
const rank = (l) => LEVELS.indexOf(l);
const maxLevel = (a, b) => (rank(a) >= rank(b) ? a : b);
const MAX_POSTS_PER_MEMBER = 2000;

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const fail = (error) => ({ error });
const all = (collection, query = {}) => {
  // Scripts read everything; page through so nothing is missed.
  const out = [];
  let after;
  for (let i = 0; i < 50; i++) {
    const page = tavern.collections.query(collection, { ...query, limit: 100, after });
    out.push(...page.records);
    if (!page.next) break;
    after = page.next;
  }
  return out;
};

// ---- who may do what ---------------------------------------------------------------------------

function rolesOf(userId) {
  return all('roles').filter((r) => (r.data.members || []).includes(userId));
}

function isAdmin(user) {
  return user.role === 'gm' || rolesOf(user.id).some((r) => r.data.admin);
}

/** A member's level on a category, from its access setting and the roles they hold. */
function levelOn(user, cat, roles = rolesOf(user.id)) {
  if (user.role === 'gm' || roles.some((r) => r.data.admin)) return 'admin';
  const access = cat.data.access || 'open';
  let level = access === 'open' ? 'post' : access === 'announce' ? 'read' : 'none';
  for (const r of roles) {
    if (r.data.moderator) level = maxLevel(level, 'moderate');
    const g = (r.data.grants || {})[cat.id];
    if (LEVELS.includes(g)) level = maxLevel(level, g);
  }
  // A banned member keeps whatever they could read, and can't write.
  if (roles.some((r) => r.data.banned) && rank(level) > rank('read')) level = 'read';
  return level;
}

/** Everyone who must be named as a reader of a private category. */
function readersFor(cat, roles, memberLevel) {
  if ((cat.data.access || 'open') !== 'private') return null;
  const ids = new Set();
  for (const r of roles) {
    for (const id of r.data.members || []) {
      if (memberLevel(id, r) !== 'none') ids.add(id);
    }
  }
  return ['server:gm', ...[...ids].map((id) => `user:${id}`)];
}

/** Re-label every private category's readers after roles or categories change. */
function syncReaders() {
  const roles = all('roles');
  for (const cat of all('categories')) {
    const readers = readersFor(cat, roles, (id) =>
      levelOn({ id, role: 'player' }, cat, roles.filter((r) => (r.data.members || []).includes(id))),
    );
    tavern.collections.update('categories', cat.id, { readers });
  }
}

const needAdmin = (ctx) => (isAdmin(ctx.user) ? null : fail('Only forum admins can do that'));

function categoryFor(ctx, id, atLeast) {
  const cat = tavern.collections.get('categories', String(id));
  if (!cat) return { error: 'No such category' };
  const level = levelOn(ctx.user, cat);
  if (rank(level) < rank(atLeast)) return { error: 'You do not have access to do that here' };
  return { cat, level };
}

// ---- what the page needs to know about the viewer --------------------------------------------

tavern.actions.register('perms', (ctx) => {
  const roles = rolesOf(ctx.user.id);
  const admin = ctx.user.role === 'gm' || roles.some((r) => r.data.admin);
  const levels = {};
  for (const cat of all('categories')) levels[cat.id] = levelOn(ctx.user, cat, roles);
  return { id: ctx.user.id, admin, levels, roles: roles.map((r) => r.data.name) };
});

// ---- sections and categories (admins) ----------------------------------------------------------

tavern.actions.register('section-save', (ctx) => {
  const denied = needAdmin(ctx);
  if (denied) return denied;
  const name = text(ctx.args.name, 60);
  if (!name) return fail('A section needs a name');
  if (ctx.args.id) {
    return tavern.collections.update('sections', String(ctx.args.id), {
      data: { name, ...(Number.isFinite(ctx.args.order) ? { order: ctx.args.order } : {}) },
    });
  }
  const order = all('sections').length;
  return tavern.collections.create('sections', { data: { name, order } });
});

tavern.actions.register('section-delete', (ctx) => {
  const denied = needAdmin(ctx);
  if (denied) return denied;
  const id = String(ctx.args.id);
  if (tavern.collections.count('categories', { parent: id }) > 0) {
    return fail('Move or remove its categories first');
  }
  return { removed: tavern.collections.delete('sections', id) };
});

tavern.actions.register('category-save', (ctx) => {
  const denied = needAdmin(ctx);
  if (denied) return denied;
  const a = ctx.args;
  const name = text(a.name, 60);
  if (!name) return fail('A category needs a name');
  const access = ['open', 'announce', 'private'].includes(a.access) ? a.access : 'open';
  const data = { name, about: text(a.about, 300), access };
  let cat;
  if (a.id) {
    cat = tavern.collections.update('categories', String(a.id), { data });
  } else {
    if (!a.section || !tavern.collections.get('sections', String(a.section))) {
      return fail('Pick a section for it');
    }
    const order = tavern.collections.count('categories', { parent: String(a.section) });
    cat = tavern.collections.create('categories', {
      data: { ...data, order },
      parent: String(a.section),
    });
  }
  syncReaders();
  return cat;
});

tavern.actions.register('category-delete', (ctx) => {
  const denied = needAdmin(ctx);
  if (denied) return denied;
  return { removed: tavern.collections.delete('categories', String(ctx.args.id)) };
});

// ---- roles (admins) ---------------------------------------------------------------------------

tavern.actions.register('role-save', (ctx) => {
  const denied = needAdmin(ctx);
  if (denied) return denied;
  const a = ctx.args;
  const name = text(a.name, 40);
  if (!name) return fail('A role needs a name');
  const grants = {};
  for (const [catId, level] of Object.entries(a.grants || {})) {
    if (['read', 'post', 'moderate'].includes(level)) grants[catId] = level;
  }
  const data = {
    name,
    color: /^#[0-9a-f]{6}$/i.test(a.color || '') ? a.color : '#8a8a8a',
    admin: !!a.admin,
    moderator: !!a.moderator,
    banned: !!a.banned,
    grants,
    members: [...new Set((a.members || []).map(String))].slice(0, 500),
  };
  const role = a.id
    ? tavern.collections.update('roles', String(a.id), { data })
    : tavern.collections.create('roles', { data });
  syncReaders();
  return role;
});

tavern.actions.register('role-delete', (ctx) => {
  const denied = needAdmin(ctx);
  if (denied) return denied;
  const removed = tavern.collections.delete('roles', String(ctx.args.id));
  syncReaders();
  return { removed };
});

// ---- threads and posts -------------------------------------------------------------------------

function roomFor(user) {
  return tavern.collections.usage({ author: user.id }).records < MAX_POSTS_PER_MEMBER;
}

function addPost(ctx, thread, body) {
  const post = tavern.collections.create('posts', {
    data: { body, category: thread.parent, at: Date.now() },
    parent: thread.id,
  });
  // `at` is the server's clock, so every member's unread counters compare like with like.
  return post;
}

tavern.actions.register('thread-create', (ctx) => {
  const got = categoryFor(ctx, ctx.args.category, 'post');
  if (got.error) return got;
  const title = text(ctx.args.title, 120);
  const body = text(ctx.args.body, 10_000);
  if (!title) return fail('Give the thread a title');
  if (!body) return fail('A post needs some words');
  if (!roomFor(ctx.user)) return fail(`You have ${MAX_POSTS_PER_MEMBER} posts here: remove some first`);
  const now = Date.now();
  const thread = tavern.collections.create('threads', {
    data: { title, category: got.cat.id, pinned: false, locked: false, lastPost: now, replies: 0 },
    parent: got.cat.id,
  });
  const post = tavern.collections.create('posts', {
    data: { body, category: got.cat.id, at: now, first: true },
    parent: thread.id,
  });
  return { thread, post };
});

tavern.actions.register('reply', (ctx) => {
  const thread = tavern.collections.get('threads', String(ctx.args.thread));
  if (!thread) return fail('No such thread');
  const got = categoryFor(ctx, thread.parent, 'post');
  if (got.error) return got;
  if (thread.data.locked && rank(got.level) < rank('moderate')) return fail('This thread is locked');
  const body = text(ctx.args.body, 10_000);
  if (!body) return fail('A post needs some words');
  if (!roomFor(ctx.user)) return fail(`You have ${MAX_POSTS_PER_MEMBER} posts here: remove some first`);
  const post = addPost(ctx, thread, body);
  tavern.collections.update('threads', thread.id, {
    data: { lastPost: post.data.at, replies: Number(thread.data.replies || 0) + 1 },
  });
  return post;
});

tavern.actions.register('post-edit', (ctx) => {
  const post = tavern.collections.get('posts', String(ctx.args.id));
  if (!post) return fail('No such post');
  const thread = tavern.collections.get('threads', post.parent);
  const got = categoryFor(ctx, thread.parent, 'post');
  if (got.error) return got;
  if (post.author !== ctx.user.id && rank(got.level) < rank('moderate')) {
    return fail('Only its author or a moderator can edit it');
  }
  const body = text(ctx.args.body, 10_000);
  if (!body) return fail('A post needs some words');
  return tavern.collections.update('posts', post.id, { data: { body, edited: Date.now() } });
});

tavern.actions.register('post-delete', (ctx) => {
  const post = tavern.collections.get('posts', String(ctx.args.id));
  if (!post) return fail('No such post');
  const thread = tavern.collections.get('threads', post.parent);
  const got = categoryFor(ctx, thread.parent, 'read');
  if (got.error) return got;
  if (post.author !== ctx.user.id && rank(got.level) < rank('moderate')) {
    return fail('Only its author or a moderator can remove it');
  }
  if (post.data.first) {
    // Removing a thread's opening post removes the thread.
    return { removed: tavern.collections.delete('threads', thread.id), thread: true };
  }
  const removed = tavern.collections.delete('posts', post.id);
  tavern.collections.update('threads', thread.id, {
    data: { replies: Math.max(0, Number(thread.data.replies || 0) - 1) },
  });
  return { removed };
});

/** Moderators: pin, lock, retitle or remove a thread. */
tavern.actions.register('thread-mod', (ctx) => {
  const thread = tavern.collections.get('threads', String(ctx.args.id));
  if (!thread) return fail('No such thread');
  const got = categoryFor(ctx, thread.parent, 'moderate');
  if (got.error) return got;
  if (ctx.args.remove) return { removed: tavern.collections.delete('threads', thread.id) };
  const data = {};
  if (typeof ctx.args.pinned === 'boolean') data.pinned = ctx.args.pinned;
  if (typeof ctx.args.locked === 'boolean') data.locked = ctx.args.locked;
  if (ctx.args.title !== undefined) data.title = text(ctx.args.title, 120) || thread.data.title;
  return tavern.collections.update('threads', thread.id, { data });
});

// ---- unread, and the toolbox -> tab hand-off ---------------------------------------------------

/** "I have looked at this category now": the unread counter counts posts after `at`. */
tavern.actions.register('mark-read', (ctx) => {
  const got = categoryFor(ctx, ctx.args.category, 'read');
  if (got.error) return got;
  const mine = tavern.collections.query('reads', { where: { category: got.cat.id }, author: ctx.user.id });
  const data = { category: got.cat.id, at: Date.now() };
  if (mine.records[0]) return tavern.collections.update('reads', mine.records[0].id, { data });
  return tavern.collections.create('reads', { data, readers: [`user:${ctx.user.id}`] });
});

/** The toolbox says "show the viewer this"; their open Forums tab is subscribed and follows. */
tavern.actions.register('nav-set', (ctx) => {
  const data = {
    category: text(ctx.args.category, 64),
    thread: text(ctx.args.thread, 64),
    stamp: Date.now(),
  };
  const mine = tavern.collections.query('nav', { author: ctx.user.id });
  if (mine.records[0]) return tavern.collections.update('nav', mine.records[0].id, { data });
  return tavern.collections.create('nav', { data, readers: [`user:${ctx.user.id}`] });
});
