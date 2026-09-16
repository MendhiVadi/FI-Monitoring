# Codebase organization plan

Prepared before source changes, 2026-09-14.

## Findings and constraints

The frontend mixes infrastructure, domain rules, subscriptions, and routing in
`src/lib`; feature components are scattered across pages/components/data/scenes.
OfficerPortal combines state, mutations, rendering helpers and styles (about 60 KB).
ReportIssue embeds three independently useful screens. The backend index combines
eight exported handlers with initialization, secrets, authorization and status data.
Tests and operational scripts share a directory. Root documentation contains an
outdated absolute workspace path and lacks a developer entry point.

Many files already have uncommitted edits, including security and OTP changes.
Preserve their current contents; do not reset, stage, commit, deploy, send messages,
modify credentials, or touch the ignored Read-Only-Folder. Keep one writer.

## Target structure and ownership

- `frontend/src/app`: routing, route preloading, global styles.
- `frontend/src/features/auth`: login, session and route protection.
- `frontend/src/features/reporting`: reporting flow, verification, form, confirmation,
  map picker, district data, feature styles and types.
- `frontend/src/features/tickets`: live subscription, ticket types, status presentation,
  deterministic decision rules and ticket list.
- `frontend/src/features/officer-portal`: page, state/mutation hook, helpers and styles.
- `frontend/src/features/home`: landing page, forest map, globe, data and animation.
- `frontend/src/features/legal`: policy pages.
- `frontend/src/shared`: Firebase clients, HTTP URL helper, common layout and formatting.
- `functions/src/platform`: Admin SDK singleton and secret definitions.
- `functions/src/features/{disputes,otp,tickets,whatsapp}`: domain services and handlers.
- `functions/src/index.ts`: explicit deployment exports only.
- `functions/tests`: offline regression and emulator authorization tests.
- `functions/scripts`: deliberate operational actions, including real messaging checks.
- `docs`: architecture, debugging and this migration record.

Keep deployment-sensitive roots (`frontend/api`, `frontend/public`, `frontend/android`,
Firebase configuration, package roots) in place. Keep dependency versions, route URLs,
callable names, regions, parameters, secret bindings, data schemas, CSS values and
security rules unchanged. Shared code must not import feature UI. Pure ticket rules
must depend on ticket types rather than React subscription modules.

## Execution sequence

1. Capture baseline builds, lint, backend regression and Firestore rules tests.
2. Save a local pre-migration source snapshot outside the repository for comparison.
3. Move frontend files by feature and rewrite static/dynamic relative imports against
   the complete move map. Preserve lazy route loading and stylesheet import order.
4. Extract existing reporting components; separate portal state, helpers and styles;
   separate login styles and ticket interfaces. Avoid UI or business-rule rewrites.
5. Split backend handlers and infrastructure without changing handler bodies or
   deployment exports; relocate tests and fix their compiled-source paths.
6. Add root commands and documentation, plus an import boundary check so misplaced
   code and dependency cycles fail verification instead of silently accumulating.
7. Run production build, lint, backend regression, rules tests and boundary checks.
   Compare extracted code with the snapshot. Record failures honestly and separate
   local verification from live sign-in, OTP delivery and deployment.

## Completion criteria

Every application module has a clear owner, deploy/runtime entry points still
resolve, extracted handlers preserve behavior, baseline checks have no new failures,
and a developer can locate the responsible files and run checks from the root.
Document remaining large views instead of claiming every component needs splitting.

## Recovery

No changes from this migration are staged or committed; pre-existing staged work is preserved. A pre-migration source snapshot and path map
are retained outside the repository; restore only migrated files if required, never
use a blanket Git reset against this already-dirty worktree.

## Execution record — 2026-09-15

Completed the feature moves, reporting component extraction, login and portal behavior
hooks, styles/helpers/types separation, backend handler split, test relocation, root
commands and documentation. Header/footer belong to `app/layout` because the header
composes auth and route preloading; shared code remains independent of features.
Removed only empty legacy source directories after the moves.

Verification:

- `npm run check` passed: 66 source modules checked, frontend lint, production frontend
  build, backend build and seven offline regression tests.
- Nine Firestore rules tests passed against `demo-forestwatch` after relocation.
- 62 snapshot comparisons passed for moved modules, extracted handler/component bodies,
  login and portal markup, styles and state/mutation behavior. Comparisons normalize
  module paths, comments and line endings; they do not prove live service behavior.
- Six pre-existing lint warnings and existing large-bundle warnings remain.
- `git diff --check` found no whitespace errors.
- Local browser smoke check: login and reporting phone-verification screens render;
  opening `/officer-portal` while signed out redirects to `/login`. The browser
  interaction check for the forgot-password button was inconclusive because its
  automation click timed out; no real login or OTP submission was attempted.

The pre-migration source snapshot and move map are at
`C:\Users\medha\AppData\Local\Temp\land-dispute-before-20260914`.
This is a temporary local recovery aid, not a committed backup or long-term archive.
The migration did not deploy, send messages, change security rules, or exercise real
officer authentication. Remaining release checks are listed in `DEBUGGING.md`.
