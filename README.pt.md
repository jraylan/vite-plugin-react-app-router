# vite-plugin-react-app-router

Um plugin Vite que traz o roteamento baseado em arquivos do **Next.js App Router** para projetos React padrão. Gera rotas `react-router-dom` dinamicamente com base na estrutura de diretórios.

## Funcionalidades

- **Roteamento baseado em arquivos** — Mesmas convenções do Next.js App Router
- **Suporte a HMR** — Atualizações automáticas quando arquivos de rota mudam
- **JIT em desenvolvimento** — Rotas geradas dinamicamente sem criar arquivos no source
- **Otimizado para produção** — Rotas incluídas diretamente no bundle para tree-shaking
- **Layouts aninhados** — Suporte completo para `layout.tsx` com `<Outlet />`
- **Rotas interceptadas** — Marcadores `(.)`, `(..)`, `(..)(..)`, `(...)`
- **Rotas paralelas** — Slots `@name/` resolvidos pelo hook `useSlot(name)`
- **Módulos compartilhados** — Subárvores reutilizáveis `+name/` invocadas com `[+name]` / `(+name)`, com opt-out via `[-name]`

## Objetivos

- Fornecer uma experiência de desenvolvimento similar ao Next.js App Router em projetos React + Vite padrão
- Zero geração de arquivos de configuração no diretório source
- Integração perfeita com `react-router-dom`
- Overhead mínimo em tempo de execução

## Limitações

- Server components não são suportados (este é um router client-side)

## Instalação

```bash
npm install vite-plugin-react-app-router react-router-dom
```

## Configuração

### vite.config.ts

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import reactAppRouter from "vite-plugin-react-app-router";

export default defineConfig({
  plugins: [
    react(),
    reactAppRouter({
      // Diretório do app (padrão: 'src/app')
      appDir: "src/app",
      // Habilita lazy loading para code splitting (padrão: true)
      lazy: true,
    }),
  ],
});
```

### Opções do Plugin

| Opção    | Tipo                             | Padrão      | Descrição                                                                                         |
| -------- | -------------------------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| `appDir` | `string`                         | `'src/app'` | Diretório contendo os arquivos do app router                                                      |
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

Adicione a referência de tipos:

```json
{
  "compilerOptions": {
    "types": ["vite-plugin-react-app-router/types"]
  }
}
```

## Estrutura de Diretórios

```
src/app/
├── layout.tsx        # Layout raiz
├── page.tsx          # Página inicial (/)
├── about/
│   └── page.tsx      # /about
├── blog/
│   ├── layout.tsx    # Layout do blog
│   ├── page.tsx      # /blog
│   └── [slug]/
│       └── page.tsx  # /blog/:slug
├── (auth)/           # Route group (não afeta a URL)
│   ├── login/
│   │   └── page.tsx  # /login
│   └── register/
│       └── page.tsx  # /register
└── [...catchAll]/
    └── page.tsx      # Rota catch-all
```

## Convenções de Arquivos

| Arquivo         | Descrição                                                                  |
| --------------- | -------------------------------------------------------------------------- |
| `page.tsx`      | Componente da página (obrigatório para criar rota)                         |
| `layout.tsx`    | Layout que envolve páginas filhas                                          |
| `loading.tsx`   | Componente de loading (fallback de Suspense)                               |
| `error.tsx`     | Error boundary (renderiza dentro do layout do mesmo segmento)              |
| `not-found.tsx` | Componente 404 para URLs não mapeadas                                      |
| `default.tsx`   | Dentro de `@slot/`, fallback quando nenhuma rota do slot casa com a URL    |

## Rotas Dinâmicas e Diretórios Especiais

| Padrão         | Exemplo         | Resultado                                                       |
| -------------- | --------------- | --------------------------------------------------------------- |
| `[param]`      | `[id]`          | `:id` — parâmetro dinâmico                                      |
| `[...param]`   | `[...slug]`     | `*` — catch-all                                                 |
| `[[...param]]` | `[[...slug]]`   | `*` — catch-all opcional                                        |
| `(group)`      | `(auth)`        | Route group (não incluído na URL)                               |
| `_private`     | `_components`   | Ignorado (pasta privada, nunca gera rota)                       |
| `(.) / (..) / (..)(..) / (...)` | `(..)photo` | Marcador de rota interceptada (ver Rotas Interceptadas) |
| `@name`        | `@modal`        | Slot de rota paralela (ver Rotas Paralelas)                     |
| `+name`        | `+clientes`, `+[id]`     | Definição de módulo compartilhado (paramétrico permitido)       |
| `[+name]`      | `[+clientes]`, `[+[id]]` | Invocação bracket (adiciona segmento; paramétrico → `:id`)      |
| `(+name)`      | `(+clientes)`   | Invocação paren de módulo compartilhado (transparente)          |
| `[-name]` ou `-name` | `[-historico]`, `-[id]` | Dentro de invocação, omite sub-shared (forma curta sem brackets, paramétrico permitido) |
| `props.tsx` na invocação | `[+clientes]/props.tsx` | Default-export repassado para a subárvore via `useSharedProps()` |

## Rotas Interceptadas

Seguindo a [convenção do Next.js](https://nextjs.org/docs/app/api-reference/file-conventions/intercepting-routes), um diretório cujo nome começa com `(.)`, `(..)`, `(..)(..)` ou `(...)` define uma rota que é renderizada **no lugar de** outra rota quando a navegação parte do segmento de origem. Navegação direta (barra de URL, refresh) renderiza a página canônica; navegação "soft" que opte por interceptar (veja abaixo) renderiza a página interceptante.

| Marker      | Significa                              |
| ----------- | -------------------------------------- |
| `(.)`       | Mesmo nível do pai do marker           |
| `(..)`      | Um segmento de rota acima              |
| `(..)(..)`  | Dois segmentos de rota acima           |
| `(...)`     | A raiz `app`                           |

A convenção é baseada em **segmentos de rota**, então diretórios `(group)` não contam para a contagem de subida.

### Exemplo

```
src/app/
├── feed/
│   ├── (..)photo/[id]/
│   │   └── page.tsx       # intercepta /photo/:id quando vem de /feed
│   └── page.tsx           # /feed
└── photo/[id]/
    └── page.tsx           # /photo/:id (canônica)
```

Para acionar uma navegação interceptada, defina `state.appRouterBackgroundLocation` em um `<Link>`:

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

Quando `appRouterBackgroundLocation` está definido e bate com o source de uma rota interceptada, a página interceptante é renderizada na URL de destino. Em refresh ou visita direta, a página canônica é renderizada.

### Notas

- A rota interceptada exige uma página canônica irmã na URL de destino. Sem ela, o plugin emite um warning em build/dev e ignora a interceptação.
- A página interceptante substitui a página canônica (sem slot paralelo). Se quiser manter a página origem visível atrás de um modal, renderize o modal você mesmo com um portal — `useLocation().state?.appRouterBackgroundLocation` indica de onde o usuário veio.
- Hard refresh (F5) renderiza a página canônica. O plugin remove `appRouterBackgroundLocation` do `history.state` quando `performance.navigation.type === 'reload'`, então a interceptação só dispara em navegação soft (via Link), igual ao Next.js. Back/forward reaplica a interceptação porque o estado é preservado nessas entradas.
- `loading.tsx` dentro de uma subárvore interceptante é respeitado como fallback de Suspense da página interceptante.
- **Outlet de BG permanece montado.** Quando há pelo menos um intercept `(.)`/`(..)` no app, o plugin emite um AppRouter com `BrowserRouter` + `useRoutes` (em vez de `createBrowserRouter` + `RouterProvider`). O InnerRouter passa `state.appRouterBackgroundLocation` ao `useRoutes` quando o par source+target casa, então o React mantém as instâncias de componentes do BG (mesmos DOM nodes, mesmo state) enquanto o `useRoutes` próprio do overlay roda a subárvore de rotas do intercept contra a location atual. Trade-off: o export `router` é `null` em modo intercept (sem instância de `createBrowserRouter`) — use `useNavigate()` do `react-router-dom` para navegação programática.
- **Módulos compartilhados como intercept.** Um marker de intercept pode prefixar uma invocação shared: `feed/(..)[+photo]/` monta o template `+photo/` como interceptação com source `/feed` e target derivado climbando os ancestrais de rota (aqui `/photo/:id` se `+photo/[id]/page.tsx` existir). Cada entrada de intercept carrega uma subárvore de rotas completa (layout + página do template intercept envolvendo os sub-shareds do canônico pareado), então a navegação tab-style dentro do overlay mantém o shell montado através de mudanças `:param`/sub-rota. Alinhe o nome do shared com o segmento URL desejado — `[+photo]` adiciona `photo`, `[+photoModal]` adiciona `photoModal`. Forma paren `(..)(+photo)/` também funciona (transparente — sem adicionar segmento no nível climbado).
- **Templates com intercept embutido.** Um template pode pré-declarar o climb level embutindo o marker no nome da definição: `+(.)foo/`, `+(..)foo/`, `+(...)foo/`, `+(..)(..)foo/`. Quando consumido sem prefixo (`[+foo]/`), o nível é herdado do template e a subárvore vira intercept. Prefixo no consumer `(.)[+foo]/` continua funcionando e sobrepõe o nível do template. Regras de remoção/paramétrico/`props.tsx` permanecem inalteradas.
- **Variantes intercept irmãs pareiam automaticamente.** Declarar `+(.)<nome>/` ao lado de `+<nome>/` dentro do mesmo módulo compartilhado pai produz uma variante intercept do sub-shared canônico. O `layout.tsx` + `page.tsx` do intercept substituem os do canônico na raiz da subárvore overlay, mas os sub-shareds do canônico (`+info/`, `+atendimentos/`, ...) são herdados como filhos — então `/clientes/:id/info` continua renderizando dentro do shell de layout do overlay quando navegado soft. Opt-out por mount com o marker de omissão intercept-only `[-(.)<nome>]/` (o `[-<nome>]/` nu continua descartando ambas as variantes).
- **Hoisting de providers.** Providers acima da árvore de rotas (`QueryClientProvider`, theme, i18n, ...) ficam acima do `<AppRouter />` em `main.tsx`, **não** dentro de `app/layout.tsx`. O overlay intercept é renderizado como sibling Fragment da árvore de rotas canônica (para o outlet BG ficar montado através da mudança de URL), então não herda contexto fornecido dentro de `app/layout.tsx`. Hoisting de providers para o pai do AppRouter garante que tanto a subárvore canônica quanto a overlay os enxergam.

## Rotas Paralelas

Seguindo a [convenção do Next.js](https://nextjs.org/docs/app/api-reference/file-conventions/parallel-routes), um diretório chamado `@name/` declara um **slot de rota paralela** pertencente ao segmento que o contém (irmãos do `layout.tsx`). A árvore do slot é casada **independentemente** com a URL e o elemento casado é exposto ao layout via o hook `useSlot(name)`.

| Arquivo                | Propósito                                                                |
| ---------------------- | ------------------------------------------------------------------------ |
| `@slot/page.tsx`       | Página renderizada quando a URL bate exatamente com o segmento dono      |
| `@slot/<sub>/page.tsx` | Página renderizada quando a URL é `<dono>/<sub>` ou aninhada             |
| `@slot/default.tsx`    | Fallback renderizado quando nenhuma rota do slot bate com a URL          |
| `@slot/layout.tsx`     | Layout opcional que envolve a árvore do slot                             |

### Exemplo

```
src/app/
├── @modal/
│   ├── default.tsx               # quando /photo/:id não bate
│   └── photo/[id]/page.tsx       # quando URL é /photo/:id
├── @aside/
│   └── default.tsx
├── layout.tsx
├── page.tsx
└── photo/[id]/page.tsx           # página canônica em /photo/:id
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

- Slots têm escopo no segmento dono: `@drawer/` ao lado de `app/dashboard/layout.tsx` só aparece naquele layout. Providers mais próximos vencem em caso de colisão de nomes.
- `useSlot(name)` retorna um React element (ou `null` quando nenhum provider registrou o slot). Renderize-o onde quiser que o slot apareça.
- As rotas do slot usam padrões **absolutos** internamente, então `useRoutes` casa contra a location independente da árvore principal.
- Quando `useRoutes` retorna `null` (nenhum descendente bate na URL) o slot cai em `default.tsx`. Sem default, o slot renderiza nada.

## Módulos Compartilhados (Shared Route Modules)

Um diretório chamado `+name/` define uma **subárvore de rotas reutilizável** que pode ser invocada em vários lugares do app — útil para montar o mesmo conjunto de páginas sob prefixos diferentes (ex.: um módulo `clientes` reutilizado em `/financeiro/clientes` e `/atendimento/clientes`).

| Marker          | Propósito                                                                            |
| --------------- | ------------------------------------------------------------------------------------ |
| `+name/`        | Definição da subárvore compartilhada (parseada como árvore de rotas regular).        |
| `+[param]/`     | Definição paramétrica — invocação gera segmento dinâmico (`+[id]` → `:id`).          |
| `[+name]/`      | Invocação bracket: adiciona `name` como segmento de URL (`/parent/name/...`).        |
| `[+[param]]/`   | Invocação bracket paramétrica (ex.: `[+[id]]/` → `/parent/:id`).                     |
| `(+name)/`      | Invocação paren: transparente (`/parent/...`). Não pode ter `page.tsx` irmã.         |
| `[-name]/` ou `-name/` | Dentro de invocação, omite o sub-shared correspondente do enxerto. A forma curta sem brackets é equivalente e só vale dentro de invocações. |
| `[-[param]]/` ou `-[param]/` | Omite sub-shared paramétrico (ex.: `-[id]/` ignora `+[id]/` naquela posição). |
| `+name/+sub/`   | Sub-shared aninhado. Auto-incluído quando o parent é invocado, salvo `[-sub]`.       |
| `props.tsx`     | No site da invocação (top ou drill-down), default-export repassado via `useSharedProps()`. Providers internos sobrepõem externos (mais próximo vence). |

### Visibilidade

Um `+name/` só é visível para **irmãos** do diretório que o contém (e descendentes). Coloque módulos compartilhados em um irmão como `(shared)/` para escopá-los a um diretório pai. O match mais próximo vence (avô mais profundo).

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
            ├── [-historico]/              # opt-out do +historico nessa invocação
            └── page.tsx                   # sobrescreve +clientes/[id]/page.tsx aqui
```

Gera as rotas:

- `/financeiro/clientes`, `/financeiro/clientes/:id`, `/financeiro/clientes/:id/historico`
- `/atendimento/clientes`, `/atendimento/clientes/:id` (sem `historico` — omitido; página `:id` vem do override)

### Overrides de arquivo na invocação

Arquivos colocados dentro de `[+name]/` (ou em qualquer drill-down espelhando a estrutura do shared) substituem os arquivos do módulo compartilhado naquela posição. Útil para ajustar uma página sem forkar o módulo inteiro:

```
[+clientes]/
├── layout.tsx                 # sobrescreve +clientes/layout.tsx para ESTA invocação
└── [id]/
    └── page.tsx               # sobrescreve +clientes/[id]/page.tsx
```

Os demais arquivos do shared continuam herdados.

### Módulos compartilhados paramétricos

Nomes seguem as mesmas convenções de segmentos dinâmicos das rotas regulares — envolva em `[…]` para tornar paramétrico:

```
src/app/
└── (shared)/
    └── +entity/
        ├── page.tsx         # /<prefixo>/
        └── +[id]/
            ├── page.tsx     # /<prefixo>/:id          (sub-shared paramétrico)
            └── historico/
                └── page.tsx # /<prefixo>/:id/historico
```

Invoque normalmente, omita pelo nome (o `[id]` interno é o nome do sub-shared):

```
src/app/
├── foo/[+entity]/                   # /foo/entity, /foo/entity/:id, /foo/entity/:id/historico
└── bar/[+entity]/-[id]/             # /bar/entity apenas — sub-shared :id descartado (forma curta)
```

`[+[id]]/` faz o mesmo para **invocações** paramétricas: `app/foo/[+[id]]/` monta o shared em `/foo/:id`.

### Repassando props com `props.tsx`

Um arquivo `props.tsx` (ou `.ts`/`.jsx`/`.js`) dentro de uma invocação exporta como default um objeto cujos valores ficam disponíveis em toda a subárvore enxertada via `useSharedProps()`. Útil para parametrizar um módulo compartilhado por invocação sem forkar.

```tsx
// (shared)/+clientes/props.tsx — schema (NÃO é importado pelo plugin, types-only)
export interface ClientesProps {
  apiBase: string;
  allowDelete: boolean;
}
```

```tsx
// billing/[+clientes]/props.tsx — valores reais dessa invocação
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

`props.tsx` também pode ser colocado dentro dos drill-downs da invocação (ex.: `[+clientes]/[id]/props.tsx`); providers mais profundos sobrepõem aos externos por chave (closer wins), mantendo as chaves não sobrescritas herdadas.

O `+name/props.tsx` da definição do shared é **types-only** do ponto de vista do plugin — nunca é importado no bundle. Coloque defaults runtime em outro módulo se quiser:

```tsx
// (shared)/+clientes/defaults.ts
export const defaults = { allowDelete: false };

// billing/[+clientes]/props.tsx
import { defaults } from "../../(shared)/+clientes/defaults";
export default { ...defaults, apiBase: "/api/billing" };
```

### Lendo sub-shareds ativos em runtime

Componentes renderizados dentro de um módulo compartilhado podem perguntar quais sub-shareds estão ativos no ponto de invocação atual — útil para esconder links de navegação para áreas omitidas:

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

- `(+name)` (paren) só é válido quando o diretório invocador não tem `page.tsx` irmão (ou o shared não tem `pagePath`). O plugin emite warning quando ambos existem.
- Uma invocação `[+name]` exige uma definição `+name/` visível; caso contrário o plugin avisa e a invocação é descartada.
- Sub-shareds herdam URLs do enxerto pelo nome (estilo bracket): `+historico/` materializa em `<parentUrl>/historico`.

## Exportações

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

// router - Instância do createBrowserRouter
// `null` quando há intercepts declarados (AppRouter usa BrowserRouter).
// Nesse caso use useNavigate() do react-router-dom dentro de componentes.
router.navigate("/about");

// routes - Array de RouteObject
// useSlot(name) - obtém o elemento do slot paralelo
const modal = useSlot("modal");

// useSharedModule() - info do módulo compartilhado mais próximo
const info = useSharedModule(); // { name, activeSubShareds } | null

// useSharedSlot(subName) - boolean: o sub-shared está ativo?
const showHistorico = useSharedSlot("historico");

// useSharedProps<T>() - valores de props.tsx mesclados na cadeia de invocações
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

## Exemplo de Página

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

## Opções do Plugin

```typescript
interface PluginOptions {
  /** Diretório do app router (padrão: "src/app") */
  appDir?: string;
  /** Extensões de arquivo suportadas */
  extensions?: string[];
}
```

## Pastas Privadas

Pastas que começam com `_` são ignoradas e não geram rotas. Use-as para componentes, utilitários ou outros arquivos que não são rotas:

```
src/app/
├── _components/      # Ignorado - use para componentes compartilhados
│   └── Button.tsx
├── _lib/             # Ignorado - use para utilitários
│   └── api.ts
└── dashboard/
    └── page.tsx      # /dashboard
```

## Navegação

Use `<Link>` do `react-router-dom` para navegação client-side. Usar tags `<a>` regulares causará recarregamento completo da página:

```tsx
// Correto - navegação SPA
import { Link } from "react-router-dom";
<Link to="/about">Sobre</Link>

// Incorreto - recarregamento completo da página
<a href="/about">Sobre</a>
```

## Requisitos

- Vite 5.x ou 6.x
- React 18.x ou 19.x
- react-router-dom 6.x ou 7.x

## Licença

MIT
