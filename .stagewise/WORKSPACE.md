# WORKSPACE

## SNAPSHOT

type: monorepo  
langs: TypeScript, Vue 3, Node.js  
runtimes: Node.js 22+  
pkgManager: npm (workspaces)  
deliverables: api | web (Next.js)
rootConfigs: package.json, tsconfig.json (per package), docker-compose.yml, Dockerfile.api  

---

## PACKAGES

| name | path | type | deps | usedBy | role |
|------|------|------|------|--------|------|
| workload-evaluation-system | . | monorepo | @workload/api | — | root coordinator |
| @workload/api | apps/api | service | express, jsonwebtoken, bcryptjs, multer, xlsx, pdfkit | web | backend API, rules engine, export |
| @workload/web | ui/V0_SAAS | app | next, react, typescript | — | Next.js frontend, assessment UI |

---

## DEPENDENCY GRAPH

ui/V0_SAAS → @workload/api (/api/v1/*)  
@workload/api → config/ (file-based: users, invites, rules, templates, teams, versions)

---

## ARCHITECTURE

### @workload/api (apps/api)

entry: apps/api/src/main.ts  
routing: apps/api/src/routes/index.ts → /api/v1/*  
state: file-based stores (config/) | in-memory session cache  
api: 11 route modules (auth, templates, rules, estimates, ai, exports, sessions, team, versions, wbs)  
db: none | config dir: users.json, invite-codes.json, rules/, templates/, teams/, versions/  
auth: JWT (Bearer token) | inviteCode-based registration | admin/user roles  
build: tsc → dist/, npm run build -w @workload/api  
dirs: `apps/api/src/modules/`→domain modules, `apps/api/src/routes/`→API endpoints, `apps/api/src/services/`→business logic, `apps/api/src/middleware/`→auth + error-handling, `apps/api/src/types/`→unified schema, `apps/api/src/engine.ts`→workload calculation pipeline

### @workload/web (ui/V0_SAAS)

entry: ui/V0_SAAS/app/layout.tsx  
routing: Next app router (`/dashboard/*`)  
state: React hooks + localStorage drafts  
api: fetch to /api/v1/* (with JWT auth header)  
auth: JWT token storage (`workload-auth-token-v1`)  
build: next build  
dirs: `ui/V0_SAAS/app/`→pages, `ui/V0_SAAS/components/`→UI/components, `ui/V0_SAAS/lib/`→API/data services

---

## STACK

@workload/api → framework: Express 4.21 | auth: jsonwebtoken 9.0 | file: multer 2.1, xlsx 0.18, pdfkit 0.18 | build: TypeScript 5.8, tsx 4.19 | runtime: Node.js 22+

@workload/web → framework: Next.js 16 + React | routing: app router | state: localStorage + React hooks | http: fetch wrapper | build: next build

---

## STYLE

- naming: camelCase (funcs), PascalCase (types), SCREAMING_SNAKE_CASE (constants)
- imports: ES6 import/export, relative paths in src/
- typing: strict TypeScript, type guards (isTemplateLike, isRuleSetLike, isVersionType, isVersionStatus)
- errors: try/catch with message propagation | ApiResponse<T> { code, message, data, details? }
- testing: tsx --test (unit + integration) | test files colocated: *.test.ts
- patterns: modular architecture (modules/{auth,rules,templates,estimates,...}) | controller/usecase/repository pattern | service layer for business logic

---

## STRUCTURE

`apps/` → applications (api)  
`apps/api/src/` → backend source  
`apps/api/src/modules/` → domain modules (auth, rules, templates, estimates, ai, team, versions, exports, sessions, wbs)  
`apps/api/src/routes/` → route definitions (one per module)  
`apps/api/src/services/` → business logic (auth, rule, template, estimate, ai, export, session, version)  
`apps/api/src/middleware/` → auth, error-handler  
`apps/api/src/types/` → unified TypeScript definitions  
`apps/api/src/config/` → env.ts (config loading)  
`apps/api/src/utils/` → file, helpers, response, index  
`ui/V0_SAAS/` → frontend (Next.js pages/components/lib)  
`config/` → runtime data (users, invites, rules, templates, teams, versions)  
`docker/` → Dockerfile.api  
`scripts/` → utility scripts (rules regression, API checks, Excel parsing)  
`docs/` → ENVIRONMENT.md, PROJECT_STATUS_2026-03-30.md, openapi.yaml

---

## BUILD

workspaceScripts: dev:web, dev:api, build:web, build:api, rules:standardize, rules:regression, rules:excel-report, test:api:integration, test:api:team, test:modules, test:rules, test:integration, test:all, test:e2e:web

| package | script | purpose |
|---------|--------|---------|
| @workload/api | dev | tsx watch src/main.ts |
| @workload/api | build | tsc -p tsconfig.json |
| @workload/api | start | node dist/main.js |
| @workload/api | test:modules | unit tests (modules.*) |
| @workload/api | test:rules | rules engine tests |
| @workload/api | test:integration | integration tests |
| @workload/web | dev | next dev |
| @workload/web | build | next build |

envFiles: .env, .env.local (API only)  
envPrefixes: PORT, JWT_SECRET, JWT_EXPIRES_IN, KIMI_API_KEY, KIMI_MODEL, KIMI_API_BASE_URL  
ci: docker-compose.yml (api + next web services, config volume mount)  
docker: docker/Dockerfile.api (multi-stage, NODE_ENV=production, exposes 3000)

---

## LOOKUP

add auth route → apps/api/src/routes/auth.routes.ts, apps/api/src/modules/auth/  
add API endpoint → apps/api/src/routes/{module}.routes.ts, apps/api/src/modules/{module}/  
add business logic → apps/api/src/modules/{module}/{module}.usecase.ts  
add data store → apps/api/src/modules/{module}/{module}.repository.ts  
add calculation rule → apps/api/src/engine.ts (RuleSet, calculate functions)  
add frontend page → ui/V0_SAAS/app/dashboard/*/page.tsx  
add frontend form section → ui/V0_SAAS/app/dashboard/*/page.tsx  
add estimate template → config/templates/example-template.json  
add rule set → config/rules/example-rule-set.json  
configure auth → config/auth/{users.json, invite-codes.json}  
deploy → docker-compose up --build (ports 3000 api, 3001 web)

---

## KEY FILES

`@workload/api::apps/api/src/main.ts` → startup | read for: port config | affects: service availability

`@workload/api::apps/api/src/app.ts` → Express app factory, middleware setup, route wiring | read for: middleware order, file upload config | affects: request handling

`@workload/api::apps/api/src/routes/index.ts` → API route aggregation | read for: endpoint structure | affects: all /api/v1/* paths

`@workload/api::apps/api/src/engine.ts` → workload calculation algorithm (RuleSet, Template, CalculateRequest → EstimateResult) | read for: estimation logic | affects: all /api/v1/estimates/* | related: apps/api/src/modules/rules/

`@workload/api::apps/api/src/types/index.ts` → unified TypeScript schema (Template, RuleSet, CalculateRequest, EstimateResult, VersionRecord, AuthUser, etc.) | read for: type contracts | affects: all modules | related: apps/api/src/modules/

`@workload/api::apps/api/src/config/env.ts` → environment config (port, JWT, Kimi API, constants) | read for: runtime settings | affects: all services

`@workload/api::apps/api/src/modules/auth/auth.controller.ts` → auth endpoints (register, login, me, logout, users CRUD, invite codes) | read for: auth flow | affects: /api/v1/auth/*

`@workload/api::apps/api/src/modules/auth/auth.usecase.ts` → auth business logic (JWT gen, password hash, inviteCode validation) | read for: auth mechanics | affects: all protected endpoints

`@workload/api::apps/api/src/modules/estimates/estimates.controller.ts` → estimate endpoints (calculate, export) | read for: request/response | affects: /api/v1/estimates/*

`@workload/api::apps/api/src/modules/estimates/estimates.usecase.ts` → estimate calculation orchestration | read for: workflow | affects: result generation

`@workload/api::apps/api/src/modules/ai/ai.controller.ts` → AI endpoints (parse-basic-info, company-profile-summary, chat) | read for: AI routes | affects: /api/v1/ai/*

`@workload/api::apps/api/src/modules/team/team.controller.ts` → team collab endpoints (teams CRUD, members, plans, reviews, comments) | read for: collab API | affects: /api/v1/teams/*

`@workload/api::apps/api/src/middleware/auth.ts` → JWT verification middleware | read for: token validation | affects: all protected routes

`@workload/api::apps/api/src/middleware/error-handler.ts` → global error handler | read for: error response format | affects: all endpoints

`@workload/api::package.json` → workspace dependencies, npm workspaces config | read for: all deps | affects: installation, builds

`@workload/web::ui/V0_SAAS/app/dashboard/*` → page-level Next routes | read for: page flow, state management, API calls, auth | affects: dashboard UI

`@workload/web::ui/V0_SAAS/lib/workload-service.ts` → frontend API service | read for: backend integration | affects: data read/write

`@workload/web::ui/V0_SAAS/package.json` → frontend dependencies | read for: UI deps | affects: builds

`docker/Dockerfile.api` → multi-stage API image build | read for: deployment | affects: containerized deployment

`docker-compose.yml` → local orchestration (api + web services) | read for: dev environment | affects: docker compose up

---

## NOTES

- **Web frontend**: Next.js route-based frontend in `ui/V0_SAAS`, module pages under `/dashboard/*`. LocalStorage drafts still used for part of interactive state.
- **Rules engine**: Centralized in apps/api/src/engine.ts. Handles template items, rule sets, multi-tier user count factors, difficulty increments, organization increments.
- **Modular backend**: Each domain (auth, rules, templates, estimates, ai, team, versions, wbs, exports, sessions) has controller → usecase → repository pattern.
- **File storage**: No database. All data persisted in config/ directory as JSON files (users, invites, rules, templates, teams, versions).
- **AI integration**: Moonshot (Kimi) API for Excel parsing, company profile generation, and chat.
- **Auth**: JWT-based with invite codes for registration. Admin/user roles.
- **Version management**: Supports multiple version types (assessment, resource, requirementImport, dev, global) with draft/reviewed/published/archived statuses.
- **Team collaboration**: P0 feature (in progress). Teams, members, plan binding, reviews, comments.
- **Export formats**: Excel (.xlsx) and PDF (.pdf) supported.
- **Development**: No database, runs entirely on files. Suitable for demo/POC.
