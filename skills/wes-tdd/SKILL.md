---
name: wes-tdd
description: >-
  Use when implementing new features, fixing bugs, or refactoring code in the
  WorkEvolutionSys repository. Enforces RED-GREEN-REFACTOR cycle. Triggers:
  "implement feature", "fix bug", "refactor", "添加功能", "修复bug", "重构",
  "write tests", "TDD", "test first", "先写测试".
---

# WES Test-Driven Development

## Overview

Enforce RED-GREEN-REFACTOR cycle for all code changes in WorkEvolutionSys. Write the failing test first, watch it fail, write minimal code to pass, then refactor.

Core principle: **Tests are not an afterthought — they are the specification.**

## Required Context

Before implementing, read from the project root:

1. `AGENTS.md` — architecture boundaries and conventions
2. `codex-project-registry.md` — verification commands
3. The existing tests for the target domain (`apps/api/src/modules/<domain>/*.test.ts`)
4. `package.json` — test scripts and dependencies

## WES Test Infrastructure

### Test Commands

```bash
# Module tests (primary)
npm run test:modules

# Integration tests
npm run test:integration

# AI service tests
npm run test:ai

# Rules/estimate logic tests
npm run test:rules

# Harness tests (PostgreSQL)
npm run test:harness -w apps/api

# Frontend tests
npm run test --prefix ui/V2_PROTOTYPE

# All tests
npm run test:all
```

### Test File Conventions

| Domain | Test File Location |
|--------|-------------------|
| API modules | `apps/api/src/modules/<domain>/<domain>.test.ts` |
| Integration | `apps/api/src/routes/*.test.ts` |
| AI services | `apps/api/src/services/ai/*.test.ts` |
| Rules engine | `apps/api/src/rules/*.test.ts` |
| Harness | `apps/api/src/modules/harness/*.test.ts` |

### Test Dependencies

- `vitest` — test runner (Vite projects)
- `jest` — test runner (API modules)
- `supertest` — HTTP endpoint testing
- `@testcontainers/postgresql` — Harness DB tests

## RED-GREEN-REFACTOR Cycle

### RED: Write a Failing Test

1. Identify the behavior to implement
2. Write the smallest test that demonstrates the missing behavior
3. Run the test — confirm it FAILS for the expected reason
4. If the test passes, the behavior already exists or the test is wrong

Example (WES module pattern):

```typescript
// apps/api/src/modules/estimates/estimates.usecase.test.ts
import { describe, it, expect } from 'vitest';
import { calculateEstimate } from './estimates.usecase';

describe('calculateEstimate', () => {
  it('should return correct total days for valid input', () => {
    // Arrange
    const modules = [
      { name: '财务云', standardDays: 10, suggestedDays: 12 },
      { name: '供应链云', standardDays: 15, suggestedDays: 18 },
    ];

    // Act
    const result = calculateEstimate(modules);

    // Assert
    expect(result.totalStandardDays).toBe(25);
    expect(result.totalSuggestedDays).toBe(30);
  });

  it('should handle empty module list', () => {
    const result = calculateEstimate([]);
    expect(result.totalStandardDays).toBe(0);
    expect(result.totalSuggestedDays).toBe(0);
  });

  it('should throw for negative days', () => {
    expect(() => calculateEstimate([
      { name: 'Invalid', standardDays: -1, suggestedDays: 5 },
    ])).toThrow('Standard days cannot be negative');
  });
});
```

Run the test — confirm it FAILS:
```bash
npm run test:modules -- estimates.usecase.test.ts
# Expected: FAIL (function not implemented yet)
```

### GREEN: Write Minimal Code to Pass

Write the smallest amount of code to make the test pass. No more, no less.

```typescript
// apps/api/src/modules/estimates/estimates.usecase.ts
export function calculateEstimate(modules: Array<{
  name: string;
  standardDays: number;
  suggestedDays: number;
}>) {
  if (modules.some(m => m.standardDays < 0 || m.suggestedDays < 0)) {
    throw new Error('Standard days cannot be negative');
  }

  return {
    totalStandardDays: modules.reduce((sum, m) => sum + m.standardDays, 0),
    totalSuggestedDays: modules.reduce((sum, m) => sum + m.suggestedDays, 0),
  };
}
```

Run the test — confirm it PASSES:
```bash
npm run test:modules -- estimates.usecase.test.ts
# Expected: PASS
```

### REFACTOR: Clean Up

With tests passing, improve the code:

- Remove duplication
- Improve naming
- Simplify logic
- Add types

**Rule:** After each refactor, run the tests. If they fail, undo and try again.

```typescript
// Refactored version
interface EstimateModule {
  name: string;
  standardDays: number;
  suggestedDays: number;
}

interface EstimateResult {
  totalStandardDays: number;
  totalSuggestedDays: number;
}

function validateModules(modules: EstimateModule[]): void {
  const invalid = modules.find(
    m => m.standardDays < 0 || m.suggestedDays < 0
  );
  if (invalid) {
    throw new Error(`Module "${invalid.name}" has negative days`);
  }
}

function sumDays(modules: EstimateModule[], key: 'standardDays' | 'suggestedDays'): number {
  return modules.reduce((sum, m) => sum + m[key], 0);
}

export function calculateEstimate(modules: EstimateModule[]): EstimateResult {
  validateModules(modules);

  return {
    totalStandardDays: sumDays(modules, 'standardDays'),
    totalSuggestedDays: sumDays(modules, 'suggestedDays'),
  };
}
```

Run the tests again — confirm they still PASS.

## WES-Specific TDD Patterns

### API Route Testing

```typescript
// apps/api/src/modules/auth/auth.routes.test.ts
import request from 'supertest';
import { app } from '../../app';

describe('POST /api/v1/auth/login', () => {
  it('should return JWT token for valid credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'testuser', password: 'testpass' });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.token).toBeDefined();
    expect(typeof res.body.data.token).toBe('string');
  });

  it('should return 401 for invalid credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'testuser', password: 'wrongpass' });

    expect(res.status).toBe(401);
    expect(res.body.code).not.toBe(0);
  });
});
```

### Repository Testing (JSON Storage)

```typescript
// apps/api/src/modules/versions/versions.repository.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { VersionsRepository } from './versions.repository';
import { clearTestData, seedTestData } from '../../../test/helpers';

describe('VersionsRepository', () => {
  let repo: VersionsRepository;

  beforeEach(() => {
    clearTestData('versions');
    repo = new VersionsRepository();
  });

  it('should create a new version record', async () => {
    const version = await repo.create({
      projectId: 'proj-001',
      versionCode: 'V01',
      status: 'checked_in',
    });

    expect(version.id).toBeDefined();
    expect(version.status).toBe('checked_in');
  });

  it('should not allow duplicate version codes for same project', async () => {
    await repo.create({ projectId: 'proj-001', versionCode: 'V01', status: 'checked_in' });

    await expect(repo.create({
      projectId: 'proj-001',
      versionCode: 'V01',
      status: 'checked_in',
    })).rejects.toThrow('Version code already exists');
  });
});
```

### Repository Testing (PostgreSQL / Harness)

```typescript
// apps/api/src/modules/harness/harness.repository.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { HarnessRepository } from './harness.repository';

describe('HarnessRepository', () => {
  let container: PostgreSqlContainer;
  let repo: HarnessRepository;

  beforeAll(async () => {
    container = await new PostgreSqlContainer().start();
    repo = new HarnessRepository(container.getConnectionUri());
    await repo.migrate();
  });

  afterAll(async () => {
    await container.stop();
  });

  it('should create a harness run', async () => {
    const run = await repo.createRun({
      sessionId: 'sess-001',
      modelName: 'kimi',
      status: 'running',
    });

    expect(run.id).toBeDefined();
    expect(run.status).toBe('running');
  });
});
```

### Frontend Component Testing

```typescript
// ui/V2_PROTOTYPE/src/components/EstimateCard.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EstimateCard } from './EstimateCard';

describe('EstimateCard', () => {
  it('should display module name and days', () => {
    render(<EstimateCard moduleName="财务云" standardDays={10} suggestedDays={12} />);

    expect(screen.getByText('财务云')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('should highlight when suggested exceeds standard', () => {
    render(<EstimateCard moduleName="财务云" standardDays={10} suggestedDays={15} />);

    expect(screen.getByTestId('suggested-days')).toHaveClass('warning');
  });
});
```

## Testing Anti-Patterns

### Don't Test Implementation Details

```typescript
// BAD: Tests internal state
it('should set internal flag', () => {
  const service = new MyService();
  service.process();
  expect(service['internalFlag']).toBe(true); // Fragile
});

// GOOD: Tests observable behavior
it('should return processed result', () => {
  const service = new MyService();
  const result = service.process();
  expect(result).toBe('expected output'); // Stable
});
```

### Don't Mock What You Don't Own

```typescript
// BAD: Mocking external library internals
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(() => ({ userId: '123' })),
}));

// GOOD: Mock at the boundary (HTTP layer)
const mockResponse = { status: 200, body: { code: 0, data: { token: 'valid' } } };
```

### Don't Write Tests for Trivial Code

```typescript
// BAD: Testing getter
it('should return name', () => {
  expect(user.name).toBe('John'); // Trivial
});

// GOOD: Testing behavior with side effects
it('should update name and persist', async () => {
  await user.updateName('Jane');
  expect(await db.findUser(user.id)).toHaveProperty('name', 'Jane');
});
```

## Test Coverage Guidelines

| Layer | Minimum Coverage | Focus |
|-------|-----------------|-------|
| Usecase | 90% | Business logic, edge cases, error paths |
| Repository | 80% | CRUD operations, query correctness |
| Controller | 70% | Input validation, response format, auth |
| Routes (Integration) | 60% | End-to-end happy path + key error paths |
| Frontend Components | 70% | User interactions, conditional rendering |

## Running Tests During Development

```bash
# Watch mode for rapid TDD cycle
npm run test:modules -- --watch

# Run specific test file
npm run test:modules -- estimates.usecase.test.ts

# Run with coverage
npm run test:modules -- --coverage

# Debug specific test
npm run test:modules -- --reporter=verbose estimates.usecase.test.ts
```

## Verification Before Commit

Before marking a task complete:

```bash
# Full verification suite
npm run test:modules
npm run test:integration
npm run test:ai
npm run build:api
npm run build:web
```

All tests must pass. If a test fails:
1. Determine if the test or the code is wrong
2. Fix the failing side
3. Re-run until green

## Board Sync

After TDD cycle completes, update:

- `03_技术设计/系统架构/WES-Agent-升级总看板/testing.html` — record test cases, coverage, execution status
- `03_技术设计/系统架构/WES-Agent-升级总看板/changes.html` — record implementation evidence

## Common TDD Mistakes

| Mistake | Correction |
|---------|-----------|
| "I'll write tests later" | Write the test first. If you can't write the test, you don't understand the requirement. |
| "The test is too simple" | Simple tests are good. They document behavior clearly. |
| "I need to refactor first" | Only refactor with passing tests. Red → Green → Refactor, always in that order. |
| "This change is too small for tests" | Small changes break things too. Every change gets a test. |
| "Testing is slowing me down" | Tests slow you down once; they speed you up forever. |

---

*本 Skill 版本：v1.0.0*
*对应系统版本：WorkEvolutionSys / WES TDD*
*最后更新：2026-08-06*
