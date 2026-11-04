# Tavern Moot Forums (`tm-forums`)

A web-style forum for Moot Halls and campaigns, built on package **collections** (ADR 0097): posts
are on-demand records that are queried, paged and searched, never synced to everyone on connect.

## What it does

- **Forums toolbox** on the rail:
  - **+ Section** and **+ Category** buttons (forum admins only);
  - sections are collapsible headers;
  - categories are the boards. A **dot** marks a category with posts by others since you last looked.
- **Workspace tabs.** Clicking a category opens it in its own tab (one per category); "Browse all
  forums" opens the full listing. Inside a tab:
  - main listing → category → thread, with Back and breadcrumbs;
  - threads sorted by latest activity, pinned first, paged;
  - posts oldest first, time-stamped, drawn as Markdown (live `@action` links off);
  - **search** across threads and replies, in one category or all.
- **Roles** are core's package roles, made by admins in the module's settings page (the gear) or in
  the tab's **Roles** button:
  - flags: *admin* (makes sections, categories and roles), *moderator* (pin, lock, edit and remove
    everywhere), *banned* (read only);
  - per-category access: Read, Read & post, Moderate;
  - categories are *open*, *announcements* (everyone reads, roles post) or *private* (only roles
    with access can see it; core enforces this through `role:<name>` readers).
- The GM (a hall's admins) is always a forum admin.

## Layout

| File                | Role                                                              |
| ------------------- | ----------------------------------------------------------------- |
| `tavern.json`       | collections, rail toolbox, tab, settings page, permissions        |
| `rules.js`          | every rule, on the server: permissions, actions, reader labels    |
| `ui/rail.*`         | the toolbox                                                       |
| `ui/board.*`        | the workspace tab                                                 |
| `ui/settings.*`     | the module's settings page (role editor)                          |
| `ui/roles-editor.js`| the role editor, used by settings and the tab                     |
| `ui/common.js`      | helpers shared by both                                            |
| `Feedback/`         | gaps and difficulties for the core team                           |
| `reference/`        | the developer guide and ADRs                                      |

Pages read collections directly and **write only through actions** (there's no
`collections.write` hook), so `rules.js` is the single place permissions live.

## Trying it

1. In the app: Library → **Load package folder…** → this folder.
2. Campaign: Game system → add **Forums**, and allow `ui.rail:forums` and `ui.tab:board`.
   Hall: Modules → add it and allow the same.
3. Open the **Forums** toolbox → **+ Section**, then **+ Category**.
4. Click a category to open its tab. Make roles under the module's gear.

CLI checks (from the installed copy): `node packages/cli/dist/cli.js validate <this folder>` and
`check`. Both pass.

## Known limits (see `Feedback/FEEDBACK.md`)

- Unread is a dot per category, not a count, and per category rather than per thread.
- Role flags and grants are the module's own `role-settings` records, joined to core's roles by name.
- No moving threads between categories.
- Not yet run inside the app: expect small fixes on first load.
