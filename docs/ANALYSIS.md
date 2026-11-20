# CloudPulse — System Analysis

This document covers deliverable 1 of the assignment: the problem, the people involved, what the system must do (functional requirements) and how well it must do it (non-functional requirements). The design that follows from it is in [DESIGN.md](DESIGN.md).

## 1. Problem statement

A growing IT service organization handles infrastructure and cloud requests (new VMs, health checks, configuration changes, audits, access resets) by hand: through email, chat and spreadsheets. As a result:

- **Updates are slow.** Submitters have to ask for progress, and supervisors find out about problems late.
- **No one sees the whole picture.** There is no single view of what is waiting, running, failed or done.
- **Nothing is checked.** Risky work (production changes, access resets) can start without anyone approving it, and there is no record of who did what.
- **Long jobs block people.** Someone has to babysit each long operation instead of handing it off and getting notified.

### 1.1 Business objectives

| # | Objective | How CloudPulse meets it |
|---|---|---|
| O1 | Cut the time between a change and the people who care hearing about it | Changes are pushed over WebSockets the moment they happen, with no refresh or polling |
| O2 | One place to see every request and its progress | Shared request list with search and filters, a per-request timeline and a live queue panel |
| O3 | Control and accountability | Four-eyes approval before any work starts; every change is an event with who, when and what |
| O4 | Handle many requests at once without slowing the app | Background worker pool processes requests concurrently, apart from the API |
| O5 | Recover from failures without manual clean-up | Automatic retries with backoff; jobs left behind by a crashed worker are picked up again |

### 1.2 Users

| Role | Who | What they need |
|---|---|---|
| **Operator** | Engineers and service desk staff who raise requests | Submit requests quickly, see only their own, follow progress live, cancel if plans change (one or several at once) |
| **Supervisor** | Team leads who run the queue | See every request, approve or reject, change priority, add notes, retry failures, approve, reject or cancel in bulk |
| **Admin** | Platform owner | Everything a supervisor can do, plus managing users: their roles, and deactivating or reactivating accounts |

Anyone can sign up; new accounts start as **Operator**. An admin promotes people to Supervisor. The first admin is created with a seed script.

### 1.3 Assumptions

1. **Processing is simulated.** Each category runs a realistic sequence of steps (e.g. VM provisioning: validate → check capacity → allocate → create disk → configure network → smoke test). Each step takes a set time and may fail at random, so progress, retries and cancellation work end to end. In production, each step would call a cloud provider or automation tool.
2. **One organization, one deployment.** Multi-tenancy, billing and SLAs are out of scope.
3. **Users are internal staff** using modern browsers on desktop or mobile. Accounts use email and password; single sign-on is out of scope.
4. **A request needs approval before it runs**, and nobody may approve their own request (four-eyes rule).
5. **One PostgreSQL database** stores all data and also acts as the job queue. That is enough at this scale and removes the need for a separate broker such as Redis or RabbitMQ.
6. **Requests are never hard-deleted.** Finished requests stay for audit; the schema has a `deleted_at` column for soft deletion.
7. **Several people may share a browser** (e.g. a shift desk), so a browser can keep up to five accounts signed in and switch between them.

### 1.4 Scope

**In scope**

- Sign-up, login, sessions with "Remember me", several saved accounts per browser, logout
- Role-based access (Operator, Supervisor, Admin), user role management and account deactivation
- Bulk actions on selected requests (approve, reject, cancel) and approve-all for a filtered view
- Rate limiting of login and sign-up
- The request lifecycle: submit → approve or reject → queued → processing → completed, failed or cancelled; plus retry
- Background processing with configurable concurrency, retries and crash recovery
- Live updates over WebSockets for lists, details, the queue panel and notifications
- Search, filters (status, category, priority, submitted-within time window) and paging
- A responsive web interface with light and dark themes

**Out of scope**

- Real cloud integrations (steps are simulated; see assumption 1)
- Email or SMS notifications, password reset by email, SSO
- File attachments, comments threads, SLAs and reporting dashboards beyond the live queue panel
- Multi-tenancy

## 2. Functional requirements

Priority: **M** = must have (the assignment's required features), **S** = should have (adds real value), **C** = could have (extra).

### 2.1 Accounts and access

| ID | Requirement | Pri |
|---|---|---|
| FR-1 | A visitor can create an account with full name, email and password; the account starts as Operator. Emails are unique. | M |
| FR-2 | A user can log in with email and password and choose "Remember me" (30 days, survives browser restarts) or a normal session (8 hours, ends when the browser closes). | M |
| FR-3 | A browser can keep up to 5 accounts signed in and switch between them without a password. Logging in again as an account already signed in shows a warning first. | S |
| FR-4 | A user can log out of one account or of every account in the browser. | M |
| FR-5 | An admin can list and search users and promote an Operator to Supervisor or demote a Supervisor to Operator. The change takes effect immediately, including on open WebSocket connections. An admin can also deactivate an Operator or Supervisor (not themselves or another admin), which revokes every session and signs out their open tabs, and reactivate them later. | S |
| FR-6 | Every API route checks the user's current role on each request; operators can only see their own requests. | M |

### 2.2 Service requests

| ID | Requirement | Pri |
|---|---|---|
| FR-7 | A user can submit a request with title, optional description, category, priority, environment (development, staging, production) and target. The input is validated on the client and the server. | M |
| FR-8 | Submitting twice by accident (double click, network retry) creates only one request (idempotency key). | S |
| FR-9 | Each request gets a readable code (e.g. `REQ-261119-AED4`) and starts as **Awaiting approval**. | M |
| FR-10 | Users can view requests: operators see their own, supervisors and admins see all. The list pages through results. | M |
| FR-11 | Users can search by code or title and filter by status (or "Active"), category, priority and submission time (last 1 minute, 5, 15 or 30 minutes, 1 hour, 6 hours, 24 hours, 7 days, 30 days). Filters are kept in the URL so links and Back keep the view. | M |
| FR-12 | A request page shows its details, live progress, current step, latest job attempt and a full event timeline. | M |
| FR-13 | A supervisor or admin can approve or reject (with a reason) a request awaiting approval, but never one they submitted. | M |
| FR-14 | A supervisor or admin can approve every request awaiting approval that matches the current filters in one action. Their own requests are skipped, and requests submitted after they opened the confirmation are left out. Users can also select requests in the list and approve, reject (with one reason) or cancel them together; each is checked like the single action, and any that can't change are reported. | S |
| FR-15 | A supervisor or admin can change a request's priority (which moves it in the queue) and add notes to its timeline. | M |
| FR-16 | The submitter, or any supervisor or admin, can cancel a request that hasn't finished. A running job stops at its next step. | M |
| FR-17 | A supervisor or admin can retry a failed request from the start. | S |
| FR-18 | Changes that conflict are refused: if someone else changed the request since you loaded it, you get a clear message instead of overwriting their change. | M |

### 2.3 Processing and live updates

| ID | Requirement | Pri |
|---|---|---|
| FR-19 | Approved requests are processed in the background, several at a time, highest priority first, then oldest first. | M |
| FR-20 | Processing reports progress (0–100 %) and the current step as it goes. | M |
| FR-21 | A failed attempt is retried automatically with growing delays (2 s, 4 s, …) up to a set number of attempts; then the request is marked Failed with the reason. | S |
| FR-22 | Every change reaches the browsers that are allowed to see it within about a second, without a refresh: the list, the detail page and the queue panel update by themselves. | M |
| FR-23 | Users get a notification when someone else moves their request along (approved, rejected, started, finished), and supervisors when a new request needs approval. | S |
| FR-24 | Supervisors and admins see a live queue panel: requests per status, jobs per status and what each worker slot is processing right now. | S |
| FR-25 | The app shows whether live updates are connected, and catches up on anything missed after reconnecting. | S |

### 2.4 Navigation and usability

| ID | Requirement | Pri |
|---|---|---|
| FR-26 | Every page has breadcrumbs and a Back button that returns to the previous view (keeping its filters) or, if the page was opened directly, to its parent page. | S |
| FR-27 | The interface works on phones, tablets and desktops and supports light and dark themes. | M |

## 3. Non-functional requirements

| ID | Quality | Requirement | Why it matters | How it is met |
|---|---|---|---|---|
| NFR-1 | **Responsiveness** | The API keeps answering in well under 200 ms (local) while long jobs run. | Long jobs must not freeze the app (stated in the brief). | Jobs are asynchronous tasks waiting on I/O; password hashing runs on libuv's thread pool. Nothing CPU-heavy runs on the event loop. |
| NFR-2 | **Real-time** | Changes reach connected clients in about a second, without polling as the main mechanism. | Mandatory in the brief; it is the core value (O1). | Socket.IO pushes `request.changed` events into rooms; the client updates its cache in place. |
| NFR-3 | **Performance** | Lists stay fast as data grows. | Supervisors filter large lists all day. | Paged queries (max 100 rows) and partial indexes for the queue, per-operator lists and in-flight requests. |
| NFR-4 | **Concurrency and correctness** | A request is never processed twice at once, even with several worker pools. | Running a provisioning job twice wastes money or breaks things. | Atomic job claim (compare-and-set), lock token plus lease, and a unique partial index allowing only one active job per request. |
| NFR-5 | **Reliability** | No request is lost if a worker or the server stops mid-job. | Requests are commitments to users. | Leases expire and jobs are re-queued; orphaned approved requests are re-queued on startup; graceful shutdown hands running jobs back. |
| NFR-6 | **Data integrity** | Concurrent edits never silently overwrite each other; the history can be trusted. | Several supervisors work the same queue. | Optimistic locking (`version`), status changes allowed only along defined transitions, final states never change, CHECK constraints in the database. |
| NFR-7 | **Security** | Only signed-in users get in; each user sees only what their role allows; sessions resist theft. | Requests describe production infrastructure. | scrypt password hashing (OWASP cost), short-lived JWT access tokens (10 min) plus rotating refresh tokens stored only as hashes, httpOnly/SameSite/Secure cookies, rate limiting of login and sign-up per IP and per email, role read from the database on each request, the same response time for unknown emails and wrong passwords, generic 500 errors, WebSocket origin check, and sockets closed when their token expires. |
| NFR-8 | **Accountability** | Every change records who made it and when. | Audit and post-incident review (O3). | Append-only `request_events` table; `approved_by_id` and `approved_at` on each request. |
| NFR-9 | **Scalability** | Able to grow from one server to several without redesign. | The organization is growing. | Stateless API (JWT), database-backed queue safe for several workers, configurable `WORKER_CONCURRENCY`. Several servers would need the Socket.IO Redis adapter (see DESIGN §8). |
| NFR-10 | **Availability** | The UI degrades gracefully when the connection drops. | Networks fail. | Live status indicator, automatic reconnect with backoff, token refresh then reconnect, and a full refetch after reconnecting. |
| NFR-11 | **Usability** | A new user can submit and follow a request without training. | Adoption. | Plain-language labels and hints per category, inline validation messages, toasts, empty and error states, breadcrumbs and Back. |
| NFR-12 | **Maintainability** | Clear layers and one source of truth for rules. | The system will keep changing. | Controller → service → repository on the backend; lifecycle rules in one file; typed contract shared by ORM and code; zod schemas; 114 unit tests. |
| NFR-13 | **Configurability** | Behaviour is tuned without code changes, and bad settings fail fast. | Different environments need different settings. | Every setting is an environment variable validated with zod at startup, with a clear error message. |
