// Shared E2E environment contract.
//
// The E2E suite runs against a DEDICATED server instance and a DEDICATED
// SQLite database so it never touches the development/production data on
// port 3002. All safety-relevant overrides are test-only:
// - NODE_ENV=test            → enables the test-only auth rate-limit headroom
//                              (production always keeps 30 attempts/15min).
// - ENABLE_TEST_ROUTES=true  → explicit opt-in for /api/test/* (never in prod).
// - DEMO_AUTOPLAY=false      → the demo walk director must not churn agent
//                              lifecycle statuses during assertions.
// - HERMES_RUNTIME_VERIFIED=false → task assignment must NOT dispatch real
//                              Hermes runs; lifecycle events are simulated
//                              through the HMAC-signed webhook instead.
// - HERMES_API_URL dead port → the runtime watchdog deterministically sees
//                              "disconnected" and never emits churn events
//                              mid-suite (first tick only records state).
// - DATABASE_PATH            → isolated, freshly seeded E2E database.
//
// Secrets/credentials (SESSION_SECRET, HERMES_WEBHOOK_SECRET,
// INITIAL_DIRECTOR_*) come from the process environment / repo-root .env.
// dotenv never overrides variables that are already set.

export const E2E_PORT = 3102;
export const E2E_DB_PATH = 'storage/database/e2e-test.sqlite';

export const E2E_ENV = {
  NODE_ENV: 'test',
  PORT: String(E2E_PORT),
  HOST: '127.0.0.1',
  DATABASE_PATH: E2E_DB_PATH,
  ENABLE_TEST_ROUTES: 'true',
  DEMO_AUTOPLAY: 'false',
  HERMES_RUNTIME_VERIFIED: 'false',
  HERMES_API_URL: 'http://127.0.0.1:59999'
};

// Dedicated, isolated agents — one per lifecycle test, all seeded 'idle'.
export const E2E_AGENTS = [
  { id: 'inst_e2e_success', profileId: 'prof_dev_backend', displayName: 'E2E Success Agent', roomId: 'room_dev' },
  { id: 'inst_e2e_failure', profileId: 'prof_qa_engineer', displayName: 'E2E Failure Agent', roomId: 'room_qa' },
  { id: 'inst_e2e_disconnect', profileId: 'prof_dev_frontend', displayName: 'E2E Disconnect Agent', roomId: 'room_dev' },
  { id: 'inst_e2e_recovery', profileId: 'prof_uiux_designer', displayName: 'E2E Recovery Agent', roomId: 'room_uiux' },
  { id: 'inst_e2e_refresh', profileId: 'prof_research_analyst', displayName: 'E2E Refresh Agent', roomId: 'room_research' }
];