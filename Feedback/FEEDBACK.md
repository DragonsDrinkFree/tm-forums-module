# Tavern Moot core feedback: from building the Forums module

Gaps, difficulties and wishes met while building `tm-forums`, for the core team. Each entry says
what we needed, what we did instead, and what would remove the workaround. Written against the
installed copy and ADR 0097 (2026-11-04). Items marked **Blocker** changed the design.

Nothing here has been run inside the app yet: `tavern validate` and `tavern check` pass, and the
pages were written against `sdk/tavern-sheet.d.ts`. Anything about runtime behaviour is therefore
read from source and docs, and should be confirmed.

---

## F01 (Blocker): a rail toolbox cannot open a workspace tab

**Needed:** click a category in the Forums toolbox, and a tab for that category opens in the main
workspace (one tab per category, ideally).

**Found:**

- The only package-owned tab is a widget's `full` view (ADR 0071). It opens from the Widgets menu
  or core code (`openWidget(url, widgetId)` in `workspace/store.ts`).
- No call in `sdk/tavern-sheet.d.ts` lets a page open one. The nearest is `tavern.sheet.open(id)`,
  which opens a **document**, and records in collections aren't documents.
- A widget tab's identity is `{ kind: 'widget', widgetId }`, so there is one tab per widget. Widgets
  are declared in the manifest, so a tab per category (which admins create at runtime) is impossible.
- A widget page isn't documented as getting arguments (a combat tracker reads its `#`; widgets
  don't say).

**What we did:**

- One **Forums** widget tab holds the whole forum, navigable between listing, category, thread and
  search.
- The toolbox writes a per-member `nav` record (readers: that member only) through the `nav-set`
  action, and an open Forums tab subscribes to it and jumps there.
- The toolbox calls `tavern.workspace.openWidget('board', { category })` if it exists (it doesn't
  today), otherwise tells the viewer to open Forums from the Widgets menu once.

**Would remove it:** `tavern.workspace.open({ widget, args })` (or `tavern.ui.openWidget`) for rail
pages and widgets, with `args` handed to the opened page (`tavern.ui.args()` already exists for
dialogs), and an optional `key` so one widget can have several tabs (`board:<categoryId>`).

## F02 (Blocker): module roles are fixed in `tavern.json`; we need roles admins create

**Needed:** admins create and name roles at runtime, assign members, and tie a role to categories
(read, post, moderate) or to moderator/admin rights.

**Found:** `roles` are declared in the manifest (at most 20). Only declared roles can be named in
readers (`role:<name>`), and "a reader naming a role you didn't declare is refused".

**What we did:** roles are records in a `roles` collection (members and grants inside). A private
category's `readers` is computed by the rules script as `['server:gm', 'user:<key>', …]` for every
member who may read it. It is recomputed (`syncReaders`) on every role or category change.

**Cost:**

- Cost grows with members times private categories on every role edit.
- Readers have no documented upper bound, and each reader is a row.
- A member newly added to a role can't read until the sync finishes. Fine for a hall of hundreds,
  doubtful for thousands.

**Would remove it:** readers that can name dynamic groups (`group:<id>` that the module creates and
fills at runtime, with core joining on membership as it does for declared roles), or declared
roles that may be extended at runtime.

## F03: module settings can't hold a custom UI

**Needed:** "Module settings should include the ability to create and assign roles".

**Found:** a module's gear has settings fields, a roles member-picker for declared roles, what it
keeps and what it's allowed, but no slot for a page of the module's own.

**What we did:** a **Roles** button inside the Forums tab (visible to forum admins) opens the role
editor (name, colour, admin/moderator/banned flags, per-category access, member picker using
`tavern.members.list`).

**Would remove it:** a `settingsPage` entry in the manifest (a page shown in the gear's column), or
`ui: [{ kind: 'settings' }]`, with the same API as widgets.

## F04: unread counters have no support

**Needed:** each category shows a count of unread posts and replies, in the toolbox.

**Found:** ADR 0097 lists "a rail toolbox's unread badge, for modules" under Later. There's also no
per-member read cursor.

**What we did:**

- A `reads` collection holds one record per member per category (`at` = when they last looked,
  server clock, readers: that member only). The `mark-read` action writes it.
- The toolbox counts `posts` with `where: { category, at: { gt: readAt } }`, twice (all, then
  `author: me`) to leave out the member's own posts, for every visible category on each change.
  That is 2 counts per category, repeated whenever any post anywhere changes. It is cheap on
  SQLite, but chatty.
- A new member (no `reads` record yet) sees everything as unread.

**Would remove it:**

- A `tavern.collections.count` option to exclude an author (`notAuthor`).
- A first-class read cursor: `tavern.collections.markSeen(collection, filter)` and
  `unread(collection, filter)`.
- A rail `badge` (a number the page sets, or the app derives) so the rail button can show total
  unread while the toolbox is closed.

## F05: docs say `where` is equality only, the types allow ranges

`developer-guide.md` ("Filters: … `where` (index fields equal to a value)") and the ADR's API
section say equality. `sdk/tavern-sheet.d.ts` has `CollectionFilter` with `gt/gte/lt/lte` and
`{ in: [...] }`, and `store.ts` implements `gt`/`gte`/`lt`/`lte`. We use `gt` on dates and found it
only through the types. Please update the guide. Also say whether a watch filter's `where` supports
ranges (`collectionWatchFilter` takes plain values only).

## F06: smaller notes

- **Action-only writes.** We register no `collections.write` hook, so pages can't write at all, and
  every change is an action (`thread-create`, `reply`, `role-save`, …). This keeps all rules in one
  file, but costs a round-trip per write and means `subscribe` is the only way a page sees its own
  writes. A one-line note in the guide that "no hook" is a supported design would help.
- **`ctx.user.id` vs `user:<key>` readers.** We assume the member key is the same string in both
  places (the example uses `as: ctx.user.id`). Please confirm in the guide.
- **Hall admins.** In a hall `actor.role === 'gm'` is documented for admins. We rely on that for the
  top-level forum admin. Please confirm it holds in `ctx.user.role` for actions as well as hooks.
- **`created`/`updated` sort.** The example sorts posts by `created`. It is only implied by the SDK
  type for `sort`. Document it.
- **Denormalised counters.** A thread list wants reply count and last post. Without a join or
  aggregate, the action keeps `replies`/`lastPost` on the thread. Fine, but a `count` of children
  per record in a query result would remove a class of drift bugs.
- **Deleting a section.** `parent` makes deleting a section delete every category, thread and post
  under it. We refuse in the action unless the section is empty. A "restrict" option on `parent`
  would make this a declaration, not code.
- **`tavern.ui.dialog` select with dynamic options** works, but a dialog can't validate or disable
  OK, so the actions return `{ error }` and the page toasts it. Fine.
- **Markdown in posts.** `tavern.markdown.render` exists, but posts are drawn as plain text for
  now. Worth confirming it is safe for user-authored text from other members.
