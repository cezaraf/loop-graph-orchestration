# Matriz de conclusão e evidências

PASS significa que o mecanismo indicado foi executado no ambiente de referência. Não estende a prova a harnesses não testados ou isolamento de produção. Funcionalidades adicionais ainda ausentes estão identificadas no [relatório](report.md). Não houve aprovação humana real ou archive executado.

| Critério | Estado | Evidência verificável |
| --- | --- | --- |
| CA-01 — consumir OpenSpec real | PASS | `tests/test_openspec.py`; CLI1.16.1 validate/show/status/instructions |
| CA-02 — tasks e requisitos rastreáveis | PASS | `test_plan_uses_source_traceability_and_not_task_order`; grafo demo contém IDs reais |
| CA-03 — verificar dependências | PASS | testes de ciclos, referência ausente, artefato sem edge, conflitos e edge derivada |
| CA-04 — paralelismo real | PASS | `test_real_parallel_dispatch_dependency_and_resource_lock`; eventos e pico3 na demo |
| CA-05 — verificadores externos por worker | PASS | `VerificationEngine`; Java executado fora do mock; testes de código de saída e schema |
| CA-06 — correção localizada | PASS | `test_correction_local_preserves_other_units_and_feedback`; backend2, demais1 |
| CA-07 — preservar resultados válidos | PASS | testes de pause/resume, SIGKILL e correção; hashes das unidades aprovadas |
| CA-08 — invalidar dependentes | PASS | `test_pause_resume_invalidates_only_transitive_consumers`; rollback e preservação independente |
| CA-09 — limite de tentativas | PASS | `test_attempt_limit_and_no_progress_differ`; máximo3 e parada por ausência de progresso |
| CA-10 — gates de risco/autoridade | PASS | testes adversariais de HIGH, chave externa, tokens falsos e políticas; restrito à fronteira declarada |
| CA-11 — retomar interrupção | PASS | `test_real_process_kill_and_resume_preserves_approved_unit`; não implica recuperação de todas as operações de controle |
| CA-12 — agente mock | PASS | demo e suíte sem credenciais |
| CA-13 — núcleo independente de harness proprietário | PASS | dependências apenas jsonschema/PyYAML; testes processo/HTTP e inspeção pyproject |
| CA-14 — aprendizado proposto e verificável | PASS | demo PROPOSED; teste de trial, promoção de fixture, aplicação futura e revogação |
| CA-15 — preservar artefatos OpenSpec | PASS | teste de sync idempotente, hash estável, origem/linhas oficiais e rejeição de alterações inesperadas |
| CA-16 — gates para progresso/sync/archive | PASS | CLI só marca outputs entregues; teste bloqueia archive; preparação sem executar operações oficiais |
| CA-17 — demo de falha/correção/integração/retomada | PASS | `scripts/demo.py`, relatório JSON, evidências Java e integração final |
| CA-18 — testes relevantes executados | PASS | 80 testes Python, 8 evals, 5 testes Spring, build Angular; arquivos em `docs/evidence` |
| CA-19 — instalar e estender | PASS | pyproject/CLI, guia adapters, templates, wheel e smoke de instalação isolada |
| CA-20 — reprodução por script | PASS | demo executada repetidamente com diretórios novos; comandos completos no README, sem credenciais |

A revisão manual por outro engenheiro em outra máquina ainda não foi realizada. CA-20 comprova procedimento reproduzível executado, não uma certificação externa. A versão0.1 é uma implementação funcional do núcleo; as ausências do relatório impedem tratá-la como a visão inteira de Autonomous Engineering já concluída.
