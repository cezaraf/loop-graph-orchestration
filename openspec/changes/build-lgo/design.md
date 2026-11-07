## Context

O runtime deve preservar a fronteira entre comportamento de produto e execução operacional. Artefatos OpenSpec são entrada versionável; estado mutável fica em `.lgo/`. O ambiente local dispõe de Python, Node e git, sem garantia de credenciais de agentes ou toolchains da aplicação exemplo.

## Goals / Non-Goals

**Goals:** execução local verificável; DAG com justificativa; pelo menos três unidades paralelas; correção localizada; recuperação; gates fechados; interoperabilidade por JSON; demonstração offline com mock.

**Non-Goals:** clonar OpenSpec; inferir testes completos de qualquer linguagem natural; criar isolamento de kernel em Python; fornecer exactly-once universal; executar deploy ou merge remoto; alegar conformidade ACP/MCP sem adapter testado.

## Decisions

1. Python + asyncio + SQLite: distribuição simples, concorrência de I/O e persistência sem serviço externo. Comparação com TypeScript/Java/Go em `docs/adr/001-runtime.md`.
2. CLI oficial OpenSpec: `show --json`, `status --json` e `validate` quando suportados pela versão instalada. Tasks são obtidas por `instructions apply --json`; leitura localizada de linhas serve apenas à sincronização controlada de checkboxes.
3. Bindings explícitos: inputs/outputs, recursos e verificadores fundamentam edges. Uma task não vira dependência apenas por sua posição.
4. Patches como saída: mock e adapters propõem alterações em snapshots. Controlador aplica escopo e executa verificadores confiáveis.
5. Merge por base/hash: alteração concorrente nunca é sobrescrita silenciosamente.
6. Estados persistidos: unidades aprovadas sobrevivem à retomada se seus inputs e hashes continuam válidos; mudança compartilhada invalida consumidores.
7. Autoridade externa: alto risco bloqueia antes do efeito. Campo de aprovação do worker não constitui autorização.
8. Aprendizado proposto: evidência validada gera constraint operacional; requisitos de produto só mudam via OpenSpec.

## Risks / Trade-offs

- Testes estáticos do exemplo não substituem build Java/Angular ou teste HTTP real → relatar cada comando e bloqueio sem converter para PASS.
- Adaptador no processo é código confiável → documentar sandbox externo para agentes reais.
- Arquivo e SQLite não formam transação distribuída universal → restringir efeitos e reconciliar interrupções, bloquear efeito externo incerto.
- CLI OpenSpec evolui → fixar versão suportada, rejeitar incompatibilidade e testar saída pública.
- Learning pode generalizar indevidamente → exigir aplicabilidade, regressão e autoridade para promoção.

## Migration Plan

Pacote independente; `lgo init` acrescenta configuração sem substituir arquivos existentes. Adoção começa com uma unidade e amplia para graph/persistência. Não há migração de um runtime anterior nesta primeira versão. Contratos futuros usam versionamento explícito e mudanças incompatíveis exigem migração.

## Open Questions

Quais sandboxes e provedores de autoridade serão usados pela organização em produção? Quais adapters reais terão prioridade? Esses pontos não impedem uma referência local testável e permanecem extensões, sem aprovação implícita de operação sensível.
