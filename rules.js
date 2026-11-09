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
//   roles      -> core's own package roles (tavern.roles.create/rename/delete) hold names + members
//   role-settings -> what each means here: { role, color, admin, moderator, banned, grants }
//   reads      -> one per member per category: when they last looked (drives the unread dot)
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

/** Core's roles joined with this module's settings for them. */
function allRoles() {
  const defs = new Map(all('role-settings').map((d) => [d.data.role, d]));
  return tavern.roles.list().map((r) => {
    const d = defs.get(r.name);
    return {
      name: r.name,
      label: r.label,
      members: r.members.map((m) => m.id),
      color: d ? d.data.color : '#8a8a8a',
      admin: !!(d && d.data.admin),
      moderator: !!(d && d.data.moderator),
      banned: !!(d && d.data.banned),
      grants: (d && d.data.grants) || {},
    };
  });
}

const rolesOf = (userId, roles = allRoles()) => roles.filter((r) => r.members.includes(userId));

function isAdmin(user) {
  return user.role === 'gm' || rolesOf(user.id).some((r) => r.admin);
}

/** A role's own level on a category (before the category's open/announce/private default). */
function roleLevel(role, catId) {
  if (role.admin) return 'admin';
  const level = role.moderator ? 'moderate' : 'none';
  const g = role.grants[catId];
  return LEVELS.includes(g) ? maxLevel(level, g) : level;
}

/** A member's level on a category, from its access setting and the roles they hold. */
function levelOn(user, cat, roles = rolesOf(user.id)) {
  if (user.role === 'gm' || roles.some((r) => r.admin)) return 'admin';
  const access = cat.data.access || 'open';
  let level = access === 'open' ? 'post' : access === 'announce' ? 'read' : 'none';
  for (const r of roles) level = maxLevel(level, roleLevel(r, cat.id));
  // A banned member keeps whatever they could read, and can't write.
  if (roles.some((r) => r.banned) && rank(level) > rank('read')) level = 'read';
  return level;
}

/**
 * Re-label each private category's readers: the GM, and every role that can read it. Core joins on
 * role membership, so adding someone to a role needs no recompute: this runs only when a role's
 * settings or a category's access change.
 */
function syncReaders() {
  const roles = allRoles();
  for (const cat of all('categories')) {
    const readers =
      (cat.data.access || 'open') === 'private'
        ? [
            'server:gm',
            ...roles
              .filter((r) => rank(roleLevel(r, cat.id)) >= rank('read'))
              .map((r) => `role:${r.name}`),
          ]
        : null;
    tavern.collections.update('categories', cat.id, { readers });
  }
}

/** The section a category sits in: `data.section`, or (older records) the parent it was made under. */
const sectionOf = (c) => c.data.section || c.parent;

/** One line of a post, for the "last post" preview: no quotes, no Markdown marks. */
function previewOf(body) {
  const line = String(body)
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('>'));
  return (line || '').replace(/[*_`#~]|\[|\]\([^)]*\)/g, '').slice(0, 110);
}

/** Recompute a thread's reply count and last-post details from its posts (after a reply or delete). */
function refreshThread(threadId) {
  const thread = tavern.collections.get('threads', threadId);
  if (!thread) return;
  const total = tavern.collections.count('posts', { parent: threadId });
  const last = tavern.collections.query('posts', { parent: threadId, sort: '-created', limit: 1 }).records[0];
  tavern.collections.update('threads', threadId, {
    data: {
      replies: Math.max(0, total - 1),
      ...(last
        ? { lastPost: last.data.at, lastBy: last.author, lastPreview: previewOf(last.data.body) }
        : {}),
    },
  });
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
  const admin = ctx.user.role === 'gm' || roles.some((r) => r.admin);
  const levels = {};
  const cats = all('categories');
  for (const cat of cats) levels[cat.id] = levelOn(ctx.user, cat, roles);
  // A member's very first visit starts clean: no dots for what was posted before they came.
  const mine = tavern.collections.query('reads', { author: ctx.user.id, limit: 1 });
  if (!mine.records.length) {
    const now = Date.now();
    for (const cat of cats) {
      if (rank(levels[cat.id]) < rank('read')) continue;
      tavern.collections.create('reads', {
        data: { category: cat.id, at: now },
        readers: [`user:${ctx.user.id}`],
      });
    }
  }
  return { id: ctx.user.id, admin, levels, roles: roles.map((r) => r.label) };
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
  // Deleting a section deletes any record held under it, so refuse while a category is in it
  // (by `data.section`, or an older category still parented to it).
  if (all('categories').some((c) => sectionOf(c) === id || c.parent === id)) {
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
    const section = String(a.section);
    const order = all('categories').filter((c) => sectionOf(c) === section).length;
    cat = tavern.collections.create('categories', { data: { ...data, order, section } });
  }
  syncReaders();
  return cat;
});

tavern.actions.register('category-delete', (ctx) => {
  const denied = needAdmin(ctx);
  if (denied) return denied;
  return { removed: tavern.collections.delete('categories', String(ctx.args.id)) };
});

/**
 * Drag and drop: `layout` is every section, top to bottom, each with its categories in order:
 * [{ id, categories: [categoryId, ...] }, ...]. A category listed under another section moves there.
 */
tavern.actions.register('reorder', (ctx) => {
  const denied = needAdmin(ctx);
  if (denied) return denied;
  const layout = Array.isArray(ctx.args.layout) ? ctx.args.layout : [];
  const sections = new Map(all('sections').map((s) => [s.id, s]));
  const cats = new Map(all('categories').map((c) => [c.id, c]));
  layout.forEach((s, si) => {
    const sec = sections.get(String(s.id));
    if (!sec) return;
    if (sec.data.order !== si) tavern.collections.update('sections', sec.id, { data: { order: si } });
    (s.categories || []).forEach((cid, ci) => {
      const cat = cats.get(String(cid));
      if (!cat) return;
      if (cat.data.order !== ci || sectionOf(cat) !== sec.id) {
        tavern.collections.update('categories', cat.id, { data: { order: ci, section: sec.id } });
      }
    });
  });
  return { ok: true };
});

/**
 * One-off upkeep for forums made before topics were sortable: index fields are written when a record
 * is, so older threads are rewritten once (the `_meta` marker in role-settings says it's done).
 */
tavern.actions.register('maintenance', (ctx) => {
  const denied = needAdmin(ctx);
  if (denied) return denied;
  const done = tavern.collections.query('role-settings', { where: { role: '_meta:sort1' }, limit: 1 }).records[0];
  if (done) return { ran: false };
  for (const t of all('threads')) {
    tavern.collections.update('threads', t.id, {
      data: { replies: Number(t.data.replies || 0), title: t.data.title },
    });
    refreshThread(t.id);
  }
  tavern.collections.create('role-settings', { data: { role: '_meta:sort1' } });
  return { ran: true };
});

// ---- roles (admins) ---------------------------------------------------------------------------

/** Make a role's members exactly `ids` (core keeps them; we apply the difference). */
function setMembers(name, ids) {
  const want = new Set(ids);
  const current = tavern.roles.list().find((r) => r.name === name).members.map((m) => m.id);
  for (const id of current) if (!want.has(id)) tavern.roles.remove(name, id);
  for (const id of want) if (!current.includes(id)) tavern.roles.add(name, id);
}

const slug = (label) =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'role';

tavern.actions.register('role-save', (ctx) => {
  const denied = needAdmin(ctx);
  if (denied) return denied;
  const a = ctx.args;
  const label = text(a.name, 40);
  if (!label) return fail('A role needs a name');
  const grants = {};
  for (const [catId, level] of Object.entries(a.grants || {})) {
    if (['read', 'post', 'moderate'].includes(level)) grants[catId] = level;
  }
  let name = a.role ? String(a.role) : null;
  if (name) {
    if (!tavern.roles.list().some((r) => r.name === name)) return fail('No such role');
    tavern.roles.rename(name, label);
  } else {
    name = `f-${slug(label)}-${Math.random().toString(36).slice(2, 6)}`;
    tavern.roles.create(name, label);
  }
  // Members are optional here: omitting them leaves who is in the role alone.
  if (Array.isArray(a.members)) setMembers(name, a.members.map(String));

  const data = {
    role: name,
    color: /^#[0-9a-f]{6}$/i.test(a.color || '') ? a.color : '#8a8a8a',
    admin: !!a.admin,
    moderator: !!a.moderator,
    banned: !!a.banned,
    grants,
  };
  const existing = tavern.collections.query('role-settings', { where: { role: name }, limit: 1 })
    .records[0];
  if (existing) tavern.collections.update('role-settings', existing.id, { data });
  else tavern.collections.create('role-settings', { data });
  syncReaders();
  return { role: name };
});

/** Add and/or remove some members of a role. */
tavern.actions.register('role-members', (ctx) => {
  const denied = needAdmin(ctx);
  if (denied) return denied;
  const name = String(ctx.args.role);
  if (!tavern.roles.list().some((r) => r.name === name)) return fail('No such role');
  for (const id of ctx.args.add || []) tavern.roles.add(name, String(id));
  for (const id of ctx.args.remove || []) tavern.roles.remove(name, String(id));
  return { ok: true };
});

tavern.actions.register('role-delete', (ctx) => {
  const denied = needAdmin(ctx);
  if (denied) return denied;
  const name = String(ctx.args.role);
  tavern.roles.delete(name);
  for (const d of tavern.collections.query('role-settings', { where: { role: name } }).records) {
    tavern.collections.delete('role-settings', d.id);
  }
  syncReaders();
  return { removed: true };
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
    data: { title, category: got.cat.id, pinned: false, locked: false, lastPost: now, lastBy: ctx.user.id, lastPreview: previewOf(body), replies: 0 },
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
    data: {
      lastPost: post.data.at,
      lastBy: ctx.user.id,
      lastPreview: previewOf(body),
      replies: Number(thread.data.replies || 0) + 1,
    },
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
  const saved = tavern.collections.update('posts', post.id, { data: { body, edited: Date.now() } });
  refreshThread(thread.id); // the edited post may be the one the list previews
  return saved;
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
  refreshThread(thread.id); // reply count, and who/when/what is now last
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

// ---- unread ---------------------------------------------------

/** "I have looked at this category now": it shows a dot while others' posts are newer than `at`. */
tavern.actions.register('mark-read', (ctx) => {
  const got = categoryFor(ctx, ctx.args.category, 'read');
  if (got.error) return got;
  const mine = tavern.collections.query('reads', { where: { category: got.cat.id }, author: ctx.user.id });
  const data = { category: got.cat.id, at: Date.now() };
  if (mine.records[0]) return tavern.collections.update('reads', mine.records[0].id, { data });
  return tavern.collections.create('reads', { data, readers: [`user:${ctx.user.id}`] });
});
