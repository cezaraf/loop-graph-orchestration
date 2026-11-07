# Pesquisa e decisões

Consulta: 2026-11-06. Fontes primárias públicas; conteúdo pago/restrito não foi acessado. As URLs abaixo são referências de projeto e podem evoluir. A compatibilidade executada com a versão instalada do OpenSpec é registrada em [openspec.md](openspec.md).

| Fonte | Observação verificada | Consequência no LGO |
| --- | --- | --- |
| [OpenSpec — Quickstart](https://openspec.dev/docs/quickstart) | O workflow separa exploração, planejamento, implementação e archive. | Compor o apply, preservar o restante do ciclo. |
| [OpenSpec — spec-driven](https://openspec.dev/docs/schemas/spec-driven) | Proposal, deltas por capability, design e tasks têm papéis diferentes. | Manter artefatos nativos; metadados operacionais ficam em `.lgo/`. |
| [OpenSpec — Profiles](https://openspec.dev/docs/profiles) | Core contém explore, propose, apply, update, sync e archive; seleção de workflows pertence ao perfil. | Não supor que workflows opcionais estão instalados. |
| [OpenSpec — Skills](https://openspec.dev/docs/skills) | Skills são ações orientadas ao agente; não são todas subcomandos equivalentes. | Documentar CLI separada das ações do agente. |
| [OpenSpec — CLI](https://openspec.dev/docs/cli) | Há show estruturado, validate, status, instructions e archive. `update` da CLI atualiza instruções instaladas. | Usar interfaces públicas e evitar inventar `openspec sync`. |
| [OpenSpec — Configuration](https://openspec.dev/docs/configuration) | Configuração do projeto, metadados da mudança e configuração global têm locais e propósitos distintos. | LGO não sobrescreve configurações globais ou do projeto. |
| [Hanako — Five layers](https://agent-layers.vercel.app/) e [perfil público](https://x.com/hanakoxbt) | A página pública descreve loop como feedback verificável e graph como coordenação de trabalho. O curso completo exige acesso. | Detalhes de correction/learning/blast-radius usados aqui vêm dos mecanismos fornecidos na missão, não de alegado acesso ao curso. |
| [LangGraph — overview](https://docs.langchain.com/oss/python/langgraph/overview) | Orquestração orientada a estado oferece persistência e interrupção. | Padrões considerados; biblioteca não é obrigatória. |
| [LangGraph — persistence](https://docs.langchain.com/oss/python/langgraph/persistence) | Checkpointers preservam estado por thread; stores guardam informação entre threads. | Separar checkpoints de aprendizado entre execuções. |
| [LangGraph — interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts) | Um interrupt pausa e permite entrada externa com retomada. | Aprovação é interrupção de controle, sem edge cíclica no DAG. |
| [LangGraph — Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api) | Estado, nós, edges e reducers compõem grafos. | Atualização concorrente precisa regra determinística; merge usa hashes/conflitos explícitos. |
| [Temporal — workflow execution](https://docs.temporal.io/workflow-execution) e [event history](https://docs.temporal.io/workflow-execution/event) | Histórico persistido participa da recuperação de workflows. | Estado durável é mais do que console log; a referência não alega replay Temporal. |
| [Temporal — Activities](https://docs.temporal.io/activity-definition) | Activities devem ser idempotentes, pois falha antes de registrar resultado pode levar a reexecução. | Não prometer exactly-once para efeitos externos; exigir idempotência/reconciliação. |
| [Temporal — retry policies](https://docs.temporal.io/encyclopedia/retry-policies) | Retries transitórios têm política de repetição. | Separar retry de transporte de correção de implementação com evidências novas. |
| [JSON Schema 2020-12](https://json-schema.org/draft/2020-12) | Draft define contratos e validação estruturada. | Contratos versionados, exemplos inválidos e rejeição de campos inesperados onde crítico. |
| [OpenTelemetry — signals](https://opentelemetry.io/docs/concepts/signals/) | Traces, métricas e logs são sinais distintos. | Eventos correlacionáveis agora; exportação OTLP somente quando implementada/testada. |
| [MCP — specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) | JSON-RPC conecta aplicações a ferramentas e contexto. | Integração opcional de ferramentas; não é um executor completo por si só. |
| [MCP — security](https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices) | Escopos, SSRF, sessão e autorização exigem controles próprios. | Servidores MCP ampliam superfície; segredo/rede precisam restrições externas. |
| [ACP — introduction](https://agentclientprotocol.com/get-started/introduction) e [security v1](https://agentclientprotocol.com/protocol/v1/security) | Protocolo conecta cliente e agente, com sessões, chamadas de ferramentas e permissões. Site distingue v1 de v2 draft. | Adapter ACP exige negociação de capacidades; nenhuma compatibilidade é alegada sem teste. |

## Inferências e limites

Escolher asyncio e SQLite é decisão deste projeto, não recomendação atribuída às fontes. Checkpoints locais, patches isolados e locks por recurso são suficientes para demonstrar um controlador; não substituem contenção de sistema operacional nem consenso entre hosts. A especificação define comportamento; bindings revisados transformam esse comportamento em verificação executável. Não existe derivação automática confiável de qualquer Markdown para testes completos. Critérios sem oracle devem bloquear planejamento/aceite ou exigir decisão humana explícita.

Pesquisa não equivale a integração implementada. LangGraph, Temporal, MCP, ACP, Claude Code, Codex e OpenCode foram avaliados como pontos de extensão. O relatório de execução distingue adapters funcionais de possibilidades documentadas.
