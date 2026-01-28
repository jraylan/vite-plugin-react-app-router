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

- Only `page.tsx` and `layout.tsx` are currently supported
- `loading.tsx`, `error.tsx`, and `not-found.tsx` are parsed but not yet functional
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
    }),
  ],
});
```

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

| File            | Description                                 |
| --------------- | ------------------------------------------- |
| `page.tsx`      | Page component (required to create a route) |
| `layout.tsx`    | Layout that wraps child pages               |
| `loading.tsx`   | Loading component (not yet implemented)     |
| `error.tsx`     | Error component (not yet implemented)       |
| `not-found.tsx` | 404 component (not yet implemented)         |

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

## Plugin Options

```typescript
interface PluginOptions {
  /** App router directory (default: "src/app") */
  appDir?: string;
  /** Supported file extensions */
  extensions?: string[];
}
```

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
