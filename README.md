# LGO — Loop & Graph Orchestration

Framework local de engenharia agêntica com **OpenSpec + grafo executável + loops verificados**, implementado em **TypeScript strict/Node.js**. Mantém CLI, contratos JSON Schema, SQLite, gates de autoridade, aprendizado controlado e exemplo Java/Spring + Angular/PrimeNG.

**OpenSpec define; Graph agenda; Loop verifica; Gate autoriza; Learning propõe melhorias.**

Versão0.2 migra o runtime Python0.1. A instalação, a execução, a suíte e a demonstração não exigem Python. Aplicações consumidoras podem continuar usando qualquer linguagem em seus próprios comandos de build/teste. Mocks funcionam sem credenciais; processos CLI e harnesses HTTP implementam o mesmo contrato de patches.

## Instalar e executar

Ambiente validado: Linux/POSIX, **Node24.22.1** e npm11. Java17/JDK é necessário para o oracle executável da demo. O núcleo e os testes de scheduler não precisam de Java. A versão Node suportada está em `.nvmrc` e `package.json`.

```bash
npm ci --ignore-scripts
npm run build
npm run typecheck
npm test
npm run format:check
node scripts/eval.mjs
node scripts/demo.mjs --output ./lgo-demo
node dist/cli.js --help
```

Use um diretório de saída novo em cada demo. `npm test` usa o test runner do Node e testes TypeScript; não requer pytest, venv ou SDK proprietário.

Para gerar e instalar o pacote operacional:

```bash
npm pack
npm install -g ./cezaraf-lgo-0.2.0.tgz
lgo --help
```

O tarball contém JavaScript compilado, declarações TypeScript, schemas e templates. A instalação só requer as dependências de produção `ajv` e `yaml`; não compila addons nativos. O registry npm não recebeu publicação. A demo e a aplicação completa fazem parte do repositório de código.

## Usar com OpenSpec

O OpenSpec permanece uma CLI separada, suportada explicitamente na versão **1.16.1**. O `npm ci` instala essa ferramenta de desenvolvimento. Para invocá-la fora dos scripts npm:

```bash
export LGO_OPENSPEC="$PWD/node_modules/.bin/openspec"
node dist/cli.js --root /caminho/projeto --dry-run init
node dist/cli.js --root /caminho/projeto init
node dist/cli.js --root /caminho/projeto inspect minha-mudanca
node dist/cli.js --root /caminho/projeto plan minha-mudanca --bindings /caminho/bindings.json
node dist/cli.js --root /caminho/projeto validate-plan minha-mudanca
node dist/cli.js --root /caminho/projeto run minha-mudanca
node dist/cli.js --root /caminho/projeto status minha-mudanca
node dist/cli.js --root /caminho/projeto resume run-ID
node dist/cli.js --root /caminho/projeto verify run-ID
node dist/cli.js --root /caminho/projeto learn run-ID
```

Com o tarball instalado, substitua `node dist/cli.js` por `lgo`. `--root`, `--json` e `--dry-run` são preservados. `graph --format mermaid|dot|json`, `report`, `explain`, `cancel`, `invalidate`, `replan`, `export`, `integrate`, `sync-progress` e `prepare-archive` continuam disponíveis.

Bindings explícitos ligam tasks/requisitos oficiais a entradas, saídas, escopos, agentes e verificadores. O planner deriva dependências pelo consumo de artefatos e registra sua justificativa. A ordem/nome das tasks não determina dependências. Planejamento semântico completo a partir de intenção livre continua pendente.

## Migrar checkpoints da versão Python

Novas execuções criam SQLite operacional versão2. Contratos de mensagens e planos continuam em **1.0**. Um banco antigo não é retomado implicitamente.

```bash
# Pare o controlador Python primeiro.
lgo --root /caminho/projeto migrate-state --from-python --dry-run
lgo --root /caminho/projeto migrate-state --from-python
lgo --root /caminho/projeto resume run-ID
lgo --root /caminho/projeto verify run-ID
```

A migração verifica a cadeia de eventos, plano, política, especificações e hashes das saídas aprovadas. Antes de alterar registros, cria backup consistente em `.lgo/backups/`. Preserva unidades PASSED e suas tentativas; a integração e os gates exigem nova validação. Tokens de aprovação Python não autorizam o runtime TypeScript. Quando existe o lock antigo, a migração usa o utilitário POSIX `flock` para interoperar com `fcntl`. Execuções novas usam somente lease SQLite, sem esse helper.

Estados adulterados, fontes alteradas e versões desconhecidas bloqueiam a migração. Consulte [recuperação](docs/recovery.md) para reconciliar ou restaurar o backup.

## Evidências e demonstração

A demo cria arquivos de aplicação com mocks, agenda três unidades em paralelo, introduz HTTP200 indevido, reprova executando Java externamente e corrige para404. Fecha/reabre o store e preserva as tentativas das unidades aprovadas. A suíte também mata um processo real com SIGKILL e comprova retomada pelo SQLite.

A demo valida Java/contrato/estrutura offline. Testes Spring/MockMvc/H2 e build Angular são verificações adicionais, identificadas separadamente nos relatórios. Nenhum oracle textual é apresentado como E2E de navegador.

[Relatório da migração](docs/typescript-migration.md) · [Matriz de aceite](docs/acceptance.md) · [Cobertura dos testes](tests/README.md)

## Autoridade

O merge automático integra patches no workspace da execução. A entrega ao checkout consumidor exige decisão externa vinculada ao run, grafo, política, evidência e domínio do runtime:

```bash
lgo --root /caminho/projeto export run-ID > patch-review.json
lgo --root /caminho/projeto integrate run-ID > approval-request.json
# Operador revisa e assina a solicitação fora do worker.
node scripts/sign-approval.mjs --key /fora/projeto/operator.key --project /caminho/projeto --request approval-request.json --output approved.json --actor operador
lgo --root /caminho/projeto integrate run-ID --approval approved.json
lgo --root /caminho/projeto sync-progress minha-mudanca
lgo --root /caminho/projeto prepare-archive minha-mudanca --approval archive-token.json
```

A chave HMAC de32bytes/0600 deve ficar fora do projeto e ser configurada no controlador com `LGO_AUTHORITY_KEY_FILE`. O assinador exige terminal interativo. HMAC comprova autoridade operadora, não identidade/presença humana. Produção requer serviço protegido e sandbox real.

`sync-progress` só marca tasks cujas unidades estão verificadas/integradas e cujas saídas correspondem ao consumidor. `prepare-archive` aplica gates adicionais e prepara operações oficiais; não substitui nem executa o sincronizador/arquivador OpenSpec. A demo não inventa aprovação real e mantém archive bloqueado. Aprendizado fica PROPOSED; a consequência futura é explicitamente um what-if. Promoção/revogação são testadas com autoridade exclusiva de fixture.

## Estrutura

| Caminho | Responsabilidade |
| --- | --- |
| `src/` | API tipada, motor, scheduler/loops, adapters, OpenSpec, contratos, gates, SQLite, migração e CLI |
| `schemas/` |16 contratos JSON Schema2020-12 e fixtures válidas/inválidas |
| `tests/` | Suíte TypeScript, testes negativos e checkpoint real capturado da versão Python |
| `scripts/` | Demo, evals e assinador externo em Node |
| `templates/` | Configuração para projetos consumidores |
| `examples/tipo-exame/` | Spring/Angular, OpenSpec, bindings e verificadores Node |
| `openspec/` | Especificação do produto e da migração |
| `docs/` | Arquitetura, ADRs, instalação, adapters, recuperação, segurança e evidências |

## Documentação e limites

[Arquitetura](docs/architecture.md) · [ADR TypeScript](docs/adr/002-typescript-runtime.md) · [OpenSpec](docs/references/openspec.md) · [Adapters](docs/adapters.md) · [Segurança](docs/security.md) · [Roadmap](docs/roadmap.md)

O runtime não oferece sandbox de SO/rede para processos hostis. Verificadores, processos CLI e endpoints HTTP exigem confiança no host. Aprovações SSO, wrappers específicos Codex/Claude/OpenCode, ACP/MCP e exportação OTLP continuam pendentes. Checkpoint/merge/worker são recuperáveis; interrupções durante replan/invalidation que deixem hashes divergentes bloqueiam para reconciliação. Não há exactly-once universal para efeitos externos.

O histórico encadeado detecta corrupção, mas não um administrador que reescreva banco e cadeia. Custos/tokens são reports do adapter; mocks não medem LLM. Logs históricos Python permanecem identificados como versão0.1.

Licença MIT. Projeto independente: https://github.com/cezaraf/loop-graph-orchestration. O OpenSpec original não foi modificado.
