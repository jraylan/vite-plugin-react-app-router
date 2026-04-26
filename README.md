# vite-plugin-react-app-router

A Vite plugin that brings **Next.js App Router** file-based routing to standard React projects. Generates `react-router-dom` routes dynamically based on your directory structure.

## Features

- **File-based routing** — Same conventions as Next.js App Router
- **HMR support** — Automatic updates when route files change
- **JIT in development** — Routes generated dynamically without creating files in your source
- **Optimized for production** — Routes bundled directly for tree-shaking
- **Nested layouts** — Full support for `layout.tsx` with `<Outlet />`
- **Intercepting routes** — `(.)`, `(..)`, `(..)(..)`, `(...)` markers
- **Parallel routes** — `@name/` slots resolved via `useSlot(name)` hook
- **Shared route modules** — `+name/` reusable subtrees invoked with `[+name]` / `(+name)`, with `[-name]` opt-outs

## Goals

- Provide Next.js App Router-like DX in standard React + Vite projects
- Zero config file generation in source directory
- Seamless integration with `react-router-dom`
- Minimal runtime overhead

## Limitations

- Server components are not supported (this is a client-side router)

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

| File            | Description                                                           |
| --------------- | --------------------------------------------------------------------- |
| `page.tsx`      | Page component (required to create a route)                           |
| `layout.tsx`    | Layout that wraps child pages                                         |
| `loading.tsx`   | Loading component (used as Suspense fallback)                         |
| `error.tsx`     | Error boundary (renders inside the layout of the same segment)        |
| `not-found.tsx` | 404 component (catch-all route for unmatched paths)                   |
| `default.tsx`   | Inside `@slot/`, fallback rendered when no slot route matches the URL |

## Dynamic Routes & Special Directories

| Pattern                         | Example                   | Result                                                                                                     |
| ------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `[param]`                       | `[id]`                    | `:id` — dynamic parameter                                                                                  |
| `[...param]`                    | `[...slug]`               | `*` — catch-all                                                                                            |
| `[[...param]]`                  | `[[...slug]]`             | `*` — optional catch-all                                                                                   |
| `(group)`                       | `(auth)`                  | Route group (not included in URL)                                                                          |
| `_private`                      | `_components`             | Ignored (private folder, never produces routes)                                                            |
| `(.) / (..) / (..)(..) / (...)` | `(..)photo`               | Intercepting route marker (see Intercepting Routes)                                                        |
| `@name`                         | `@modal`                  | Parallel route slot (see Parallel Routes)                                                                  |
| `+name`                         | `+customers`, `+[id]`     | Shared route module definition (parametric names allowed)                                                  |
| `[+name]`                       | `[+customers]`, `[+[id]]` | Bracket invocation of a shared module (adds segment, parametric → `:id`)                                   |
| `(+name)`                       | `(+customers)`            | Paren invocation of a shared module (transparent)                                                          |
| `[-name]` or `-name`            | `[-history]`, `-[id]`     | Inside an invocation, omits the matching sub-shared (bracketless form is short-hand, parametric supported) |
| `props.tsx` at invocation       | `[+customers]/props.tsx`  | Default-export object forwarded to the shared subtree via `useSharedProps()`                               |

## Intercepting Routes

Following the [Next.js convention](https://nextjs.org/docs/app/api-reference/file-conventions/intercepting-routes), a directory whose name starts with `(.)`, `(..)`, `(..)(..)`, or `(...)` defines a route that is rendered **in place of** another route when navigation originates from the source segment. Direct navigation (URL bar, refresh) renders the regular page; soft navigation that opts in (see below) renders the intercepting page.

| Marker     | Means                             |
| ---------- | --------------------------------- |
| `(.)`      | Same level as the marker's parent |
| `(..)`     | One route segment above           |
| `(..)(..)` | Two route segments above          |
| `(...)`    | The `app` root                    |

The convention is based on **route segments**, so `(group)` directories don't count toward climbing.

### Example

```
src/app/
├── feed/
│   ├── (..)photo/[id]/
│   │   └── page.tsx       # intercepts /photo/:id when coming from /feed
│   └── page.tsx           # /feed
└── photo/[id]/
    └── page.tsx           # /photo/:id (canonical)
```

Trigger an intercepted navigation by setting `state.appRouterBackgroundLocation` on a `<Link>`:

```tsx
import { Link, useLocation } from "react-router-dom";

export default function FeedItem({ id }: { id: string }) {
  const location = useLocation();
  return (
    <Link to={`/photo/${id}`} state={{ appRouterBackgroundLocation: location }}>
      Open photo
    </Link>
  );
}
```

When `appRouterBackgroundLocation` is set and matches an intercepting route's source pattern, the intercepting page is rendered at the target URL. On reload or direct visit, the canonical page is rendered instead.

### Notes

- The intercepting route requires a regular sibling page at the target URL. If the target doesn't exist, the plugin emits a warning at build/dev time and the intercept is ignored.
- Intercepting pages render **in place of** the target page (no parallel slot). If you want the source page to remain visible behind a modal, render the modal yourself with a portal — `useLocation().state?.appRouterBackgroundLocation` tells you which page the user came from.
- Hard refresh (F5) renders the canonical page. The plugin strips `appRouterBackgroundLocation` from `history.state` on `performance.navigation.type === 'reload'`, so the intercept fires only on soft (link-driven) navigation, mirroring Next.js. Back/forward still re-applies the intercept since the state is preserved on those entries.
- `loading.tsx` inside an intercepting subtree is honored as the Suspense fallback for the intercepting page.

## Parallel Routes

Following the [Next.js convention](https://nextjs.org/docs/app/api-reference/file-conventions/parallel-routes), a directory named `@name/` declares a **parallel route slot** owned by the segment that contains it (siblings of `layout.tsx`). The slot's tree is matched **independently** against the URL and the matched element is exposed to the layout via the `useSlot(name)` hook.

| File                   | Purpose                                                         |
| ---------------------- | --------------------------------------------------------------- |
| `@slot/page.tsx`       | Page rendered when URL matches the slot's owner exactly         |
| `@slot/<sub>/page.tsx` | Page rendered when URL is `<owner>/<sub>` (or any nested match) |
| `@slot/default.tsx`    | Fallback rendered when no route in the slot matches the URL     |
| `@slot/layout.tsx`     | Optional wrapping layout for the slot's tree                    |

### Example

```
src/app/
├── @modal/
│   ├── default.tsx               # rendered when /photo/:id doesn't match
│   └── photo/[id]/page.tsx       # rendered when URL is /photo/:id
├── @aside/
│   └── default.tsx
├── layout.tsx
├── page.tsx
└── photo/[id]/page.tsx           # canonical page at /photo/:id
```

```tsx
// src/app/layout.tsx
import { Outlet } from "react-router-dom";
import { useSlot } from "vite-plugin-react-app-router/client";

export default function RootLayout() {
  const modal = useSlot("modal");
  const aside = useSlot("aside");
  return (
    <>
      <main>
        <Outlet />
      </main>
      {aside}
      {modal}
    </>
  );
}
```

### Notes

- Slots are scoped to the segment that owns them: `@drawer/` next to `app/dashboard/layout.tsx` is only injected into that layout. Closer providers win when a name collides.
- `useSlot(name)` returns a React element (or `null` when no provider registered the slot). Render it where you want the slot to appear.
- The slot's routes use **absolute** URL patterns internally so `useRoutes` matches against the live location independently of the main route tree.
- When `useRoutes` returns `null` (no descendant matched the URL) the slot falls back to its `default.tsx`. If neither is present the slot renders nothing.

## Shared Route Modules

A directory named `+name/` defines a **reusable route subtree** that can be invoked at multiple places in the app — useful for mounting the same set of pages under different prefixes (e.g. a `customers` module reused under `/billing/customers` and `/customerservice/customers`).

| Marker                       | Purpose                                                                                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `+name/`                     | Definition of the shared subtree (parsed as a regular route tree).                                                                                                                              |
| `+[param]/`                  | Parametric shared definition — invocation yields a dynamic URL segment (`[id]` → `:id`).                                                                                                        |
| `[+name]/`                   | Bracket invocation: adds `name` as a URL segment (`/parent/name/...`).                                                                                                                          |
| `[+[param]]/`                | Bracket invocation of a parametric shared (e.g. `[+[id]]/` → `/parent/:id`).                                                                                                                    |
| `(+name)/`                   | Paren invocation: transparent (`/parent/...`). Must not have a sibling `page.tsx`.                                                                                                              |
| `[-name]/` or `-name/`       | Inside an invocation, omit the matching nested `+name/` sub-shared from the graft. The bracketless `-name/` form is accepted as a shorter spelling and is only valid inside an invocation site. |
| `[-[param]]/` or `-[param]/` | Omit a parametric sub-shared (e.g. `-[id]/` skips `+[id]/` at that depth).                                                                                                                      |
| `+name/+sub/`                | Nested sub-shared. Auto-included when the parent is invoked unless `[-sub]` opts out.                                                                                                           |
| `props.tsx`                  | At an invocation site (top-level or any drill-down), default-export forwarded to the shared subtree via `useSharedProps()`. Inner providers merge over outer ones (closer wins).                |

### Visibility

A `+name/` is only visible to **siblings** of the directory that contains it (and their descendants). Place shared modules in a sibling like `(shared)/` to scope them to a parent directory. The closest visible match wins (deepest grandparent).

### Example

```
src/app/
├── (shared)/
│   └── +customers/
│       ├── layout.tsx
│       ├── page.tsx                       # /<prefix>/
│       └── [id]/
│           ├── page.tsx                   # /<prefix>/:id
│           └── +history/
│               └── page.tsx               # /<prefix>/:id/history (sub-shared)
├── billing/
│   ├── layout.tsx
│   └── [+customers]/                       # mounts at /billing/customers/...
└── customerservice/
  ├── layout.tsx
  └── [+customers]/
    └── [id]/
      ├── [-history]/                # opt out of +history for this invocation
      └── page.tsx                   # override +customers/[id]/page.tsx here
```

This generates routes:

- `/billing/customers`, `/billing/customers/:id`, `/billing/customers/:id/history`
- `/customerservice/customers`, `/customerservice/customers/:id` (no `history` — omitted; the `:id` page comes from the override file)

### File overrides at the invocation site

Files placed inside `[+name]/` (or any drill-down dir mirroring the shared structure) replace the shared module's files at the matching position. Useful for tweaking a single page without forking the whole module:

```
[+customers]/
├── layout.tsx                 # overrides +customers/layout.tsx for THIS invocation
└── [id]/
  └── page.tsx               # overrides +customers/[id]/page.tsx
```

The shared module's other files are still inherited.

### Parametric shared modules

Names follow the same dynamic-segment conventions as regular routes — wrap them in `[…]` to make a shared module parametric:

```
src/app/
└── (shared)/
    └── +entity/
        ├── page.tsx         # /<prefix>/
        └── +[id]/
            ├── page.tsx     # /<prefix>/:id          (parametric sub-shared)
            └── history/
              └── page.tsx # /<prefix>/:id/history
```

Invoke as usual, omit by name (the inner `[id]` is the sub-shared name):

```
src/app/
├── foo/[+entity]/                   # /foo/entity, /foo/entity/:id, /foo/entity/:id/history
└── bar/[+entity]/-[id]/             # /bar/entity only — :id sub-shared skipped (bracketless form)
```

`[+[id]]/` works similarly for parametric **invocations**: `app/foo/[+[id]]/` mounts the shared at `/foo/:id`.

### Forwarding props with `props.tsx`

A `props.tsx` (or `.ts`/`.jsx`/`.js`) file inside an invocation site exports a default object whose values are made available throughout the grafted subtree via `useSharedProps()`. Useful for parameterising a shared module per invocation without forking it.

```tsx
// (shared)/+customers/props.tsx — types-only schema (NOT imported by the plugin)
export interface CustomersProps {
  apiBase: string;
  allowDelete: boolean;
}
```

```tsx
// billing/[+customers]/props.tsx — actual values for THIS invocation
import type { CustomersProps } from "../../(shared)/+customers/props";
const value: CustomersProps = { apiBase: "/api/billing", allowDelete: false };
export default value;
```

```tsx
// (shared)/+customers/[id]/page.tsx — read at runtime
import { useSharedProps } from "vite-plugin-react-app-router/client";
import type { CustomersProps } from "../../props";

export default function CustomerPage() {
  const { apiBase, allowDelete } = useSharedProps<CustomersProps>();
  // …
}
```

`props.tsx` may also be placed inside drill-down dirs of an invocation (e.g. `[+customers]/[id]/props.tsx`); deeper providers merge **over** outer ones, so the closer values win for collisions while inherited keys still flow through.

The shared module's own `+name/props.tsx` is **types-only** from the plugin's perspective — it is never imported into the bundle. Spread defaults from a regular module if you want them at runtime:

```tsx
// (shared)/+customers/defaults.ts
export const defaults = { allowDelete: false };

// billing/[+customers]/props.tsx
import { defaults } from "../../(shared)/+customers/defaults";
export default { ...defaults, apiBase: "/api/billing" };
```

### Reading active sub-shareds at runtime

Components rendered inside a grafted shared module can ask which sub-shareds were enabled at the current invocation site, useful for hiding navigation links to omitted areas:

```tsx
import {
  useSharedModule,
  useSharedSlot,
} from "vite-plugin-react-app-router/client";

export default function CustomerDetail() {
  const showHistory = useSharedSlot("history");
  const info = useSharedModule(); // { name: "customers", activeSubShareds: ["history"] } | null
  return (
    <>
      <h1>{info?.name}</h1>
      {showHistory && <Link to="history">History</Link>}
    </>
  );
}
```

### Notes

- `(+name)` (paren) is only valid when the invoker's directory has no sibling `page.tsx` (or the shared has no `pagePath`). The plugin warns when both are present.
- A `[+name]` invocation requires a visible `+name/` definition; otherwise the plugin warns and the invocation is dropped.
- Sub-shareds inherit graft URLs by name (bracket-style): `+history/` materialises at `<parentUrl>/history`.

## Exports

```tsx
import {
  AppRouter,
  router,
  routes,
  useSlot,
  useSharedModule,
  useSharedSlot,
  useSharedProps,
} from "vite-plugin-react-app-router/client";

// AppRouter - Ready-to-use component
<AppRouter />;

// router - createBrowserRouter instance
// Useful for programmatic navigation
router.navigate("/about");

// routes - Array of RouteObject
// Useful for customization

// useSlot(name) - retrieves a parallel-route slot's element
const modal = useSlot("modal");

// useSharedModule() - info about the closest enclosing shared module
const info = useSharedModule(); // { name, activeSubShareds } | null

// useSharedSlot(subName) - boolean shortcut: is this sub-shared enabled?
const showHistory = useSharedSlot("history");

// useSharedProps<T>() - merged props.tsx values from the enclosing invocation chain
const { apiBase } = useSharedProps<{ apiBase: string }>();
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
