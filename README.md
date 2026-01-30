# vite-plugin-react-app-router

A Vite plugin that brings **Next.js App Router** file-based routing to standard React projects. Generates `react-router-dom` routes dynamically based on your directory structure.

## Features

- **File-based routing** - Same conventions as Next.js App Router
- **HMR support** - Automatic updates when route files change
- **JIT in development** - Routes generated dynamically without creating files in your source
- **Optimized for production** - Routes bundled directly for tree-shaking
- **Nested layouts** - Full support for `layout.tsx` with `<Outlet />`

## Goals

- Provide Next.js App Router-like DX in standard React + Vite projects
- Zero config file generation in source directory
- Seamless integration with `react-router-dom`
- Minimal runtime overhead

## Limitations

- Server components are not supported (this is a client-side router)
- Parallel routes and intercepting routes are not implemented

## Installation

```bash
npm install vite-plugin-react-app-router react-router-dom
```

## Configuration

### vite.config.ts

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import reactAppRouter from "vite-plugin-react-app-router";

export default defineConfig({
  plugins: [
    react(),
    reactAppRouter({
      // App directory (default: 'src/app')
      appDir: "src/app",
      // Enable lazy loading for code splitting (default: true)
      lazy: true,
    }),
  ],
});
```

### Plugin Options

| Option   | Type                             | Default     | Description                                                                                          |
| -------- | -------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------- |
| `appDir` | `string`                         | `'src/app'` | Directory containing the app router files                                                            |
| `lazy`   | `boolean`                        | `true`      | Enable lazy loading using `React.lazy()` for code splitting. Results in smaller initial bundle size. |
| `debug`  | `boolean \| 'console' \| string` | `false`     | Debug mode: `true`/`'console'` logs to console, string path writes to file                           |

### main.tsx

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppRouter } from "virtual:app-router";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
);
```

### TypeScript (tsconfig.json)

Add the type reference:

```json
{
  "compilerOptions": {
    "types": ["vite-plugin-react-app-router/types"]
  }
}
```

## Directory Structure

```
src/app/
├── layout.tsx        # Root layout
├── page.tsx          # Home page (/)
├── about/
│   └── page.tsx      # /about
├── blog/
│   ├── layout.tsx    # Blog layout
│   ├── page.tsx      # /blog
│   └── [slug]/
│       └── page.tsx  # /blog/:slug
├── (auth)/           # Route group (does not affect URL)
│   ├── login/
│   │   └── page.tsx  # /login
│   └── register/
│       └── page.tsx  # /register
└── [...catchAll]/
    └── page.tsx      # Catch-all route
```

## File Conventions

| File            | Description                                               |
| --------------- | --------------------------------------------------------- |
| `page.tsx`      | Page component (required to create a route)               |
| `layout.tsx`    | Layout that wraps child pages                             |
| `loading.tsx`   | Loading component (used as Suspense fallback)             |
| `error.tsx`     | Error boundary component (catches errors in child routes) |
| `not-found.tsx` | 404 component (catch-all route for unmatched paths)       |

## Dynamic Routes

| Pattern        | Example       | Result                                 |
| -------------- | ------------- | -------------------------------------- |
| `[param]`      | `[id]`        | `:id` - Dynamic parameter              |
| `[...param]`   | `[...slug]`   | `*` - Catch-all                        |
| `[[...param]]` | `[[...slug]]` | `*` - Optional catch-all               |
| `(group)`      | `(auth)`      | Route group (not included in URL path) |

## Exports

```tsx
import { AppRouter, router, routes } from "virtual:app-router";

// AppRouter - Ready-to-use component
<AppRouter />;

// router - createBrowserRouter instance
// Useful for programmatic navigation
router.navigate("/about");

// routes - Array of RouteObject
// Useful for customization
```

## Layout Example

Layouts must use `<Outlet />` from react-router-dom to render child routes:

```tsx
// src/app/layout.tsx
import { Outlet, Link } from "react-router-dom";

export default function RootLayout() {
  return (
    <div>
      <nav>
        <Link to="/">Home</Link>
        <Link to="/about">About</Link>
      </nav>
      <main>
        <Outlet />
      </main>
      <footer>...</footer>
    </div>
  );
}
```

## Page Example

```tsx
// src/app/blog/[slug]/page.tsx
import { useParams, Link } from "react-router-dom";

export default function BlogPost() {
  const { slug } = useParams();
  return (
    <article>
      <h1>Post: {slug}</h1>
      <Link to="/blog">Back to blog</Link>
    </article>
  );
}
```

## Loading Component Example

The `loading.tsx` file is used as a Suspense fallback when lazy loading components. It will be shown while the page component is being loaded:

```tsx
// src/app/loading.tsx
export default function Loading() {
  return (
    <div className="loading-spinner">
      <span>Loading...</span>
    </div>
  );
}
```

Loading components are inherited by child routes. If a child route doesn't have its own `loading.tsx`, it will use the nearest parent's loading component.

## Error Component Example

The `error.tsx` file is used as an error boundary. It receives the error via `useRouteError` from react-router-dom:

```tsx
// src/app/error.tsx
import { useRouteError, Link } from "react-router-dom";

export default function ErrorBoundary() {
  const error = useRouteError() as Error;

  return (
    <div className="error-container">
      <h1>Something went wrong</h1>
      <p>{error?.message || "An unexpected error occurred"}</p>
      <Link to="/">Go back home</Link>
    </div>
  );
}
```

Error components are inherited by child routes. If a child route throws an error, the nearest parent's error boundary will catch it.

## Not Found Component Example

The `not-found.tsx` file is used as a catch-all route for unmatched paths. It can be placed at different levels:

### Root Not Found (replaces everything)

When placed in the app root (`src/app/not-found.tsx`), it replaces the entire page including the layout:

```tsx
// src/app/not-found.tsx
import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="not-found">
      <h1>404 - Page Not Found</h1>
      <p>The page you're looking for doesn't exist.</p>
      <Link to="/">Go back home</Link>
    </div>
  );
}
```

### Nested Not Found (renders inside layout)

When placed inside a route directory with a layout, it renders inside that layout's `<Outlet />`:

```tsx
// src/app/dashboard/not-found.tsx
import { Link } from "react-router-dom";

export default function DashboardNotFound() {
  return (
    <div className="dashboard-not-found">
      <h1>Page not found in Dashboard</h1>
      <p>This dashboard page doesn't exist.</p>
      <Link to="/dashboard">Go back to dashboard</Link>
    </div>
  );
}
```

This allows you to have custom 404 pages for different sections of your app while preserving the section's layout (navigation, sidebar, etc.).

## Plugin Options

```typescript
interface PluginOptions {
  /** App router directory (default: "src/app") */
  appDir?: string;
  /** Supported file extensions */
  extensions?: string[];
  /**
   * Debug mode to visualize generated code
   * - true or 'console': logs to console
   * - string path: writes to file (e.g., './debug-routes.js')
   */
  debug?: boolean | "console" | string;
}
```

### Debug Mode

To analyze the generated routes code and understand the overhead, enable debug mode:

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import reactAppRouter from "vite-plugin-react-app-router";

export default defineConfig({
  plugins: [
    react(),
    reactAppRouter({
      // Log to console
      debug: true,
      // Or write to a file
      // debug: './debug-routes.js',
    }),
  ],
});
```

This will output the generated virtual module code, allowing you to:

- See the exact routes structure being generated
- Analyze import statements and lazy loading
- Identify optimization opportunities
- Debug routing issues

## Private Folders

Folders starting with `_` are ignored and will not generate routes. Use them for components, utilities, or other non-route files:

```
src/app/
├── _components/      # Ignored - use for shared components
│   └── Button.tsx
├── _lib/             # Ignored - use for utilities
│   └── api.ts
└── dashboard/
    └── page.tsx      # /dashboard
```

## Navigation

Use `<Link>` from `react-router-dom` for client-side navigation. Using regular `<a>` tags will cause full page reloads:

```tsx
// Correct - SPA navigation
import { Link } from "react-router-dom";
<Link to="/about">About</Link>

// Incorrect - full page reload
<a href="/about">About</a>
```

## Requirements

- Vite 5.x or 6.x
- React 18.x or 19.x
- react-router-dom 6.x or 7.x

## License

MIT
