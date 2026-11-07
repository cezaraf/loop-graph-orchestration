# Máquina de estados e condições de conclusão

As transições de unidade são guardadas por `StateStore.transition`. O grafo de dependências permanece um DAG; o loop usa transições de estado, sem acrescentar edges de dependência de volta ao próprio nó.

| Estado | Próximos estados permitidos |
| --- | --- |
| PENDING | READY, BLOCKED, WAITING_APPROVAL, CANCELLED |
| READY | RUNNING, BLOCKED, WAITING_APPROVAL, CANCELLED |
| RUNNING | VERIFYING, RETRYING, FAILED, BLOCKED, CANCELLED |
| VERIFYING | PASSED, RETRYING, FAILED, BLOCKED, CANCELLED |
| RETRYING | RUNNING, FAILED, BLOCKED, CANCELLED |
| PASSED | INVALIDATED, BLOCKED |
| FAILED | INVALIDATED |
| BLOCKED | INVALIDATED, CANCELLED |
| INVALIDATED | READY, BLOCKED, CANCELLED |
| WAITING_APPROVAL | READY, CANCELLED, INVALIDATED |
| CANCELLED | INVALIDATED |

Antes de READY, as dependências devem estar PASSED. RUNNING identifica tentativa persistida; VERIFYING ainda não significa aceite. PASSED só vem após oracle externo e integração local por comparação de base. Uma reprovação produz feedback e só passa a RETRYING quando a classe admite correção/retry e existe orçamento, tentativa e progresso. Violação de política e ambiente não provocam repetição cega.

## Estado global

| Estado global | Significado operacional |
| --- | --- |
| PENDING | Execução criada e persistida, ainda não agendada |
| RUNNING | Scheduler possui controle da execução |
| PAUSED | Execução interrompida ou parada no checkpoint; há trabalho retomável |
| WAITING_APPROVAL | Pelo menos uma unidade aguarda autoridade legítima |
| BLOCKED | Falha de ambiente, política ou dependência impede avanço |
| FAILED | Qualidade/integração rejeitada após execução das unidades |
| ACCEPTED | Unidades verificadas/integradas e integração global aprovada localmente |
| CANCELLED | Operador cancelou trabalho pendente |

O engine deriva o estado global das unidades e do gate de integração. O mapa de transições estritamente guardado é o das unidades; o estado global é atualizado pelo controlador. ACCEPTED não significa entregue ao checkout consumidor, integrado em branch remota, publicado ou arquivado no OpenSpec.

## Checkpoints e invariantes

- Persistir início da tentativa antes da chamada ao adapter.
- Persistir evidência da tentativa antes de aceitar o resultado.
- Não usar checkbox ou texto do agente para fabricar PASSED.
- Não marcar uma task aceita se qualquer unidade vinculada falhou ou não foi integrada.
- Verificar fingerprints de specs, política e verificadores antes de retomar.
- Preservar unidades PASSED cujas premissas continuam válidas.
- Invalidar transitivamente consumidores quando uma unidade/contrato muda.
- Fazer preflight antes de rollback; nunca reverter trabalho enquanto unidade afetada está ativa.
- Registrar replanejamento com motivo e novo hash do grafo.
- Não repetir efeito externo incerto de adapter não idempotente sem reconciliação.

A transação SQLite vincula alteração de estado ao evento de transição. Journals de merge tornam patches locais recuperáveis entre preparação e commit. Isso não cria transação atômica com serviços externos. Os testes de recuperação e de efeitos não idempotentes delimitam a garantia efetivamente exercitada.

## Classificação de falhas

| Classe | Resposta esperada |
| --- | --- |
| TEST_FAILURE | Corrigir implementação com evidência e escopo preservados |
| TRANSIENT_FAILURE | Repetição limitada do transporte, sem mudar critérios de aceite |
| ENVIRONMENT_FAILURE | Bloquear e diagnosticar ferramenta/configuração indisponível |
| POLICY_VIOLATION | Bloquear e exigir ação do operador; não flexibilizar política |
| PLANNING_FAILURE | Replanejar divisão/dependências explicitamente |
| SPECIFICATION_FAILURE | Revisar comportamento no workflow OpenSpec |

As duas últimas classes existem no contrato de correção para escalonamento; o runtime local não oferece diagnóstico generativo automático que distinga toda falha de especificação de planejamento. Essa decisão precisa de contexto/evidência do operador.
