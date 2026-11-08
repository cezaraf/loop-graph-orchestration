# LGO — Loop & Graph Orchestration

Framework local de engenharia de software com agentes, construído sobre **OpenSpec + grafos executáveis + loops de correção verificados**.

O OpenSpec mantém a especificação. O LGO transforma tarefas em unidades rastreáveis, agenda dependências, verifica patches, corrige falhas localizadas e preserva resultados aprovados. Gates controlam integração e autoridade; aprendizados são propostas sujeitas a validação.

**Versão atual: 0.2.0 — TypeScript strict e Node.js.** O runtime, a CLI e os testes não exigem Python nem SDK proprietário. A aplicação desenvolvida pode usar qualquer linguagem.

## O que funciona hoje

| Capacidade | Situação |
| --- | --- |
| OpenSpec | Consome mudanças reais; compatibilidade explícita com **1.16.1**, schema `spec-driven` |
| Planejamento | Bindings explícitos ligam tasks/requisitos a unidades; dependências derivam dos artefatos consumidos, com justificativas |
| Graph + Loop | Paralelismo, escopo de patches, recursos compartilhados, verificadores externos, correção localizada e limite de tentativas |
| Recuperação | SQLite local, checkpoints, evidências por tentativa e retomada preservando unidades válidas |
| Agentes | Mock sem credenciais; adapters genéricos de processo e HTTP com contratos JSON |
| Integração | Merge no workspace da execução; entrega ao checkout consumidor exige autoridade externa |
| Aprendizado | Candidatos, promoção/revogação controlada e constraints consumidas pelo planner |
| Ainda pendente | Planejamento completo por intenção livre, wrappers Codex/Claude/OpenCode, ACP/MCP, aprovação SSO e sandbox de SO/rede |

Não é necessário banco externo, fila ou cluster. Uma API de modelo compatível com OpenAI não equivale, por si só, a um harness que edita código e executa ferramentas.

## Começar pelo repositório

Ambiente validado: **Linux/POSIX, Node.js 24.22.1 e npm 11**. A faixa suportada é `>=24.22.1 <25`; consulte [.nvmrc](.nvmrc) e [package.json](package.json). A demo também exige **JDK 17** (`java` e `javac` no PATH). O núcleo e os testes de scheduler não precisam de Java.

```bash
git clone https://github.com/cezaraf/loop-graph-orchestration.git
cd loop-graph-orchestration
npm ci --ignore-scripts
npm run build
node dist/cli.js --version
node dist/cli.js --help
```

### Executar a demonstração

```bash
npm run demo -- --output ./lgo-demo
```

Use uma pasta de saída **nova** em cada execução. A demo é reproduzível sem credenciais e usa agentes mock; não chama uma LLM.

Ela lê a mudança OpenSpec `add-tipo-exame`, executa três workers em paralelo, introduz uma resposta HTTP 200 onde o esperado é 404 e detecta a falha com um verificador Java externo. Só o backend recebe a correção. Em seguida, fecha/reabre o store, retoma a execução e comprova a preservação das unidades aprovadas. Outro cenário demonstra o bloqueio de alto risco sem produzir uma aprovação humana fictícia.

Ao concluir, o resumo informa `state: ACCEPTED`, `peak_workers: 3`, duas tentativas para `backend` e uma para cada outra unidade. Os IDs e tempos variam; os valores vêm da execução. Consulte:

- `lgo-demo/demo-report.json`: evidências de correção, retomada, gates e aprendizado.
- `lgo-demo/graph.mmd`: grafo Mermaid.
- `lgo-demo/consumer/`: projeto consumidor com seu estado operacional em `.lgo/`.

`ACCEPTED` significa que o resultado foi validado no workspace da execução. Não significa entrega ao checkout consumidor, deploy ou arquivamento do OpenSpec. A demo mantém as tasks de entrega sem marcar e o arquivamento bloqueado. O aprendizado permanece `PROPOSED`; sua influência futura é demonstrada como simulação explícita, sem promoção global automática.

Para explorar a execução, ainda na raiz deste repositório:

```bash
export LGO_OPENSPEC="$PWD/node_modules/.bin/openspec"
node dist/cli.js --root ./lgo-demo/consumer status add-tipo-exame
node dist/cli.js --root ./lgo-demo/consumer graph add-tipo-exame --format mermaid
```

`status` mostra a execução mais recente da mudança: na demo, é o cenário de alto risco aguardando aprovação. Para consultar o resultado aceito, use o `run_id` do resumo final da demo com `report` ou `verify`.

O exemplo contém backend Spring Boot, API REST, frontend Angular/PrimeNG e verificadores de contrato, integração, arquitetura e segurança. A demo usa verificações Java/contrato/estrutura; os testes Spring/MockMvc/H2 e o build Angular são validações adicionais. Nenhuma verificação textual é apresentada como E2E de navegador.

## Usar em um projeto com OpenSpec

O OpenSpec continua sendo uma ferramenta separada. Inicialize-o e produza `proposal.md`, specs, design quando necessário e `tasks.md` pelos workflows oficiais. **`lgo init` só cria a configuração LGO ausente** e preserva arquivos existentes; não gera uma mudança OpenSpec nem infere o plano a partir de uma intenção.

O `npm ci` deste repositório instala OpenSpec 1.16.1 como dependência de desenvolvimento. Para usar esse executável com outro projeto:

```bash
export LGO_OPENSPEC="$PWD/node_modules/.bin/openspec"

# Substitua os caminhos e o nome da mudança pelos do seu projeto.
node dist/cli.js --root /caminho/projeto --dry-run init
node dist/cli.js --root /caminho/projeto init
node dist/cli.js --root /caminho/projeto doctor
node dist/cli.js --root /caminho/projeto inspect minha-mudanca
node dist/cli.js --root /caminho/projeto plan minha-mudanca --bindings /caminho/bindings.json
node dist/cli.js --root /caminho/projeto validate-plan minha-mudanca
node dist/cli.js --root /caminho/projeto --dry-run run minha-mudanca
node dist/cli.js --root /caminho/projeto run minha-mudanca
```

Antes de executar, configure os comandos verificadores em `.lgo/config.yaml` e os bindings que definem entradas, saídas, escopos, recursos, requisitos, perfil de agente e orçamento. Sem `--bindings`, o planner procura `.lgo/bindings/<change>.json`. O nome ou a ordem textual de uma task não determina uma dependência.

Veja a [configuração do exemplo](examples/tipo-exame/.lgo/config.yaml), os [bindings completos](examples/tipo-exame/.lgo/bindings/add-tipo-exame.json) e o [guia de adapters](docs/adapters.md). Trate verificadores, bindings e políticas como configuração confiável do operador, fora do escopo editável dos workers.

### Como testar um fluxo assistido

Nesta versão, a assistência acontece na preparação e revisão dos artefatos. Não existe comando `lgo assist` nem integração pronta que transforme esta conversa em uma sessão de execução do framework.

1. Defina a mudança com ajuda do seu agente, preservando os artefatos oficiais do OpenSpec.
2. Revise os bindings, escopos, riscos e verificadores determinísticos antes do `plan`.
3. Escolha mock para um ensaio sem credenciais ou conecte um harness real pelo adapter de processo/HTTP.
4. Execute o plano, acompanhe evidências, correções e gates; use `--stop-after N` e `resume` para testar uma pausa controlada.
5. Revise o patch concreto e autorize sua integração quando o gate solicitar. Só depois sincronize progresso e prepare o arquivamento.

No adapter de processo, o programa recebe `AgentRequest` JSON por stdin e devolve `AgentResult` JSON por stdout. No HTTP, um serviço deve implementar esse contrato. Apontar diretamente para um CLI de programação ou uma API de modelo exige uma ponte que adapte contexto, ferramentas, patches e cancelamento. Essas pontes específicas ainda precisam ser implementadas; a demo não comprova uma execução com agentes reais.

## CLI e estados de entrega

Use `node dist/cli.js` a partir da raiz deste repositório ou `lgo` após instalar o tarball. A ajuda lista os argumentos completos.

| Objetivo | Comandos |
| --- | --- |
| Preparar e inspecionar | `init`, `doctor`, `inspect <change>`, `plan <change>`, `validate-plan <change>` |
| Executar e acompanhar | `run <change>`, `status <change>`, `resume <run-id>`, `verify <run-id>`, `report <run-id>` |
| Entender o plano | `graph <change> --format mermaid\|dot\|json`, `explain <change>` |
| Corrigir o planejamento | `invalidate <run-id> <unit> --reason <texto>`, `replan <run-id> --plan <arquivo> --reason <texto>`, `cancel <run-id>` |
| Revisar e entregar | `export <run-id>`, `integrate <run-id>`, `sync-progress <change>`, `prepare-archive <change>` |
| Aprender e migrar | `learn <run-id>`, `migrate-state --from-python` |

`--root`, `--json` e `--dry-run` são opções globais. A CLI produz resultados estruturados em JSON; a exportação do grafo também oferece Mermaid e DOT. `update` e `uninstall` informam procedimentos: não atualizam nem apagam arquivos automaticamente.

| Código de saída | Significado |
| --- | --- |
| `0` | Operação concluída |
| `2` | Entrada, configuração ou ambiente inválido |
| `3` | Execução pausada, bloqueada ou aguardando aprovação; consulte a decisão JSON |
| `130` | Interrupção |

### Integração, aprovação e OpenSpec

`export` gera um pacote **JSON** com arquivos propostos e vínculo de evidência, sem aplicá-lo. `integrate` entrega o resultado ao checkout consumidor após validar autoridade e conflitos com a base. Um `approved: true` gravado pelo worker não autoriza a operação.

Para usar o mecanismo local, o operador deve provisionar uma chave HMAC com pelo menos 32 bytes, permissão `0600` e caminho fora do projeto. Configure `LGO_AUTHORITY_KEY_FILE` **no controlador** antes de solicitar a aprovação; não exponha a chave ao worker. Com essa chave já provisionada:

```bash
export LGO_AUTHORITY_KEY_FILE=/fora/projeto/operator.key
node dist/cli.js --root /caminho/projeto export run-ID > patch-review.json
node dist/cli.js --root /caminho/projeto integrate run-ID > approval-request.json
# A solicitação sem token retorna código 3; revise o JSON e o patch.

# Em terminal interativo do operador, a partir deste repositório:
node scripts/sign-approval.mjs --key "$LGO_AUTHORITY_KEY_FILE" --project /caminho/projeto --request approval-request.json --output approved.json --actor operador
node dist/cli.js --root /caminho/projeto integrate run-ID --approval approved.json
node dist/cli.js --root /caminho/projeto sync-progress minha-mudanca
node dist/cli.js --root /caminho/projeto prepare-archive minha-mudanca
```

Substitua `run-ID` pelo ID real. O assinador faz parte do código-fonte e exige revisão e confirmação interativa. HMAC comprova posse da autoridade operadora; não comprova identidade ou presença humana diante de alguém com o mesmo acesso ao host.

`sync-progress` só marca tasks quando suas unidades estão verificadas, integradas e com hashes correspondentes no consumidor. `prepare-archive` verifica os gates adicionais e pode retornar bloqueios ou outra solicitação de aprovação, específica para `archive`; o token de integração não serve para essa ação. O comando **não sincroniza specs consolidadas nem arquiva** a mudança. Essas operações continuam nos workflows oficiais do OpenSpec, após a conclusão comprovada. Consulte [segurança](docs/security.md) e [integração OpenSpec](docs/references/openspec.md).

## Validar e distribuir

```bash
npm run typecheck
npm test
npm run format:check
npm run eval
```

As evidências da entrega TypeScript registram **111 testes automatizados, 8 evals, 5 testes Spring e build Angular**, além do smoke test do pacote sem Python. Consulte o [relatório e seus logs](docs/typescript-migration.md), a [matriz de aceite](docs/acceptance.md) e a [cobertura dos testes](tests/README.md). Esses resultados documentam a entrega; execute os comandos para validar seu próprio ambiente.

A CI também executa os testes reais da aplicação. Para repeti-los localmente, use JDK 17 e Maven para `mvn -B test` em `examples/tipo-exame/backend`; execute `npm ci` e `npm run build` em `examples/tipo-exame/frontend`.

Para gerar e instalar o pacote operacional:

```bash
npm pack
npm install -g ./cezaraf-lgo-0.2.0.tgz
lgo --help
```

O pacote contém JavaScript compilado, declarações TypeScript, schemas e templates. Usa `node:sqlite`, `ajv` e `yaml`, sem addon nativo ou SDK proprietário. O OpenSpec deve continuar disponível separadamente, inclusive via `LGO_OPENSPEC`. A demo, a aplicação de exemplo e os scripts do operador ficam no repositório. **Não houve publicação no registry npm**; instale pelo tarball gerado.

Se você usou a versão Python 0.1, consulte a [migração e recuperação](docs/recovery.md): a migração é explícita, cria backup e passa o SQLite operacional para a versão 2. Os contratos de mensagens continuam em `1.0`; tokens antigos não autorizam o runtime TypeScript.

## Organização e documentação

| Caminho | Responsabilidade |
| --- | --- |
| `src/` | API tipada, grafo, scheduler, loops, verificação, adapters, OpenSpec, gates, aprendizado, SQLite e CLI |
| `schemas/` | 16 contratos JSON Schema 2020-12 e fixtures válidas/inválidas |
| `tests/` | Testes positivos, negativos, recuperação e compatibilidade |
| `scripts/` | Demonstração, evals, smoke test e assinador do operador |
| `templates/` | Configuração instalada em projetos consumidores |
| `examples/tipo-exame/` | CRUD Spring/Angular, mudança OpenSpec, bindings e verificadores |
| `openspec/` | Especificações do próprio LGO |
| `docs/` | Arquitetura, decisões, guias, relatórios e evidências |

[Arquitetura](docs/architecture.md) · [Máquina de estados](docs/state-machine.md) · [Instalação](docs/installation.md) · [Adapters](docs/adapters.md) · [Recuperação](docs/recovery.md) · [Segurança](docs/security.md) · [ADR TypeScript](docs/adr/002-typescript-runtime.md) · [Roadmap](docs/roadmap.md)

### Limites da referência

O runtime não oferece sandbox de SO/rede para código hostil. Processos, verificadores e endpoints externos exigem configuração confiável e isolamento adicional no ambiente de execução. Não há exactly-once universal para efeitos externos. Interrupções durante replanejamento/invalidação que deixem hashes divergentes exigem reconciliação; não são retomadas silenciosamente.

O histórico encadeado detecta corrupção, mas não impede que um administrador reescreva banco e cadeia. Custos e tokens são reportados pelo adapter; mocks não medem consumo de LLM. Logs da versão Python permanecem identificados como históricos. Aprovação SSO e exportação OTLP estão no roadmap.

Licença [MIT](LICENSE). Projeto independente, por composição com o [OpenSpec](https://github.com/Fission-AI/OpenSpec); o repositório original não foi modificado.
