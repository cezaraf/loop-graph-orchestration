> Decisão histórica da versão0.1. A implementação foi substituída pelo [ADR002](002-typescript-runtime.md).

# ADR 001 — Runtime local em Python, composição com OpenSpec

Status: aceito para a implementação de referência. Data: 2026-11-06.

## Problema

Precisamos executar processos e verificadores, coordenar unidades paralelas e recuperar estado sem exigir cluster, serviço de filas, licença de harness ou banco externo. A linguagem do runtime não deve impor a linguagem da aplicação desenvolvida.

## Alternativas

| Opção | Vantagens | Custos para esta referência |
| --- | --- | --- |
| Python | asyncio, subprocess, SQLite e testes acessíveis; ecossistema de contratos e adapters | Distribuição exige Python/venv; CPU intensiva precisa processos externos |
| TypeScript | Proximidade com CLI OpenSpec e ecossistema de agentes; tipos e distribuição npm | Persistência SQLite adiciona escolha de binding; tipagem não substitui validação de entrada |
| Java | Concorrência, robustez de tipos e experiência empresarial | Empacotamento/runtime mais pesados para ferramenta local e iteração inicial |
| Go | Binário distribuível, goroutines e processos simples | Mais implementação manual para contratos/integrações; menor vantagem no protótipo local |

## Decisão

Python 3.11+ executa o núcleo; asyncio coordena espera de adapters/processos; SQLite persiste estado. `jsonschema` valida contratos JSON Schema 2020-12 e `PyYAML` lê configuração/metadados. A biblioteca padrão cobre CLI, hashing, processos e filesystem. Dependências e faixa real de Python são fixadas em `pyproject.toml`; testes são a autoridade de compatibilidade.

OpenSpec permanece executável separado, com versão suportada verificada pelo adapter. O LGO compõe interfaces públicas em vez de importar módulos internos, alterar schema nativo ou fazer fork. A implementação aceita bindings explícitos para transformar tasks em grafo; não depende de LLM para deduzir um plano silenciosamente.

LangGraph foi avaliado por checkpointing, interrupts e composição de estado. Temporal foi avaliado por histórico durável, replay e política de retries. Nenhum é dependência obrigatória: a escala local não justifica novo runtime/servidor. Adapters de store/orquestração distribuída podem ser introduzidos quando houver múltiplos controladores, workflows longos ou operação em vários hosts.

JSON Schema fornece contrato interoperável, sem SDK de fornecedor. OpenTelemetry é uma integração de exportação futura/opcional; JSON estruturado e persistência local permitem começar sem collector. MCP dá acesso a ferramentas, ACP conecta clientes a agentes; não substituem o scheduler nem a autoridade. APIs OpenAI-compatible acessam modelos, mas precisam de tool runtime adicional para atuar como harness.

## Consequências

Instalação local pequena e testável com mocks, sem infraestrutura distribuída. A referência não oferece isolamento de kernel, replay determinístico equivalente ao Temporal, nem exactly-once de ações externas. Produção com agentes arbitrários exige sandbox e autoridade fora do usuário/processo do worker. A limitação é explícita para evitar confundir contratos e patches com contenção de código hostil.
