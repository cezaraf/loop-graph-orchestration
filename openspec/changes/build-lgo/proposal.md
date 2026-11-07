## Why

Agentes de programação conseguem produzir alterações, mas trabalho amplo exige coordenação, verificação e retomada. Uma checklist não representa dependências, isolamento, autoridade nem evidência. O projeto precisa de um runtime reutilizável que aproveite as especificações do OpenSpec e reduza intervenções sem enfraquecer gates.

## What Changes

- Acrescentar adapter OpenSpec que consome artefatos reais e preserva suas convenções.
- Definir contratos JSON versionados e bindings explícitos de tasks/requisitos para unidades.
- Implementar DAG validado, scheduler concorrente e snapshots isolados.
- Implementar loops de produção, verificação externa e correção localizada com orçamento.
- Persistir checkpoints, tentativas, evidências e eventos para recuperação.
- Integrar patches com detecção de conflito e gates de qualidade/risco.
- Preparar progresso/archive somente com conclusão comprovada.
- Produzir candidatos a aprendizado controlado e exemplo TipoExame reproduzível.

## Capabilities

### New Capabilities
- `agent-orchestration`: planejar, executar, verificar, integrar e recuperar unidades rastreáveis a mudanças OpenSpec, sob políticas explícitas.

### Modified Capabilities

Nenhuma capacidade consolidada é alterada nesta criação inicial.

## Impact

Novo pacote Python com CLI local, schemas, templates, testes e documentação. OpenSpec continua dependência externa composta pela CLI. Não há obrigação de harness, fornecedor de modelo, banco externo, cluster ou runtime distribuído. O exemplo contém backend Java/Spring e frontend Angular/PrimeNG; builds reais dependem dos toolchains e acesso a seus artefatos.
