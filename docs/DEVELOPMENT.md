# Development & Testing Guide

## 1. Directory Structure Conventions

- `config/`: System and environment configuration loaders.
- `src/database/`: SQLite connection setup, migrations runner, and data repositories.
- `src/modules/`: Domain modules containing routes, controllers, and services.
- `src/integrations/hermes/`: Outbound adapter and inbound webhook event processing pipeline.
- `src/realtime/`: WebSocket gateway and event distribution pub/sub.
- `src/middleware/`: Express security and request pipeline middlewares.
- `public/`: Isometric SVG Virtual Office frontend and Director operations dashboard.
- `tests/`: Vitest test suites (unit & integration).

## 2. Running Migrations and Seeds

```bash
# Run all pending migrations
npm run migrate

# Seed database with the 12 isometric rooms, initial Director, and Demo agents
npm run seed

# Run health check
npm run health-check

# Backup SQLite database
npm run backup
```

## 3. Running Test Suites

```bash
# Run all vitest tests
npm test

# Run tests in watch mode
npm run test:watch
```

## 4. Coding Standards

- Use ES Modules (`import`/`export`).
- Always use prepared statements (`db.prepare(...)`) with `better-sqlite3`.
- Always wrap multi-table modifications in `db.transaction(...)`.
- Validate all route parameters and request bodies before touching repositories.
- Broadcast changes to WebSocket clients through `realtime/event-publisher.js`.
