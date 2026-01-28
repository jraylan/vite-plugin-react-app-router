# vite-plugin-react-app-router

Um plugin Vite que traz o roteamento baseado em arquivos do **Next.js App Router** para projetos React padrao. Gera rotas `react-router-dom` dinamicamente com base na estrutura de diretorios.

## Funcionalidades

- **Roteamento baseado em arquivos** - Mesmas convencoes do Next.js App Router
- **Suporte a HMR** - Atualizacoes automaticas quando arquivos de rota mudam
- **JIT em desenvolvimento** - Rotas geradas dinamicamente sem criar arquivos no source
- **Otimizado para producao** - Rotas incluidas diretamente no bundle para tree-shaking
- **Layouts aninhados** - Suporte completo para `layout.tsx` com `<Outlet />`

## Objetivos

- Fornecer uma experiencia de desenvolvimento similar ao Next.js App Router em projetos React + Vite padrao
- Zero geracao de arquivos de configuracao no diretorio source
- Integracao perfeita com `react-router-dom`
- Overhead minimo em tempo de execucao

## Limitacoes

- Apenas `page.tsx` e `layout.tsx` sao suportados atualmente
- `loading.tsx`, `error.tsx` e `not-found.tsx` sao parseados mas ainda nao funcionam
- Server components nao sao suportados (este e um router client-side)
- Rotas paralelas e rotas de interceptacao nao estao implementadas

## Instalacao

```bash
npm install vite-plugin-react-app-router react-router-dom
```

## Configuracao

### vite.config.ts

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import reactAppRouter from "vite-plugin-react-app-router";

export default defineConfig({
  plugins: [
    react(),
    reactAppRouter({
      // Diretorio do app (padrao: 'src/app')
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

Adicione a referencia de tipos:

```json
{
  "compilerOptions": {
    "types": ["vite-plugin-react-app-router/types"]
  }
}
```

## Estrutura de Diretorios

```
src/app/
├── layout.tsx        # Layout raiz
├── page.tsx          # Pagina inicial (/)
├── about/
│   └── page.tsx      # /about
├── blog/
│   ├── layout.tsx    # Layout do blog
│   ├── page.tsx      # /blog
│   └── [slug]/
│       └── page.tsx  # /blog/:slug
├── (auth)/           # Route group (nao afeta a URL)
│   ├── login/
│   │   └── page.tsx  # /login
│   └── register/
│       └── page.tsx  # /register
└── [...catchAll]/
    └── page.tsx      # Rota catch-all
```

## Convencoes de Arquivos

| Arquivo         | Descricao                                          |
| --------------- | -------------------------------------------------- |
| `page.tsx`      | Componente da pagina (obrigatorio para criar rota) |
| `layout.tsx`    | Layout que envolve paginas filhas                  |
| `loading.tsx`   | Componente de loading (ainda nao implementado)     |
| `error.tsx`     | Componente de erro (ainda nao implementado)        |
| `not-found.tsx` | Componente 404 (ainda nao implementado)            |

## Rotas Dinamicas

| Padrao         | Exemplo       | Resultado                                    |
| -------------- | ------------- | -------------------------------------------- |
| `[param]`      | `[id]`        | `:id` - Parametro dinamico                   |
| `[...param]`   | `[...slug]`   | `*` - Catch-all                              |
| `[[...param]]` | `[[...slug]]` | `*` - Catch-all opcional                     |
| `(group)`      | `(auth)`      | Route group (nao incluido no caminho da URL) |

## Exportacoes

```tsx
import { AppRouter, router, routes } from "virtual:app-router";

// AppRouter - Componente pronto para uso
<AppRouter />;

// router - Instancia do createBrowserRouter
// Util para navegacao programatica
router.navigate("/about");

// routes - Array de RouteObject
// Util para customizacao
```

## Exemplo de Layout

Layouts devem usar `<Outlet />` do react-router-dom para renderizar rotas filhas:

```tsx
// src/app/layout.tsx
import { Outlet, Link } from "react-router-dom";

export default function RootLayout() {
  return (
    <div>
      <nav>
        <Link to="/">Home</Link>
        <Link to="/about">Sobre</Link>
      </nav>
      <main>
        <Outlet />
      </main>
      <footer>...</footer>
    </div>
  );
}
```

## Exemplo de Pagina

```tsx
// src/app/blog/[slug]/page.tsx
import { useParams, Link } from "react-router-dom";

export default function BlogPost() {
  const { slug } = useParams();
  return (
    <article>
      <h1>Post: {slug}</h1>
      <Link to="/blog">Voltar ao blog</Link>
    </article>
  );
}
```

## Opcoes do Plugin

```typescript
interface PluginOptions {
  /** Diretorio do app router (padrao: "src/app") */
  appDir?: string;
  /** Extensoes de arquivo suportadas */
  extensions?: string[];
}
```

## Pastas Privadas

Pastas que comecam com `_` sao ignoradas e nao geram rotas. Use-as para componentes, utilitarios ou outros arquivos que nao sao rotas:

```
src/app/
├── _components/      # Ignorado - use para componentes compartilhados
│   └── Button.tsx
├── _lib/             # Ignorado - use para utilitarios
│   └── api.ts
└── dashboard/
    └── page.tsx      # /dashboard
```

## Navegacao

Use `<Link>` do `react-router-dom` para navegacao client-side. Usar tags `<a>` regulares causara recarregamento completo da pagina:

```tsx
// Correto - navegacao SPA
import { Link } from "react-router-dom";
<Link to="/about">Sobre</Link>

// Incorreto - recarregamento completo da pagina
<a href="/about">Sobre</a>
```

## Requisitos

- Vite 5.x ou 6.x
- React 18.x ou 19.x
- react-router-dom 6.x ou 7.x

## Licenca

MIT
