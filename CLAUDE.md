# CLAUDE.md - Development Context & Guidelines

This file contains essential context and guidelines for Claude instances working on this project.

**Key workflow reminders:**

- Never try to run the local dev server. The Human is always running it in another tab on port 3000.
- Always test your work with BrowserMCP to confirm it works as expected.
- This project uses JSX for it's template engine but it is NOT a React (client) project.

## General codebase notes

### Code Quality Standards

**STRICT LINTING ENFORCED:**

- **Zero warnings allowed** (`--max-warnings 0`)
- **No "any" types allowed** (`@typescript-eslint/no-explicit-any: error`)
- **No console statements allowed** (`no-console: error`)
- **Exception:** Test files may use "any" for mocking with `// eslint-disable-next-line @typescript-eslint/no-explicit-any`

### Package Management

- Uses `bun` as the package manager (not npm, pnpm or yarn)
- Lock file: `bun.lock`

## Architecture Decisions

### Code Quality Tools

- **Biome**: Code linting for TypeScript
- **Prettier**: Code formatting with consistent style
- **TypeScript**: Strict mode enabled for type safety

### Best Practices

- **Mock external dependencies**: Use MSW or other mocking strategies for all external calls
- **Test user interactions**: Focus on user behavior rather than implementation
- **Authenticated contexts**: Test components with guest and logged-in users
- **Error scenarios**: Test error handling and edge cases

## Architecture Patterns

### Server-side Rendering Flow

- Data fetched synchronously in route handlers is always available before template renders
- No need for loading states when data is fetched server-side before rendering
- Routes return Response objects with proper headers, not JSX elements directly
- Templates receive fully resolved data as props

### Service Layer Abstraction

- Business logic should live in `/src/server/services/` directory
- Services provide single source of truth for data operations
- Services should be pure functions when possible for easier testing
- Services can be shared across both API and view routes
- Example: `analytics.ts` service for visitor stats and analytics

### Type Safety Across Layers

- Export types from service modules alongside functions
- Import and use service types in templates for consistency
- Avoid duplicating type definitions across files
- Maintain type safety from service → route → template
- Example: `VisitorStats` type exported from analytics service

## Routing Structure

### Route Organization

- Separate API routes (`/src/server/routes/api.ts`) and view routes (`/src/server/routes/views.tsx`)
- Routes use Bun's native `routes: {}` configuration for better performance
- API routes return JSON responses using `Response.json()`
- View routes render HTML using `renderToString()` wrapped in Response objects
- Both route types can share services for business logic

### Route Handler Patterns

- API routes: `(req) => Response | Promise<Response>`
- View routes: `(req) => Response` (after fetching data from services)
- Avoid circular dependencies between routes (don't fetch API routes from view routes)
- Use services to share logic between different route types
