> LGO0.2: execute a orquestração com `node scripts/demo.mjs --output ./lgo-demo` a partir da raiz. Os verificadores do exemplo usam Node (`verification/check.mjs`); os logs abaixo foram originalmente coletados na validação da aplicação0.1.

# TipoExame: demonstração OpenSpec + LGO

Exemplo local com backend Java17/Spring Boot3.5.16/H2, frontend Angular20.3.35/PrimeNG20.4.0 e contrato OpenAPI3.1. Não deve ser exposto em produção: não há autenticação; o servidor usa loopback e banco efêmero.

## Pré-requisitos

- Node24.22.1 e LGO compilado a partir da raiz do projeto.
- OpenSpec1.16.1 suportado pelo adapter; conferir versão fixada no README principal.
- Java17 com módulo `jdk.compiler` para o oráculo offline.
- Para aplicação completa: Maven3.9+ e Node compatível com Angular20 (`^20.19 || ^22.12 || ^24`). Rede somente para instalar dependências.

## Aplicação

```bash
cd backend
mvn test
mvn spring-boot:run
```

Em outro terminal:

```bash
cd frontend
npm ci
npm run build
npm start
```

Acessar `http://127.0.0.1:4200`; proxy encaminha `/api` ao Spring em `127.0.0.1:8080`. O H2 em memória perde os dados ao encerrar o processo. O registro contém `codigo` e `nome`; o código é imutável na atualização.

## Oráculos externos

```bash
node verification/check.mjs integration
```

Este verificador compila e executa a classe Java `NotFoundPolicy` usada pelo advice REST, verifica os verbos CRUD, o contrato OpenAPI, o formulário e restrições arquiteturais objetivas. Não sobe Spring nem browser. Os cinco testes Maven usam Spring/H2/MockMvc e verificam CRUD, códigos404/400/409 e o contrato OpenAPI publicado. O build Angular verifica TypeScript/templates; E2E com browser não foi executado.

## Execução orquestrada

O plano `.lgo/plans/add-tipo-exame.json` liga cinco tasks da mudança real `openspec/changes/add-tipo-exame` às unidades `contract`, `backend`, `frontend`, `security` e `integration`.

Contrato, backend e frontend são produzidos simultaneamente, pois escrevem árvores distintas e partem do contrato de API já definido no design. Segurança depende de backend/frontend; integração depende dos quatro resultados. As dependências carregam a justificativa de consumo dos resultados validados, sem inferir ordem a partir do texto das tasks.

O mock backend deliberadamente escreve `return 200` na primeira tentativa. O oráculo Java exige404 e retorna não zero; na segunda tentativa o mock altera somente `NotFoundPolicy.java` para404. Frontend e contrato aprovados são preservados. A evidência é o resultado do verificador executado fora do mock, nunca a alegação do adapter.

A execução deve usar as instruções e scripts de demonstração no README principal. Não execute as tentativas manualmente sobre este exemplo: os patches são aplicados pelo LGO em isolamento sob o diretório de execução.

## Fontes e versões

- [Spring Boot: requisitos](https://docs.spring.io/spring-boot/system-requirements.html): linha3.5.16 mantida e Java17. O artefato3.5.16 foi confirmado no Maven Central.
- [Angular: compatibilidade](https://angular.dev/reference/versions): linha20 suporta Node24 e TypeScript5.9.
- [PrimeNG: instalação](https://primeng.org/installation): imports por componente e provider de tema. Versão20.4.0 confirmada no registry.

Versões fixadas para reprodutibilidade; atualizar dependências exige nova validação. `npm audit --omit=dev` foi executado: o resultado é uma consulta ao banco de advisories naquele momento, não prova de ausência de vulnerabilidades.

Os relatórios em `evidence/` distinguem a falha controlada dos testes finais. O teste negativo Maven foi executado em cópia separada com a mesma semântica de status; não altera o exemplo corrigido. Nenhum deploy nem publicação foi executado.
