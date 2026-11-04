# Tavern Moot core feedback: Forums module, round 2

Round 1 is in `old/FEEDBACK_1.md`. This round: the module was moved onto what core added
(ADR 0097 "After the Forums module's first round"), and what is still open.

None of this has run inside the app yet. `tavern validate` and `tavern check` pass; behaviour below
is read from the guide and `sdk/*.d.ts`, so the "please confirm" items matter.

## Round 1 items, as now used

| Item                          | Status | How the module uses it                                                                                                                                                 |
| ----------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01 tab from a toolbox        | Fixed  | `tabs` + `ui.tab:board`; a category click is `openTab('board', { key: categoryId, title, args })`. "Browse all forums" is key `listing`. The one-widget workaround is gone. |
| F02 roles made at runtime     | Fixed  | `tavern.roles.create/rename/delete`; private categories name `role:<name>` as readers. No member lists in readers, no recompute when membership changes.                  |
| F03 settings page             | Fixed  | `settingsPage: ui/settings.html` hosts the role editor (also reachable in the tab for non-GM forum admins).                                                              |
| F05 docs on `where`           | Fixed  | Range filters (`at: { gt }`) used for the dot.                                                                                                                          |
| F06 `onDelete: "restrict"`    | Fixed  | On `sections`; `section-delete` just tries and reports.                                                                                                                 |
| F06 `notAuthor`               | Fixed  | Used by the dot (leave out the viewer's own posts).                                                                                                                     |
| F06 markdown `enrichers:false`| Fixed  | Posts render as Markdown with live links off.                                                                                                                           |
| F06 hall `ctx.user.role`      | Fixed  | Relied on for forum admin in halls.                                                                                                                                     |

## Design change: an unread dot, not a count

Each category shows one dot when another member has posted since the viewer last looked. The check is
one query, `limit: 1`, with `where: { category, at: { gt: readAt } }` and `notAuthor: me`, so nothing is
counted. `mark-read` stores `readAt` per member per category; opening a category tab (or viewing a thread
in it) marks it read. A member's first visit creates markers at "now" so a newcomer starts with no dots.

## Still open

- **F04 (reduced): no read cursor and no rail badge.**
  - The `reads` collection and `mark-read` action are ours. A core read cursor
    (`markSeen`/`unread(collection, filter)`) would replace both.
  - The toolbox re-runs one `limit: 1` query per category whenever any post, read marker or category
    changes. Cheap, but a built-in "has anything newer than my cursor" would remove the chatter.
  - A rail-button dot (any category unread) isn't possible while the toolbox is closed.
- **Please confirm: the toolbox keeps updating while closed.** The dot relies on the toolbox page's
  subscriptions. If the page is torn down when the toolbox closes, dots only refresh on open.
- **Please confirm: tab `args` on restore.** The guide says tabs return after a restart. We read
  `tavern.ui.args()` once at load; confirm it is filled again for a restored tab.
- **Please confirm: `settingsPage` acts as the GM.** The guide says so; our actions then see
  `ctx.user.role === 'gm'`. Forum admins who aren't the GM use the Roles button in the tab instead.
- **Watch filters take only equality.** Dots can't be pushed by a ranged watch, so we watch whole
  collections and re-query. Fine at this size; a ranged `subscribe` would be tidier.
- **Role settings live beside core's roles.** Core keeps a role's name, label and members; the flags
  (admin, moderator, banned) and per-category grants are our `role-settings` records, joined by role
  name. Deleting a role through the GM's own picker UI, if that is allowed for made roles, would leave
  an orphan settings record; `allRoles()` ignores it. A `roles.changed` hook would let us clean up.
- **Role name rules.** Names are lowercase letters, digits and dashes; we generate
  `f-<slug>-<random>`. A `roles.create(label)` that returns a generated name would save that code.

## F07: package rail icons can't take the theme's colour

A package's rail icon is drawn as `<img src="tavern-pkg://…">` (`tools/packages/PackageTools.tsx`),
so `currentColor` inside the SVG doesn't follow the rail: it renders in the image's default colour
while core's inline icons are muted when idle and bright when selected. Our workaround is a fixed
mid-grey stroke with a `prefers-color-scheme` rule, which follows the OS, not the app's theme, and
never shows the selected state.

**Would remove it:** draw the icon as a CSS mask (`mask: url(…) center / contain no-repeat;
background: currentColor`) so it inherits the rail's colour and states, or inline the SVG after
sanitising it.
