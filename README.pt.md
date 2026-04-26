# vite-plugin-react-app-router

Um plugin Vite que traz o roteamento baseado em arquivos do **Next.js App Router** para projetos React padrao. Gera rotas `react-router-dom` dinamicamente com base na estrutura de diretorios.

## Funcionalidades

- **Roteamento baseado em arquivos** — Mesmas convencoes do Next.js App Router
- **Suporte a HMR** — Atualizacoes automaticas quando arquivos de rota mudam
- **JIT em desenvolvimento** — Rotas geradas dinamicamente sem criar arquivos no source
- **Otimizado para producao** — Rotas incluidas diretamente no bundle para tree-shaking
- **Layouts aninhados** — Suporte completo para `layout.tsx` com `<Outlet />`
- **Rotas interceptadas** — Marcadores `(.)`, `(..)`, `(..)(..)`, `(...)`
- **Rotas paralelas** — Slots `@name/` resolvidos pelo hook `useSlot(name)`
- **Modulos compartilhados** — Subarvores reutilizaveis `+name/` invocadas com `[+name]` / `(+name)`, com opt-out via `[-name]`

## Objetivos

- Fornecer uma experiencia de desenvolvimento similar ao Next.js App Router em projetos React + Vite padrao
- Zero geracao de arquivos de configuracao no diretorio source
- Integracao perfeita com `react-router-dom`
- Overhead minimo em tempo de execucao

## Limitacoes

- Server components nao sao suportados (este e um router client-side)

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
      // Habilita lazy loading para code splitting (padrao: true)
      lazy: true,
    }),
  ],
});
```

### Opcoes do Plugin

| Opcao    | Tipo                             | Padrao      | Descricao                                                                                         |
| -------- | -------------------------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| `appDir` | `string`                         | `'src/app'` | Diretorio contendo os arquivos do app router                                                      |
| `lazy`   | `boolean`                        | `true`      | Habilita lazy loading usando `React.lazy()` para code splitting. Resulta em bundle inicial menor. |
| `debug`  | `boolean \| 'console' \| string` | `false`     | Modo debug: `true`/`'console'` loga no console, string de caminho escreve em arquivo              |

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

| Arquivo         | Descricao                                                                  |
| --------------- | -------------------------------------------------------------------------- |
| `page.tsx`      | Componente da pagina (obrigatorio para criar rota)                         |
| `layout.tsx`    | Layout que envolve paginas filhas                                          |
| `loading.tsx`   | Componente de loading (fallback de Suspense)                               |
| `error.tsx`     | Error boundary (renderiza dentro do layout do mesmo segmento)              |
| `not-found.tsx` | Componente 404 para URLs nao mapeadas                                      |
| `default.tsx`   | Dentro de `@slot/`, fallback quando nenhuma rota do slot casa com a URL    |

## Rotas Dinamicas e Diretorios Especiais

| Padrao         | Exemplo         | Resultado                                                       |
| -------------- | --------------- | --------------------------------------------------------------- |
| `[param]`      | `[id]`          | `:id` — parametro dinamico                                      |
| `[...param]`   | `[...slug]`     | `*` — catch-all                                                 |
| `[[...param]]` | `[[...slug]]`   | `*` — catch-all opcional                                        |
| `(group)`      | `(auth)`        | Route group (nao incluido na URL)                               |
| `_private`     | `_components`   | Ignorado (pasta privada, nunca gera rota)                       |
| `(.) / (..) / (..)(..) / (...)` | `(..)photo` | Marcador de rota interceptada (ver Rotas Interceptadas) |
| `@name`        | `@modal`        | Slot de rota paralela (ver Rotas Paralelas)                     |
| `+name`        | `+clientes`, `+[id]`     | Definicao de modulo compartilhado (parametrico permitido)       |
| `[+name]`      | `[+clientes]`, `[+[id]]` | Invocacao bracket (adiciona segmento; parametrico → `:id`)      |
| `(+name)`      | `(+clientes)`   | Invocacao paren de modulo compartilhado (transparente)          |
| `[-name]` ou `-name` | `[-historico]`, `-[id]` | Dentro de invocacao, omite sub-shared (forma curta sem brackets, parametrico permitido) |
| `props.tsx` na invocacao | `[+clientes]/props.tsx` | Default-export repassado para a subarvore via `useSharedProps()` |

## Rotas Interceptadas

Seguindo a [convencao do Next.js](https://nextjs.org/docs/app/api-reference/file-conventions/intercepting-routes), um diretorio cujo nome comeca com `(.)`, `(..)`, `(..)(..)` ou `(...)` define uma rota que e renderizada **no lugar de** outra rota quando a navegacao parte do segmento de origem. Navegacao direta (barra de URL, refresh) renderiza a pagina canonica; navegacao "soft" que opte por interceptar (veja abaixo) renderiza a pagina interceptante.

| Marker      | Significa                              |
| ----------- | -------------------------------------- |
| `(.)`       | Mesmo nivel do pai do marker           |
| `(..)`      | Um segmento de rota acima              |
| `(..)(..)`  | Dois segmentos de rota acima           |
| `(...)`     | A raiz `app`                           |

A convencao e baseada em **segmentos de rota**, entao diretorios `(group)` nao contam para a contagem de subida.

### Exemplo

```
src/app/
├── feed/
│   ├── (..)photo/[id]/
│   │   └── page.tsx       # intercepta /photo/:id quando vem de /feed
│   └── page.tsx           # /feed
└── photo/[id]/
    └── page.tsx           # /photo/:id (canonica)
```

Para acionar uma navegacao interceptada, defina `state.appRouterBackgroundLocation` em um `<Link>`:

```tsx
import { Link, useLocation } from "react-router-dom";

export default function FeedItem({ id }: { id: string }) {
  const location = useLocation();
  return (
    <Link to={`/photo/${id}`} state={{ appRouterBackgroundLocation: location }}>
      Abrir foto
    </Link>
  );
}
```

Quando `appRouterBackgroundLocation` esta definido e bate com o source de uma rota interceptada, a pagina interceptante e renderizada na URL de destino. Em refresh ou visita direta, a pagina canonica e renderizada.

### Notas

- A rota interceptada exige uma pagina canonica irma na URL de destino. Sem ela, o plugin emite um warning em build/dev e ignora a interceptacao.
- A pagina interceptante substitui a pagina canonica (sem slot paralelo). Se quiser manter a pagina origem visivel atras de um modal, renderize o modal voce mesmo com um portal — `useLocation().state?.appRouterBackgroundLocation` indica de onde o usuario veio.
- Hard refresh (F5) renderiza a pagina canonica. O plugin remove `appRouterBackgroundLocation` do `history.state` quando `performance.navigation.type === 'reload'`, entao a interceptacao so dispara em navegacao soft (via Link), igual ao Next.js. Back/forward reaplica a interceptacao porque o estado e preservado nessas entradas.
- `loading.tsx` dentro de uma subarvore interceptante e respeitado como fallback de Suspense da pagina interceptante.

## Rotas Paralelas

Seguindo a [convencao do Next.js](https://nextjs.org/docs/app/api-reference/file-conventions/parallel-routes), um diretorio chamado `@name/` declara um **slot de rota paralela** pertencente ao segmento que o contem (irmaos do `layout.tsx`). A arvore do slot e casada **independentemente** com a URL e o elemento casado e exposto ao layout via o hook `useSlot(name)`.

| Arquivo                | Proposito                                                                |
| ---------------------- | ------------------------------------------------------------------------ |
| `@slot/page.tsx`       | Pagina renderizada quando a URL bate exatamente com o segmento dono      |
| `@slot/<sub>/page.tsx` | Pagina renderizada quando a URL e `<dono>/<sub>` ou aninhada             |
| `@slot/default.tsx`    | Fallback renderizado quando nenhuma rota do slot bate com a URL          |
| `@slot/layout.tsx`     | Layout opcional que envolve a arvore do slot                             |

### Exemplo

```
src/app/
├── @modal/
│   ├── default.tsx               # quando /photo/:id nao bate
│   └── photo/[id]/page.tsx       # quando URL e /photo/:id
├── @aside/
│   └── default.tsx
├── layout.tsx
├── page.tsx
└── photo/[id]/page.tsx           # pagina canonica em /photo/:id
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
      <main><Outlet /></main>
      {aside}
      {modal}
    </>
  );
}
```

### Notas

- Slots tem escopo no segmento dono: `@drawer/` ao lado de `app/dashboard/layout.tsx` so aparece naquele layout. Providers mais proximos vencem em caso de colisao de nomes.
- `useSlot(name)` retorna um React element (ou `null` quando nenhum provider registrou o slot). Renderize-o onde quiser que o slot apareca.
- As rotas do slot usam padroes **absolutos** internamente, entao `useRoutes` casa contra a location independente da arvore principal.
- Quando `useRoutes` retorna `null` (nenhum descendente bate na URL) o slot cai em `default.tsx`. Sem default, o slot renderiza nada.

## Modulos Compartilhados (Shared Route Modules)

Um diretorio chamado `+name/` define uma **subarvore de rotas reutilizavel** que pode ser invocada em varios lugares do app — util para montar o mesmo conjunto de paginas sob prefixos diferentes (ex.: um modulo `clientes` reutilizado em `/financeiro/clientes` e `/atendimento/clientes`).

| Marker          | Proposito                                                                            |
| --------------- | ------------------------------------------------------------------------------------ |
| `+name/`        | Definicao da subarvore compartilhada (parseada como arvore de rotas regular).        |
| `+[param]/`     | Definicao parametrica — invocacao gera segmento dinamico (`+[id]` → `:id`).          |
| `[+name]/`      | Invocacao bracket: adiciona `name` como segmento de URL (`/parent/name/...`).        |
| `[+[param]]/`   | Invocacao bracket parametrica (ex.: `[+[id]]/` → `/parent/:id`).                     |
| `(+name)/`      | Invocacao paren: transparente (`/parent/...`). Nao pode ter `page.tsx` irma.         |
| `[-name]/` ou `-name/` | Dentro de invocacao, omite o sub-shared correspondente do enxerto. A forma curta sem brackets e equivalente e so vale dentro de invocacoes. |
| `[-[param]]/` ou `-[param]/` | Omite sub-shared parametrico (ex.: `-[id]/` ignora `+[id]/` naquela posicao). |
| `+name/+sub/`   | Sub-shared aninhado. Auto-incluido quando o parent e invocado, salvo `[-sub]`.       |
| `props.tsx`     | No site da invocacao (top ou drill-down), default-export repassado via `useSharedProps()`. Providers internos sobrepoem externos (mais proximo vence). |

### Visibilidade

Um `+name/` so e visivel para **irmaos** do diretorio que o contem (e descendentes). Coloque modulos compartilhados em um irmao como `(shared)/` para escopa-los a um diretorio pai. O match mais proximo vence (avo mais profundo).

### Exemplo

```
src/app/
├── (shared)/
│   └── +clientes/
│       ├── layout.tsx
│       ├── page.tsx                       # /<prefixo>/
│       └── [id]/
│           ├── page.tsx                   # /<prefixo>/:id
│           └── +historico/
│               └── page.tsx               # /<prefixo>/:id/historico (sub-shared)
├── financeiro/
│   ├── layout.tsx
│   └── [+clientes]/                       # monta em /financeiro/clientes/...
└── atendimento/
    ├── layout.tsx
    └── [+clientes]/
        └── [id]/
            ├── [-historico]/              # opt-out do +historico nessa invocacao
            └── page.tsx                   # sobrescreve +clientes/[id]/page.tsx aqui
```

Gera as rotas:

- `/financeiro/clientes`, `/financeiro/clientes/:id`, `/financeiro/clientes/:id/historico`
- `/atendimento/clientes`, `/atendimento/clientes/:id` (sem `historico` — omitido; pagina `:id` vem do override)

### Overrides de arquivo na invocacao

Arquivos colocados dentro de `[+name]/` (ou em qualquer drill-down espelhando a estrutura do shared) substituem os arquivos do modulo compartilhado naquela posicao. Util para ajustar uma pagina sem forkar o modulo inteiro:

```
[+clientes]/
├── layout.tsx                 # sobrescreve +clientes/layout.tsx para ESTA invocacao
└── [id]/
    └── page.tsx               # sobrescreve +clientes/[id]/page.tsx
```

Os demais arquivos do shared continuam herdados.

### Modulos compartilhados parametricos

Nomes seguem as mesmas convencoes de segmentos dinamicos das rotas regulares — envolva em `[…]` para tornar parametrico:

```
src/app/
└── (shared)/
    └── +entity/
        ├── page.tsx         # /<prefixo>/
        └── +[id]/
            ├── page.tsx     # /<prefixo>/:id          (sub-shared parametrico)
            └── historico/
                └── page.tsx # /<prefixo>/:id/historico
```

Invoque normalmente, omita pelo nome (o `[id]` interno e o nome do sub-shared):

```
src/app/
├── foo/[+entity]/                   # /foo/entity, /foo/entity/:id, /foo/entity/:id/historico
└── bar/[+entity]/-[id]/             # /bar/entity apenas — sub-shared :id descartado (forma curta)
```

`[+[id]]/` faz o mesmo para **invocacoes** parametricas: `app/foo/[+[id]]/` monta o shared em `/foo/:id`.

### Repassando props com `props.tsx`

Um arquivo `props.tsx` (ou `.ts`/`.jsx`/`.js`) dentro de uma invocacao exporta como default um objeto cujos valores ficam disponiveis em toda a subarvore enxertada via `useSharedProps()`. Util para parametrizar um modulo compartilhado por invocacao sem forkar.

```tsx
// (shared)/+clientes/props.tsx — schema (NAO e importado pelo plugin, types-only)
export interface ClientesProps {
  apiBase: string;
  allowDelete: boolean;
}
```

```tsx
// billing/[+clientes]/props.tsx — valores reais dessa invocacao
import type { ClientesProps } from "../../(shared)/+clientes/props";
const value: ClientesProps = { apiBase: "/api/billing", allowDelete: false };
export default value;
```

```tsx
// (shared)/+clientes/[id]/page.tsx — leitura em runtime
import { useSharedProps } from "vite-plugin-react-app-router/client";
import type { ClientesProps } from "../../props";

export default function ClientePage() {
  const { apiBase, allowDelete } = useSharedProps<ClientesProps>();
  // …
}
```

`props.tsx` tambem pode ser colocado dentro dos drill-downs da invocacao (ex.: `[+clientes]/[id]/props.tsx`); providers mais profundos sobrepoem aos externos por chave (closer wins), mantendo as chaves nao sobrescritas herdadas.

O `+name/props.tsx` da definicao do shared e **types-only** do ponto de vista do plugin — nunca e importado no bundle. Coloque defaults runtime em outro modulo se quiser:

```tsx
// (shared)/+clientes/defaults.ts
export const defaults = { allowDelete: false };

// billing/[+clientes]/props.tsx
import { defaults } from "../../(shared)/+clientes/defaults";
export default { ...defaults, apiBase: "/api/billing" };
```

### Lendo sub-shareds ativos em runtime

Componentes renderizados dentro de um modulo compartilhado podem perguntar quais sub-shareds estao ativos no ponto de invocacao atual — util para esconder links de navegacao para areas omitidas:

```tsx
import { useSharedModule, useSharedSlot } from "vite-plugin-react-app-router/client";

export default function ClienteDetail() {
  const showHistorico = useSharedSlot("historico");
  const info = useSharedModule(); // { name: "clientes", activeSubShareds: ["historico"] } | null
  return (
    <>
      <h1>{info?.name}</h1>
      {showHistorico && <Link to="historico">Histórico</Link>}
    </>
  );
}
```

### Notas

- `(+name)` (paren) so e valido quando o diretorio invocador nao tem `page.tsx` irmao (ou o shared nao tem `pagePath`). O plugin emite warning quando ambos existem.
- Uma invocacao `[+name]` exige uma definicao `+name/` visivel; caso contrario o plugin avisa e a invocacao e descartada.
- Sub-shareds herdam URLs do enxerto pelo nome (estilo bracket): `+historico/` materializa em `<parentUrl>/historico`.

## Exportacoes

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

// AppRouter - Componente pronto para uso
<AppRouter />;

// router - Instancia do createBrowserRouter
router.navigate("/about");

// routes - Array de RouteObject
// useSlot(name) - obtem o elemento do slot paralelo
const modal = useSlot("modal");

// useSharedModule() - info do modulo compartilhado mais proximo
const info = useSharedModule(); // { name, activeSubShareds } | null

// useSharedSlot(subName) - boolean: o sub-shared esta ativo?
const showHistorico = useSharedSlot("historico");

// useSharedProps<T>() - valores de props.tsx mesclados na cadeia de invocacoes
const { apiBase } = useSharedProps<{ apiBase: string }>();
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
