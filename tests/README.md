# Cobertura exigida

Execute `pytest -q` com OpenSpec1.16.1 disponível em LGO_OPENSPEC. Sem a CLI oficial alguns testes específicos são SKIP; não converta esse resultado em PASS da integração. A entrega registrou execução sem skips.

| Requisito de teste da missão | Cobertura |
| --- | --- |
| 1/2/24 leitura, validação e schemas OpenSpec | test_openspec.py: CLI real, ADDED/MODIFIED/REMOVED/RENAMED, versão/schema desconhecidos |
| 3/4 rastreamento e grafo válido | test_engine.py: source_traceability, planner_derives_edges |
| 5 ciclos | graph_rejects_bad_edges_cycles_and_duplicates |
| 6/7 dependências e paralelismo | real_parallel_dispatch_dependency_and_resource_lock |
| 8 conflitos de escrita | missing_artifact_dependency_and_conflict_rejected; merge_journal |
| 9/10 falha e correção localizada | correction_local_preserves_other_units_and_feedback; external_oracles_fail |
| 11 tentativas | attempt_limit_and_no_progress_differ |
| 12/13 preservar e invalidar | pause_resume_invalidates_only_transitive_consumers |
| 14 replanejamento | replan_failed_node_preserves_independent_success; adversarial replan spec/policy |
| 15 recuperação | real_process_kill_and_resume_preserves_approved_unit |
| 16 efeitos não idempotentes | adversarial interrupted_nonidempotent_adapter_is_not_called_again; journal idempotente |
| 17/18 gates e aprovações falsas | test_adversarial.py, política high-risk, signed_delivery |
| 19 aprendizado validado | learning_needs_validated_runs_authority_and_regressions |
| 20/21 adapters e SDKs | test_adapters.py (processo/HTTP reais de fixture), test_cli.py core dependencies |
| 22 progresso OpenSpec | test_openspec.py sync + test_cli.py sync-progress sem delivery |
| 23 bloquear archive | test_cli_real_openspec_plan_dryrun_and_archive_block |
| 25 escopo e orçamento | test_adversarial.py: escapes, segredos, policy, budget, remaining_budget |

`test_contracts.py` valida schemas, exemplos positivos/negativos e mensagens capturadas do motor real. `scripts/eval.py` executa o corpus em `evals/cases.json`. Os testes Java do exemplo e os verificadores offline são distintos; os logs dizem qual foi executado.
