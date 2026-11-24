# Roomie: end-to-end UX and functional audit

- **Date:** 24 November 2026
- **Code audited:** branch `main` at commit `ea36a84` (Phase 6, group chat), plus an uncommitted change still under review that makes chat photos and names link to profiles (`src/lib/profile-links.ts`, `src/components/chat/profile-link.tsx`, and edits to `chat-header.tsx` and `group-chat-room.tsx`).
- **Live database:** Supabase project `roxtxipioqtggnqyhpgs`, migrations 001–016 applied.
- **Method:**
  - I read the code, the migrations and the security rules.
  - I ran the automated checks.
  - I sent plain HTTP requests to the local server with nobody signed in.
  - I looked at the app in a browser, read-only, signed in as the project's own SRM account.
  - I reproduced one privacy problem in a throwaway in-memory copy of the database built from the migrations.
  - Nothing was written to the live database, no application code was changed, and nothing was committed or pushed.

How each finding is labelled:
- **Confirmed:** reproduced, or proven directly by the code or migrations.
- **Code-confirmed:** follows directly from the code, but I didn't click through it in a browser.
- **Suspected risk:** plausible, but not proven.
- **Product decision:** needs a business or policy choice, not just a code fix.

---

## 1. Executive summary

Roomie's foundations are strong. Access control lives in the database, not just in the app:
- row-level security on every table;
- column-level grants, so for example students can't read email addresses;
- security-definer functions that hide internal checks (the block lookup, membership changes);
- SRM eligibility checked on reads, writes, storage uploads and Realtime.

Every automated check passes: 328 of 328 tests, lint, the type check and the production build, with no known vulnerabilities in production dependencies. Every protected page sends signed-out visitors to the sign-in page. Group chat, the newest feature, was tested live end to end on 24 November 2026: two people messaging, blocks in both directions, unread counts, leaving, rejoining and removal all passed.

The audit found problems in four areas.

1. **A confirmed privacy leak (P1).** Private invitation and join-request notes in groups (`group_members.message`) can be read by people who should never see them:
   - ordinary members of a group can read the notes on pending requests;
   - for discoverable groups, *any* eligible student can read the invitation note that stays on each active member's row.

   I reproduced both against a fresh copy of the migrations.
2. **Missing account essentials (P1/P2).** There is no way to reset a forgotten password, no way to delete an account, and no way to report a user.
3. **Blocking is only partly reflected in the app (P2).** The database enforces blocks correctly. But a blocked one-to-one conversation still looks open, messages fail with a generic "Not sent. Tap to retry" that can be tapped forever, and likes from people who blocked you still appear.
4. **Trust and brokerage isn't modelled (P2, needs product decisions).** Listings don't say who is listing (existing tenant, owner or broker). There's no brokerage disclosure and no statement that Roomie doesn't handle payments. The only safety notice appears inside one-to-one chats, not on listings.

**Overall: ready for controlled testing, not yet for a student pilot.** The P1 items (§8, "Immediate") are small and well-contained. Once they and the high-priority items are done, a limited pilot is reasonable.

---

## 2. Feature inventory

Status key: **Working** (verified in a browser or end to end) · **Partially working** · **Broken** · **Not implemented** · **Not verified** (code exists but this audit didn't exercise it).

| Feature | Status | Evidence | Notes |
|---|---|---|---|
| Sign-up restricted to SRM emails | Not verified | `src/app/login/actions.ts` lines 67–93; database trigger (006) | Wasn't run, because it would create an account |
| Email confirmation link | Partially working | `src/app/auth/confirm/route.ts`; a fake code redirected to `/login?error=confirm` (checked) | The success path wasn't run |
| Sign in | Not verified | `authenticate()` | The browser was already signed in; I don't enter passwords |
| Sign out | Not verified | `signOut()` on `/account` and `/restricted` | Not clicked, to avoid ending the test session |
| Password reset | **Not implemented** | No `resetPasswordForEmail` or `updateUser` anywhere in `src/` | Finding F-02 |
| Protected pages for signed-out visitors | Working | Plain HTTP requests to 11 protected pages all redirect to `/login` | Comes back as HTTP 200 with an embedded redirect (F-19) |
| Blocking non-SRM accounts | Working (database) / Not verified (app) | `requireStudent`, `getActionUser`, `is_eligible_student()` policies | Couldn't run a non-SRM session this time |
| Onboarding | Not verified | `src/app/onboarding/*` | The test account is already onboarded |
| Profile editor (7 sections) | Partially working | `/profile/edit` renders with no accessibility issues found | Saves weren't run |
| Profile photos | Not verified | `photos-section.tsx`, storage policies | No upload run; the storage bucket is public (F-08) |
| Public profile page | Working | `/students/[id]` renders; an unknown id shows the 404 page | |
| Profile completeness | Working | `/account` shows "1/5 done" with a to-do list | |
| Discover feed and filters | Working (read-only) | `/discover` shows "Students looking for a place" with a candidate | Likes and passes weren't run |
| Like, pass and match creation | Not verified (live) | Unique (sender, receiver) on likes, unique pair on matches, trigger `handle_mutual_like` | Duplicates are prevented at the database level |
| "Likes You" | Partially working | `src/lib/matches.ts` lines 33–65 | Likes from people who blocked you still show (F-06) |
| One-to-one chat: history and Realtime | Working | Verified in earlier phases; history and composer render today | Only the newest 200 messages load (F-15) |
| One-to-one chat: read state and unread counts | **Not implemented** | No read table and no unread logic for `messages` | F-12 |
| One-to-one chat when a block applies | **Partially working** | `chat-room.tsx` lines 249–272 | F-04 |
| Groups: create, edit, invite, request, roles, leave, remove, rejoin | Working | Live test on 24 November 2026; database tests | Notes leak (F-01) |
| Group chat | Working | Live two-person test on 24 November 2026 | Unread counts only update on page load (F-14) |
| Notifications (group events) | Partially working | `/notifications`; "Mark all read" | Opening a notification doesn't mark it read (F-09); some links lead to a 404 (F-10) |
| Notifications for likes, matches and messages | Not implemented | Notifications only cover group events | Matches tab dot shows only pending likes |
| Listings: create, edit, publish, deactivate, delete | Partially working | `/account/listings` and the listing page render; one live listing | Editing and deleting weren't run; no expiry (F-11) |
| Exact address private | Working (code) | `listing_private_details` readable by owner only (014, lines 243–275); page shows "only you see this" | |
| Brokerage disclosure and lister role | **Not implemented** | No broker or role field; the only mention is a hint in setup cost (`listing-editor.tsx` line 273) | F-07 |
| "Roomie doesn't handle payments" notice | Not implemented | Not found anywhere in the app | F-07 |
| Safety notice on listings | Not implemented | `SafetyTip` used only in `chat-header.tsx` and `chat-room.tsx` | F-07 |
| Blocking: block and unblock UI | Working | Live test on 24 November 2026 (profile page) | No list of blocked people anywhere (F-16) |
| Report a user or content | **Not implemented** | No report feature in code or database | F-05 |
| Account deletion and data export | **Not implemented** | No deletion path in the app | F-03 |
| Install-as-app banner and manifest | Working | Banner shown on `/discover`; `manifest.ts` | |

---

## 3. Findings

Severity: **P0** critical · **P1** major functional or serious security · **P2** significant · **P3** minor.

| ID | Area | Severity | Finding | Evidence | Recommended fix |
|---|---|---|---|---|---|
| F-01 | Groups / privacy | **P1** (confirmed) | **Private invitation and join-request notes are readable by people who shouldn't see them.** `group_members` is fully readable by students (including the `message` column added in 015), and any active member can read every row in their group, including pending `requested` and `invited` rows. When someone joins, the note isn't cleared, and for discoverable groups the active-member list is readable by any eligible student. In a fresh copy of the migrations, a non-admin member read `SECRET-REQUEST-NOTE`, and an unrelated student read `SECRET-INVITE-NOTE` on an active member's row. The app only shows notes to admins, but the database doesn't enforce that. | `supabase/migrations/010_groups.sql` line 574 (`grant select on … group_members`); `011_srm_only_access.sql` lines 249–263 (read policy); `015_groups_experience.sql` lines 81–82 (`message` column), 168–170 and 239–241 (joining keeps `message`) | New migration (017): stop granting `message` to students; expose notes only through a security-definer function limited to that group's admins (and the note's own author); clear `message` when a member becomes active, and clear existing ones. Add database tests for both leaks. |
| F-02 | Authentication | **P1** (code-confirmed) | **No password recovery.** A student who forgets their password can't get back in; only a project admin could help through the Supabase dashboard. | `src/app/login/actions.ts` (only `authenticate` and `signOut`); `src/components/auth/auth-form.tsx`; no reset code anywhere in `src/` | Add "Forgot password?" using `auth.resetPasswordForEmail` with the existing `/auth/confirm` route (type `recovery`), then a page to set a new password through `auth.updateUser`. Keep the SRM-only message and rate-limit wording. |
| F-03 | Account / privacy | P2 (product decision) | **No account deletion or data export.** Students can't remove their profile, photos, listings or messages. | No deletion path in `src/`; `/account` page | Decide the policy: how long data is kept, what happens to messages and group history when someone leaves. Then add a confirmed "Delete account" flow (server side, using the existing `on delete` rules) that also removes stored photos. |
| F-04 | Blocking / one-to-one chat | P2 (code-confirmed) | **A blocked conversation still looks open.** The database refuses new messages across a block ("This conversation is closed."), but the conversation stays in Matches, the chat opens with an active composer, and every send ends as "Not sent. Tap to retry". The database's reason is thrown away, so retrying can never succeed. | `src/components/chat/chat-room.tsx` lines 249–272 (error dropped; only `23505` is handled); `src/lib/matches.ts` lines 113–155 (no block filter); `013_discovery_engine.sql` lines 99–114 | Read the block state when loading the chat, through a function that only answers for the two people in that match. Show "This conversation is closed" instead of the composer, and treat the "closed" error as final, not retryable. Decide whether blocked conversations are hidden from Matches or shown as closed (product decision). |
| F-05 | Trust and safety | P2 (product decision) | **No way to report a user, profile, listing or message, and no limits on sending.** Blocking is the only safety tool, and nothing limits how many likes, messages or invitations someone can send, at the database level or elsewhere. | No report feature in `src/` or `supabase/` | Before a pilot: a "Report" action on profiles, listings and chats, saved to a table only staff can read, with a review process. Consider simple per-user database limits on likes, invitations and messages. |
| F-06 | Blocking / "Likes You" | P2 (code-confirmed) | **"Likes You" ignores blocks made by the other person.** Only likes from people *you* blocked are hidden (students can only read their own blocks). If the sender later blocked you, their like still shows, and liking back fails with "That profile isn't available." | `src/lib/matches.ts` lines 37–52 | Filter pending likes with a database function that checks blocks in both directions without revealing who blocked whom (as `discover_candidates` already does, 013 around line 300). |
| F-07 | Listings / trust / brokerage | P2 (product decision) | **Who is listing, and brokerage, aren't modelled or disclosed.** Listings show only "LISTED BY \<student\>", with no role (existing tenant, owner, broker). A broker's fee can only be folded into "one-time setup", as a hint. Nothing says agreements and payments happen outside Roomie. The safety notice ("meet the owner… before you pay any deposit") appears only in one-to-one chats, not on listings or listing cards, where the money figures are; its "owner" wording also doesn't fit student tenants. | `src/components/ui/safety-tip.tsx` lines 14–18; used only in `chat-header.tsx` and `chat-room.tsx`; `/listings/[id]` page text has no safety, payment or broker wording (checked); `listing-editor.tsx` line 273; `onboarding-wizard.tsx` line 434 | Needs product decisions first (see §5): which roles to allow; whether brokerage must be declared (yes/no and amount); exact notice wording. Then add a "Listed as" field and a brokerage section with its own fee field, show the notice on listing pages and cards, and add a sentence that Roomie doesn't collect, hold or guarantee payments. |
| F-08 | Storage / privacy | P2 (suspected risk / product decision) | **The `roomie-media` bucket is public.** Profile, listing and group photos load for anyone with the URL, without signing in, even though profiles themselves are SRM-only. URLs aren't guessable (they include the user id and a file name) but they can be shared and stay valid. | `supabase/migrations/001_init.sql` lines 421–423 (`public = true`) | Decide whether photos must be SRM-only. If so, make the bucket private and serve short-lived signed URLs, or a server route that checks eligibility. This changes how every photo loads and needs testing. |
| F-09 | Notifications | P2 (confirmed live) | **Opening an update doesn't mark it read.** The Updates count only clears with "Mark all read"; tapping a notification or opening the group leaves it unread, which a student noticed during the 24 November test. | `src/app/notifications/page.tsx` lines 47–50; `src/app/groups/actions.ts` lines 185–197 | Mark a notification read when it's opened (a small action or a read-on-open route), and/or mark group-related notifications read when that group's page is viewed. |
| F-10 | Notifications / groups | P2 (code-confirmed) | **Some notifications lead to a 404.** Every notification links to `/groups/{id}`. After someone is removed, or an invitation is declined or withdrawn, they can't read an invite-only group, so the link shows the 404 page. | `src/app/notifications/page.tsx` line 48; `src/app/groups/[id]/page.tsx` lines 52–54; `010_groups.sql` lines 148–160 (`is_group_involved` excludes removed, declined, left and cancelled) | Don't link notifications whose group you can no longer open, or link to a short explanation page. The group name is already stored on each event (`group_events.group_name`), so the text still reads correctly. |
| F-11 | Listings | P2 (code-confirmed) | **Listings never expire.** A live vacancy stays discoverable until the student deactivates it; there's no "last confirmed" date or reminder, so filled flats will keep showing. | `014_listing_lifecycle.sql` (no expiry logic); `listing-validation.ts` (`available_from` only) | Add a freshness date (`confirmed_at`), show "Confirmed N days ago", hide or flag listings not confirmed in N days (product decision on N), and add a one-tap "Still available". |
| F-12 | One-to-one chat | P2 (code-confirmed) | **No read state or unread counts in one-to-one chat**, while group chat has both. The Matches tab dot only shows pending likes, so a new message gives no signal outside the open chat. | No read table for `messages`; `bottom-nav.tsx` lines 49–69 (`PendingLikes` only) | Reuse the group chat approach: a `match_reads` table, a mark-read function and a summary query, with unread badges on Matches. |
| F-13 | Cross-feature consistency | P3 (confirmed live) | **Conversations with accounts that can no longer use Roomie stay listed without explanation.** Your conversation with toufique (a non-SRM account) appears in Matches with an active composer; that person can still sign in, but only reaches the "SRM students only" page, so they can never read replies. Likes from such accounts are already hidden. | `/matches` (checked); `src/lib/matches.ts` lines 67–89 | Show an "Unavailable" state for conversations with ineligible or deleted accounts and turn off the composer. |
| F-14 | Group chat | P3 (known, documented) | **Group unread counts only update on page load or navigation**, not live. | `src/lib/group-chats.ts` (summaries loaded on render) | Subscribe to `group_messages` from the dashboard or tab bar, or refresh after a Realtime event. |
| F-15 | One-to-one chat | P3 (code-confirmed) | **Only the latest 200 messages load,** with no "Load earlier messages", so older history can't be reached. | `src/lib/matches.ts` lines 25 and 199–204 | Add cursor-based paging like group chat's "Load earlier messages". |
| F-16 | Blocking | P3 (code-confirmed) | **No list of blocked people.** Unblocking means finding the person's profile again; if they're hidden from Discover, that's hard. | Blocking only in `block-control.tsx` on `/students/[id]` | Add a "Blocked students" list under Account. |
| F-17 | Listings / UX | P3 (confirmed live) | **"Living there now: 0 people" on a listing whose poster lives in the flat** is confusing. | `/listings/7764860a…` page (checked) | Rename it to "Other flatmates living there", or count the poster. |
| F-18 | Authentication | P3 (code-confirmed) | **The sign-up confirmation link falls back to `http://localhost:3000`** when the request has no `Origin` header. | `src/app/login/actions.ts` line 72 | Use a configured site URL (for example `NEXT_PUBLIC_SITE_URL`) instead of the header and localhost fallback. |
| F-19 | Routing | P3 (confirmed) | **Protected pages answer signed-out visitors with HTTP 200** plus an embedded redirect to `/login`, rather than a 307, because the check runs inside a streamed section. No private data is sent first. | HTTP checks (§7); `src/lib/profile.ts` lines 91–103 | Optional: redirect signed-out visitors for protected routes in `src/proxy.ts`. Keep the page-level checks as the real gate. |
| F-20 | Accessibility | P3 (confirmed) | **The "roomie." wordmark link is 86×32px**, below the project's 48px minimum. It was the only small target found on the audited pages. | Audit script on `/discover`, `/matches`, `/groups`, `/groups/mine`, `/account` | Give the link `min-h-12` and padding. |
| F-21 | Group chat names | P3 (in the change under review) | **The name link's tap area is about 32px tall**; the photo beside it has the full 48px. | Uncommitted `group-chat-room.tsx` | Already noted in that review; accept, or enlarge with layout changes. |

**What I looked for and didn't find (no issue):**
- **Every server action checks for an eligible student:** all of `account/listings`, `discover`, `groups`, `matches`, `onboarding`, `profile/edit` and `students/[id]`. Inputs are checked as UUIDs before any database call.
- **Each student-level table re-applies the eligibility rule** (011 lines 196–237); practical preferences are owner-only.
- **Likes and matches can't be duplicated** (unique constraints on sender and receiver, and on the matched pair).
- **The `latest_messages` view runs with the reader's permissions.**
- **Realtime subscriptions are cleaned up** (`subscribeAsUser` returns `removeChannel`).
- **Email isn't readable by other students** (`profiles` column grants, 001 lines 299–302).
- **`npm audit`: no known vulnerabilities in production dependencies.**

---

## 4. User journey assessment

1. **Sign-up and sign-in.** Clear SRM-only wording, rejected at sign-up and enforced again by the database. The confirmation email lands on `/account`, which sends new students into onboarding. **Gap:** a forgotten password is a dead end (F-02). Students who confirm on a different device are already warned ("Open it on this device").
2. **Onboarding and profile.** A seven-section editor with a completeness checklist on `/account` ("1/5 done") gives clear next steps. Not exercised live in this audit.
3. **Discover.** Clear heading for what you're seeing, filters, and profile cards with an SRM badge. Blocks apply in both directions here (the database function). Likes and passes weren't run live. Duplicates are prevented by the database.
4. **Likes and matches.** Answering a like sends you straight into the new chat. **Confusing:**
   - a like from someone who later blocked you still appears, and fails when you answer it (F-06);
   - one-to-one chats give no unread signal outside the chat (F-12);
   - conversations with blocked or ineligible people look open but can't work (F-04, F-13).
5. **One-to-one chat.** Live delivery, optimistic send, retry and starter prompts all work. **Where it breaks:** after a block, sends fail with an endless retry and no reason given (F-04); history stops at 200 messages (F-15).
6. **Groups and group chat.** The most complete journey, verified live end to end. **Rough edges:**
   - private notes leak (F-01);
   - Updates don't clear when opened (F-09);
   - some notifications lead to a 404 after removal (F-10);
   - unread counts aren't live (F-14).
7. **Listings.** Owners get a good preview of how others see the listing, a "worth adding" checklist, cost breakdown, move-in total and a private address. **Gaps:**
   - no expiry or freshness (F-11);
   - no lister role or brokerage disclosure (F-07);
   - no safety or payment notice where costs are shown (F-07);
   - the "0 people" wording (F-17).
8. **Account.** Sign-out exists. **Missing:** account deletion (F-03), a blocked-people list (F-16) and reporting (F-05).

---

## 5. Security assessment

**Confirmed issues**
- **F-01 (P1):** group invitation and join-request notes are readable by other members and, in discoverable groups, by any eligible student. Reproduced in a fresh database built from the migrations.

**Potential risks**
- **No limits on sending (F-05):** a single account can send unlimited likes, messages or invitations.
- **The public media bucket (F-08).**
- **No way to report a person, or to investigate a report (F-05).**
- **Protected pages return HTTP 200 for signed-out visitors (F-19).** The page frame is sent but no data, and the real gate holds.

**Verified as sound**
- **Policy coverage:** row-level security is on for every application table, policies require eligibility for reads of others' data and for all writes, and security-definer functions use `search_path = ''`.
- **Locked-down internals:** `is_blocked_pair` and the trigger functions can't be called by students.
- **Group chat:** immutable messages, active-member-only access, blocks in both directions, system messages written only by the database. Applied live, checked and tested on 24 November 2026.
- **Private address:** owner-only (`listing_private_details`).
- **Server side:** signed-in eligibility checks in every action, UUID checks on every route parameter, no secrets in the client bundle (only `NEXT_PUBLIC_SUPABASE_URL` and the publishable key are public).

**Not verified (needs isolated test accounts or an environment where data can be written)**
- What a non-SRM account sees and can do live.
- Storage upload and delete policies, tried from a second account.
- Concurrent edits: two admins acting on the same member, two people taking the last group spot at once.
- Realtime behaviour on poor connections.

**Product decisions to make (not bugs)**
- Who may post listings (only students who live there? brokers?).
- Whether brokerage must be declared.
- The wording that Roomie doesn't handle payments.
- Whether photos must be SRM-only.
- Data retention and deletion.
- How quickly listings go stale.
- Whether blocked conversations are hidden or shown as closed.

---

## 6. UX and accessibility assessment

**What I measured:** I ran the same script on `/discover`, `/matches`, `/groups`, `/groups/mine`, `/account`, `/account/listings`, `/profile/edit` and a listing page. It checked for:
- a page heading (`h1`);
- sideways scrolling;
- controls without a name;
- images without alt text;
- touch targets under 44px.

**Results:**
- every page has exactly one `h1`;
- no sideways scrolling;
- no unnamed controls;
- no images missing alt text;
- the only small target is the wordmark link (F-20).

Empty states are clear and friendly; for example `/groups` shows "No groups yet… Start a group". Loading placeholders exist on every streamed page.

**Keyboard:** the one-to-one chat header was checked with the keyboard (Tab and Enter, with a visible orange focus ring).

**Responsive limitation:** I couldn't resize the browser in this session; it reported a **767px** viewport every time. At that width the app column was 478px, centred, with a matching bottom bar, as designed. **True phone (≈390px) and desktop (≥1280px) layouts were not verified in this audit;** repeat with a resizable browser or device emulation.

**UX consistency:**
- unread signals differ between one-to-one and group chat (F-12, F-14);
- Updates clear only through "Mark all read" (F-09);
- blocked and unavailable conversations look interactive (F-04, F-13).

---

## 7. Test results

All commands were run from the project folder, against the working tree, which includes the uncommitted change under review.

| Command | Result |
|---|---|
| `npm test` (database tests on an in-memory copy of the database, plus unit tests) | **328 tests, 91 suites: 328 passed, 0 failed, 0 skipped** (18.5s) |
| `npm run lint` | **Passed** (no output, exit 0) |
| `npx tsc --noEmit` | **Passed** (exit 0) |
| `npm run build` | **Passed**: 26 pages; protected pages are partly prerendered |
| `npm audit --omit=dev` (read-only) | **0 vulnerabilities** |
| Plain HTTP requests, signed out, to 11 protected pages | All contained `NEXT_REDIRECT;replace;/login` (HTTP 200, F-19); `/auth/confirm?code=bogus` returned 307 to `/login?error=confirm` |
| Reproducing F-01 in a throwaway in-memory database (script kept in a temporary folder, not the repository) | Confirmed both leaks (see F-01) |
| Browser audit (local dev server connected to the live database, signed in as the project's SRM account, read-only) | 8 pages audited (§6); the one-to-one chat header's profile link checked with keyboard and mouse |
| Live group chat test (earlier the same day) | Two-person test, all cases passed except two that need more accounts or time: a third, unrelated member (BLOCKED) and offline and retry handling (NOT TESTED) |

**Limitations:**
- No component-level UI tests exist (the project has no browser test tooling).
- Nothing that writes data was run against the live database: sign-up, onboarding, listing editing, photos, likes and sending messages.
- Phone and desktop widths weren't verified (§6).

---

## 8. Prioritized remediation roadmap

**Immediate (before any student pilot)**
1. **F-01: lock down group notes** (migration 017 plus database tests). No dependencies.
2. **F-02: password reset.** Depends on adding recovery to the Supabase redirect allow-list.
3. **F-04: show blocked conversations as closed,** and treat the error as final. Needs a small database function for the block state; the "hide or show closed" choice can wait.

**High priority**
4. **F-05: reporting**, plus basic limits on likes, messages and invitations. Needs a product decision on who reviews reports.
5. **F-07: lister role, brokerage disclosure, the payments notice, and the safety notice on listings.** Needs the product decisions in §5 first.
6. **F-06: blocks applied in both directions in "Likes You".** Shares the block-state function with item 3.
7. **F-09 and F-10: notification read-on-open, and safe links.**
8. **F-03: account deletion**, once the data-retention policy is decided.

**UX improvements**
9. F-12: unread counts for one-to-one chat, reusing the group chat approach.
10. F-11: listing freshness and expiry.
11. F-13: unavailable-conversation state.
12. F-14: live unread counts.
13. F-15: paging through older one-to-one messages.
14. F-16: blocked-people list.
15. F-17: listing wording.
16. F-20: wordmark tap area.

**Longer term**
17. F-08: private media with signed URLs. Touches every photo, so do it after everything above.
18. Browser test tooling (for example Playwright) with isolated test accounts in a separate Supabase project, so flows that write data can be tested without touching live data.
19. F-18 and F-19: configured site URL; redirect signed-out visitors in the proxy.

**Dependencies:**
- Items 3 and 6 share one block-state function.
- Item 5 waits on the product decisions.
- Item 8 waits on the retention policy.
- Item 17 touches every photo, so do it last.
- Item 18 should come before large UI changes, so they can be tested without touching live data.

---

## 9. Recommended next development phase

**Phase 7: Trust, safety and account essentials.** Fix the confirmed privacy leak and close the gaps a real pilot would hit first:
1. Migration 017 for the group-notes leak, with tests.
2. Password reset.
3. Block-aware one-to-one chat and "Likes You", using one shared function that doesn't reveal who blocked whom.
4. Reporting, plus basic limits on how fast someone can send.
5. Listing trust: the lister role, the brokerage disclosure, and the safety and payment notices on listings, after the product decisions.
6. Notifications marked read when opened, and safe notification links.

Account deletion and one-to-one unread counts could follow as Phase 8, alongside the browser test tooling and the separate test environment.

---

## 10. Final assessment

**Roomie is ready for controlled testing, and not yet ready for a limited student pilot.**

**Evidence for:**
- Access is enforced in the database for SRM eligibility, ownership, membership and blocks.
- All 328 automated tests, lint, the type check and the build pass, with no dependency vulnerabilities.
- Group chat was verified live with two real accounts across messaging, blocks, unread counts and every membership change.
- Pages handle empty and loading states, and the audited pages passed the basic accessibility checks.

**Evidence against a pilot today:**
- A confirmed privacy leak of private group notes (F-01).
- No password recovery (F-02).
- No reporting or sending limits (F-05).
- Blocked conversations still look usable (F-04).
- No brokerage or payment disclosures on listings (F-07). That needs product decisions, but it matters for trust in the local accommodation market.

Once the **Immediate** items and items 4–6 of the High-priority list are done, a limited pilot with a small group of SRM students is reasonable, ideally with the separate test environment (item 18) in place for safe regression testing.
