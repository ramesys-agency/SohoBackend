# UGP-BOS

A production-ready Express 5 TypeScript backend API with PostgreSQL, Prisma ORM, and comprehensive logging via Grafana Loki.

## Features

- Express 5 with TypeScript
- PostgreSQL with Prisma ORM
- Redis caching (optional)
- Structured logging with Winston and Grafana Loki
- Security middleware (Helmet, CORS, rate limiting)
- Code quality with ESLint and Prettier
- Git hooks with Husky and commitlint
- Docker-ready for development and production

## Prerequisites

- **Node.js** 22+
- **Docker** and **Docker Compose**
- **npm** 10+

## Quick Start (Development)

1. **Clone the repository** and navigate to the project directory

2. **Start infrastructure services** (PostgreSQL, Loki, Grafana):
   ```bash
   npm run docker:dev
   ```

3. **Install dependencies**:
   ```bash
   npm install
   ```

4. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your local settings (defaults work for development)
   ```

5. **Generate Prisma client and push schema**:
   ```bash
   npm run db:generate
   npm run db:push
   ```

6. **Start the development server**:
   ```bash
   npm run start:dev
   ```

The API will be available at `http://localhost:3000`.

## Production Deployment

1. **Configure environment variables**:
   ```bash
   cp .env.example .env
   # Set secure passwords and production values
   ```

   Required environment variables for production:
   - `POSTGRES_PASSWORD` - Database password (required, no default)
   - `GRAFANA_ADMIN_USER` - Grafana admin username (required)
   - `GRAFANA_ADMIN_PASSWORD` - Grafana admin password (required)

2. **Build and start all services**:
   ```bash
   npm run docker:build
   npm run docker:up
   ```

3. **Run database migrations**:
   ```bash
   npm run db:migrate:prod
   ```

## Environment Variables Reference

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PORT` | Server port | `3000` | No |
| `NODE_ENV` | Environment mode | `development` | No |
| `APP_NAME` | Application name for logging | `ugp-bos` | No |
| `DATABASE_URL` | PostgreSQL connection string | See .env.example | Yes |
| `POSTGRES_USER` | PostgreSQL username (Docker) | `postgres` | No |
| `POSTGRES_PASSWORD` | PostgreSQL password (Docker) | - | Yes (prod) |
| `POSTGRES_DB` | PostgreSQL database name | `ugp_bos` | No |
| `GRAFANA_ADMIN_USER` | Grafana admin username | - | Yes (prod) |
| `GRAFANA_ADMIN_PASSWORD` | Grafana admin password | - | Yes (prod) |
| `LOG_LEVEL` | Logging level | `info` | No |
| `LOKI_URL` | Loki server URL | `http://localhost:3100` | No |
| `LOKI_ENABLED` | Enable Loki logging | `false` | No |
| `CORS_ORIGIN` | Allowed CORS origins | `*` | No |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window (ms) | `900000` | No |
| `RATE_LIMIT_MAX` | Max requests per window | `100` | No |
| `REDIS_ENABLED` | Enable Redis caching | `false` | No |
| `REDIS_URL` | Redis connection URL (takes precedence) | - | No |
| `REDIS_HOST` | Redis server host | `localhost` | No |
| `REDIS_PORT` | Redis server port | `6379` | No |
| `REDIS_PASSWORD` | Redis password | - | No |
| `REDIS_USERNAME` | Redis username (ACL) | - | No |
| `REDIS_DB` | Redis database number | `0` | No |
| `REDIS_TLS` | Enable TLS connection | `false` | No |
| `REDIS_KEY_PREFIX` | Prefix for Redis keys | `ugp-bos` | No |

## API Endpoints

### Health Check

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Full health check including database connectivity |
| `GET` | `/health/live` | Liveness probe (app is running) |

**Response format**:
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "timestamp": "2024-01-01T00:00:00.000Z",
    "uptime": 123.456,
    "database": {
      "connected": true
    }
  }
}
```

## Project Structure

```
ugp-bos/
├── src/
│   ├── config/               # Configuration and environment validation
│   ├── core/                 # Shared infrastructure (platform team owned)
│   │   ├── errors/           # HTTP error classes
│   │   ├── interfaces/       # Shared interfaces (ILoggerService, IPrismaService)
│   │   ├── middleware/       # Express middleware (security, logging, errors)
│   │   ├── services/         # Core services (logger, prisma)
│   │   ├── types/            # Shared types (ApiResponse)
│   │   └── utils/            # Utilities (ShutdownManager)
│   ├── modules/              # Feature modules (team-owned)
│   │   └── health/           # Health check module
│   │       ├── health.controller.ts
│   │       ├── health.service.ts
│   │       ├── health.routes.ts
│   │       ├── health.interface.ts
│   │       ├── health.types.ts
│   │       └── index.ts
│   ├── generated/            # Generated Prisma client
│   ├── app.ts                # Express application setup
│   └── server.ts             # Application entry point & DI wiring
├── prisma/
│   ├── prisma.config.ts      # Prisma configuration
│   └── schema/
│       ├── schema.prisma     # Datasource & generator config
│       ├── enums/            # Enum definitions (UserStatus, RoleStatus)
│       ├── models/           # Model definitions
│       └── views/            # Database views
├── grafana/
│   └── provisioning/         # Grafana datasource configuration
├── docker-compose.yml        # Production Docker setup
├── docker-compose.dev.yml    # Development infrastructure
├── Dockerfile                # Production container build
└── .env.example              # Environment variables template
```

## Architecture

### SOLID Principles

| Principle | Implementation |
|-----------|----------------|
| **Single Responsibility** | Each module owns one feature. Each file has one job. |
| **Open/Closed** | Add new modules without changing existing code |
| **Liskov Substitution** | Services implement interfaces, can be swapped |
| **Interface Segregation** | Small, focused interfaces per module |
| **Dependency Inversion** | Controllers depend on interfaces, not concrete classes |

### Module Pattern

Each feature module follows this structure:
```
modules/{name}/
├── {name}.controller.ts    # HTTP handlers
├── {name}.service.ts       # Business logic
├── {name}.repository.ts    # Data access (optional)
├── {name}.routes.ts        # Route definitions
├── {name}.interface.ts     # Module interfaces
├── {name}.types.ts         # Module types
├── {name}.dto.ts           # Validation schemas (optional)
└── index.ts                # Public exports
```

### Adding a New Module

```bash
# 1. Create module directory
mkdir -p src/modules/users

# 2. Create module files
touch src/modules/users/{users.controller,users.service,users.routes,users.interface,users.types,index}.ts

# 3. Implement following the health module pattern
# 4. Wire up in server.ts:
#    const usersService = new UsersService(prisma);
#    const usersController = new UsersController(usersService, logger);
#    router.use(createUsersRoutes(usersController));
```

### Code Ownership

```
/src/core/           @platform-team
/src/modules/health/ @platform-team
/src/modules/users/  @users-team
/src/modules/orders/ @orders-team
```

## Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run start` | Start the server (production) |
| `npm run start:dev` | Start with hot-reload (development) |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm run dev` | Watch mode TypeScript compilation |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:push` | Push schema to database (dev) |
| `npm run db:migrate` | Create and run migrations (dev) |
| `npm run db:migrate:prod` | Run migrations (production) |
| `npm run db:studio` | Open Prisma Studio GUI |
| `npm run docker:dev` | Start dev infrastructure |
| `npm run docker:dev:down` | Stop dev infrastructure |
| `npm run docker:build` | Build production containers |
| `npm run docker:up` | Start production stack |
| `npm run docker:down` | Stop production stack |
| `npm run lint` | Run ESLint on src/ |
| `npm run lint:fix` | Run ESLint with auto-fix |
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check code formatting |

## Monitoring

Access Grafana at `http://localhost:3001` to view logs and metrics.

- **Development**: Default credentials are `admin` / `admin`
- **Production**: Use the credentials set in your `.env` file

Loki is pre-configured as a datasource for log aggregation.

## Redis Caching

Redis caching is optional and disabled by default. The implementation uses [ioredis](https://github.com/redis/ioredis) with production-ready features.

### Quick Start

**Option 1: Using Docker Compose (recommended)**

Redis is included in the Docker Compose setup:
```bash
npm run docker:dev  # Starts PostgreSQL, Redis, Loki, and Grafana
```

**Option 2: Standalone Redis**
```bash
docker run -d -p 6379:6379 redis:7-alpine
```

Then enable in your `.env`:
```env
REDIS_ENABLED=true
REDIS_HOST=localhost
REDIS_PORT=6379
```

### Cloud Provider Configuration

For cloud Redis (AWS ElastiCache, Redis Cloud, Upstash, etc.):

```env
# Option 1: Connection URL (recommended)
REDIS_URL=rediss://user:password@your-redis-host.com:6379/0

# Option 2: Individual settings
REDIS_HOST=your-redis-host.com
REDIS_PORT=6379
REDIS_PASSWORD=your-password
REDIS_USERNAME=default
REDIS_TLS=true
```

### CacheService Features

| Feature | Description |
|---------|-------------|
| **Basic Operations** | `get`, `set`, `del`, `exists` |
| **Atomic Operations** | `getOrSet` (cache-aside), `setNX` (distributed locks), `getdel` |
| **Counters** | `incr`, `incrBy`, `decr`, `decrBy` |
| **Batch Operations** | `mget`, `mset` with pipeline |
| **Key Management** | `scan` (non-blocking), `ttl`, `expire`, `persist` |
| **Connection** | URL or host/port, TLS, auto-reconnect, auto-pipelining |

### Usage Examples

```typescript
// Basic get/set
await cache.set('user:123', { name: 'John' }, { ttl: 3600 });
const user = await cache.get<User>('user:123');

// Cache-aside pattern
const user = await cache.getOrSet('user:123', async () => {
  return await db.findUser(123);
}, 3600);

// Distributed lock
const acquired = await cache.setNX('lock:resource', { owner: 'worker-1' }, 30);

// Counters (rate limiting)
const count = await cache.incr('api:requests:user:123');

// Non-blocking iteration (use instead of KEYS)
for await (const keys of cache.scan('user:*')) {
  console.log(keys);
}
```

## Code Quality

### ESLint

ESLint is configured with TypeScript support and Prettier integration:

```bash
npm run lint          # Check for issues
npm run lint:fix      # Auto-fix issues
```

### Prettier

Prettier handles code formatting:

```bash
npm run format        # Format all files
npm run format:check  # Check formatting
```

### Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Commits are validated by commitlint via a Git hook.

**Commit message format:**
```
<type>(<scope>): <description> [UG-<number>]

[optional body]

[optional footer(s)]
```

**Requirements:**
- Must include a Jira ticket reference: `UG-<number>` (e.g., `UG-50`, `UG-123`)
- The ticket can be in the header, body, or footer

**Allowed types:**
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation only
- `style` - Code style (formatting, no logic change)
- `refactor` - Code refactoring
- `perf` - Performance improvement
- `test` - Adding or updating tests
- `build` - Build system or dependencies
- `ci` - CI/CD configuration
- `chore` - Maintenance tasks
- `revert` - Revert a previous commit

**Examples:**
```bash
git commit -m "feat(auth): add JWT token validation [UG-50]"
git commit -m "fix(api): handle null response from external service [UG-123]"
git commit -m "docs: update README with Redis configuration [UG-45]"
```

### Git Hooks

Git hooks are managed by Husky:

- **pre-commit**: Runs lint-staged (ESLint + Prettier on staged files)
  - Commits are **blocked** if ESLint finds errors or warnings that cannot be auto-fixed
  - Commits are **blocked** if Prettier encounters parsing errors
- **commit-msg**: Validates commit message format with commitlint
  - Commits are **blocked** if the message doesn't follow conventional commits format
  - Commits are **blocked** if Jira ticket reference (UG-<number>) is missing

**Note**: lint-staged configuration is in `package.json`. It runs `eslint --fix` and `prettier --write` on staged files automatically.

## Developer Guidelines

### Naming Conventions

#### TypeScript/JavaScript Code

| Element | Convention | Example |
|---------|-----------|---------|
| **Variables** | camelCase | `userId`, `isActive`, `userProfile` |
| **Constants** | UPPER_SNAKE_CASE | `MAX_RETRIES`, `API_BASE_URL` |
| **Functions** | camelCase | `getUserById()`, `validateEmail()` |
| **Classes** | PascalCase | `UserService`, `AuthController` |
| **Interfaces** | PascalCase with `I` prefix | `IUserService`, `ICacheService` |
| **Types** | PascalCase | `UserStatus`, `ApiResponse<T>` |
| **Enums** | PascalCase | `UserStatus`, `RoleStatus` |
| **Files** | kebab-case | `user.service.ts`, `auth.middleware.ts` |
| **Directories** | kebab-case | `core/services/`, `modules/health/` |

#### Database (Prisma Schema)

| Element | Convention | Example |
|---------|-----------|---------|
| **Table Names** | PascalCase | `OrganisationUser`, `Role` |
| **Column Names** | camelCase | `firstName`, `createdAt`, `organisationId` |
| **Enum Names** | PascalCase | `UserStatus`, `RoleStatus` |
| **Enum Values** | UPPER_SNAKE_CASE | `ACTIVE`, `INACTIVE`, `PENDING` |

**Important**: Prisma uses PascalCase for model names but generates snake_case table names in PostgreSQL by default. Our schema uses `@@map()` when needed to override this behavior.

### Code Style

This project enforces strict code style rules via Prettier and EditorConfig:

| Rule | Value | Enforced By |
|------|-------|-------------|
| **Indentation** | 4 spaces | `.prettierrc`, `.editorconfig` |
| **Quotes** | Double quotes (`"`) | `.prettierrc` |
| **Semicolons** | Required | `.prettierrc` |
| **Line Width** | 100 characters | `.prettierrc` |
| **Trailing Commas** | ES5 style | `.prettierrc` |
| **End of Line** | LF (`\n`) | `.editorconfig` |

**Configuration files**:
- `.prettierrc` - Prettier formatting rules
- `.editorconfig` - IDE/editor settings
- `eslint.config.js` - ESLint rules (integrates with Prettier)

### Development Workflow

#### Before You Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up Git hooks** (runs automatically after `npm install`):
   ```bash
   npm run prepare
   ```

3. **Configure your editor**:
   - Install EditorConfig plugin for your IDE
   - Install Prettier plugin for your IDE
   - Install ESLint plugin for your IDE

#### Daily Development

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/UG-123-add-user-authentication
   ```

2. **Make your changes** following the naming conventions above

3. **Format your code** (optional, auto-runs on commit):
   ```bash
   npm run format
   ```

4. **Check for linting errors**:
   ```bash
   npm run lint
   ```

5. **Fix auto-fixable issues**:
   ```bash
   npm run lint:fix
   ```

6. **Build to verify TypeScript compilation**:
   ```bash
   npm run build
   ```

7. **Stage and commit your changes**:
   ```bash
   git add .
   git commit -m "feat(auth): add JWT token validation [UG-123]"
   ```

   **What happens on commit**:
   - `pre-commit` hook runs `lint-staged`:
     - Runs `eslint --fix` on staged `.ts` files
     - Runs `prettier --write` on staged `.ts`, `.js`, `.json` files
     - If errors remain, commit is **blocked**
   - `commit-msg` hook validates your commit message:
     - Checks conventional commit format
     - Checks for Jira ticket reference (`UG-<number>`)
     - If invalid, commit is **blocked**

8. **Push your changes**:
   ```bash
   git push origin feature/UG-123-add-user-authentication
   ```

#### Pre-Commit Checklist

The following checks run **automatically** on every commit via Git hooks:

- ✅ **Linting**: ESLint checks and auto-fixes code quality issues
- ✅ **Formatting**: Prettier formats code to match style guide
- ✅ **Commit Message**: Validates conventional commit format and Jira ticket reference

**Manual checks** (recommended before pushing):

- ⚠️ **Build**: Run `npm run build` to ensure TypeScript compiles
- ⚠️ **Tests**: Run `npm test` (when tests are implemented)

### Git Commit Message Standards

We use **Conventional Commits** with **mandatory Jira ticket references**.

#### Format

```
<type>(<scope>): <description> [UG-<number>]

[optional body]

[optional footer(s)]
```

#### Commit Types

| Type | Description | Example |
|------|-------------|---------|
| `feat` | New feature | `feat(auth): add JWT token validation [UG-50]` |
| `fix` | Bug fix | `fix(api): handle null response from external service [UG-123]` |
| `docs` | Documentation only | `docs: update README with Redis configuration [UG-45]` |
| `style` | Code style (formatting, no logic change) | `style: apply prettier formatting [UG-67]` |
| `refactor` | Code refactoring | `refactor(cache): extract Redis client to service [UG-89]` |
| `perf` | Performance improvement | `perf(db): add index on user email column [UG-91]` |
| `test` | Adding or updating tests | `test(auth): add unit tests for JWT validation [UG-102]` |
| `build` | Build system or dependencies | `build: upgrade prisma to v7.3.0 [UG-110]` |
| `ci` | CI/CD configuration | `ci: add GitHub Actions workflow [UG-115]` |
| `chore` | Maintenance tasks | `chore: update dependencies [UG-120]` |
| `revert` | Revert a previous commit | `revert: revert "feat(auth): add JWT" [UG-125]` |

#### Scope (Optional)

The scope should be the name of the module or component affected:
- `auth` - Authentication module
- `api` - API layer
- `db` - Database
- `cache` - Caching layer
- `config` - Configuration

#### Examples

**Good commits**:
```bash
feat(auth): implement JWT token refresh mechanism [UG-50]
fix(db): resolve connection pool exhaustion issue [UG-123]
docs: add developer guidelines to README [UG-45]
refactor(logger): remove dependency injection pattern [UG-89]
```

**Bad commits** (will be rejected):
```bash
# Missing Jira ticket
feat(auth): add JWT validation

# Invalid type
added: new feature [UG-50]

# No description
feat(auth): [UG-50]

# Incorrect ticket format
feat(auth): add JWT validation UG50
```

### Bypassing Git Hooks (Emergency Only)

In rare cases where you need to bypass hooks (e.g., work-in-progress commits):

```bash
git commit --no-verify -m "wip: temporary commit [UG-123]"
```

**⚠️ Warning**: This should be used sparingly and only for local commits. Never push commits that bypass hooks to shared branches.

### Common Issues and Solutions

#### Issue: Commit blocked by ESLint

**Solution**:
```bash
# Run lint with auto-fix
npm run lint:fix

# If issues remain, fix them manually
npm run lint

# Then commit again
git commit -m "your message [UG-123]"
```

#### Issue: Commit blocked by Prettier

**Solution**:
```bash
# Format all files
npm run format

# Then commit again
git commit -m "your message [UG-123]"
```

#### Issue: Commit message validation failed

**Solution**: Ensure your commit message follows the format:
- Starts with a valid type (`feat`, `fix`, etc.)
- Includes Jira ticket reference `[UG-<number>]`
- Has a meaningful description

```bash
# Correct format
git commit -m "feat(auth): add login endpoint [UG-123]"
```

#### Issue: Git hooks not running

**Solution**:
```bash
# Reinstall Husky hooks
npm run prepare

# Verify hooks exist
ls .husky/
```



## Technical Debt

The following items are known technical debt to address in future iterations:

### Application Layer

| Issue | Location | Description |
|-------|----------|-------------|
| No request validation | Modules | No DTO validation layer (e.g., Zod, class-validator) for request bodies. |
| No integration tests | - | Missing integration test setup for API endpoints. |
| No API documentation | - | No OpenAPI/Swagger documentation generation. |

### Database Schema

| Issue | Location | Priority | Description |
|-------|----------|----------|-------------|
| No cascade rules | All relations | High | Missing `onDelete`/`onUpdate` policies. Deleting records can orphan related data. |
| Orphaned audit fields | `createdById`, `updatedById` | High | No FK relations to `OrganisationUser`. These are plain strings with no referential integrity. |
| Cross-org role assignment | `OrganisationUserRole` | High | No constraint preventing user from Org A being assigned a role from Org B. |
| Missing indexes | `OrganisationUserRole` | Medium | Missing indexes on `organisationUserId` and `roleId` FK columns. |
| `otpVerified` as Json | `OrganisationUser` | Medium | No schema validation at DB level. Consider dedicated table. |
| `loggedIn` boolean | `OrganisationUser` | Medium | Single boolean can't handle multiple sessions/devices. May need session table. |
| Inconsistent soft delete | Various | Low | `OrganisationUser` and `Role` use status enum, `MasterModule` uses `isActive` boolean, `Organisation` has no soft delete. |
| No audit trail | All models | Low | No history/changelog table for compliance tracking. |
