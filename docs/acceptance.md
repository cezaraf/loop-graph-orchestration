# Matriz de aceite — TypeScript0.2

PASS indica evidência executada no ambiente de referência. Não estende garantias a harnesses/produtores hostis, plataformas ou infraestrutura não testados. Limitações estão no [relatório da migração](typescript-migration.md). Não houve aprovação humana real ou archive.

| Critério | Estado | Evidência |
| --- | --- | --- |
| CA-01 consumir OpenSpec real | PASS | `openspec.test.ts`: CLI1.16.1 real |
| CA-02 tasks e requisitos rastreáveis | PASS | `engine.test.ts`: traceability, coverage; demo com IDs oficiais |
| CA-03 dependências verificadas | PASS | produtores, edges derivadas/justificadas, ciclos e referências ausentes |
| CA-04 paralelismo real | PASS |3 workers sobrepostos e consumidor aguardando todos |
| CA-05 verificadores externos | PASS | comandos com exit code, schema e Java executável fora do mock |
| CA-06 correção localizada | PASS | backend2 tentativas, unidades independentes1 |
| CA-07 preservar resultados válidos | PASS | pause/resume, SIGKILL e checkpoint Python migrado |
| CA-08 invalidar consumidores | PASS | rollback CAS e invalidação transitiva; independente preservado |
| CA-09 limites/no-progress | PASS | parada por máximo3 e ausência de progresso |
| CA-10 gates de risco/autoridade | PASS | `security.test.ts`; escopo limitado à fronteira de confiança documentada |
| CA-11 retomar interrupção | PASS | subprocesso real morto, lease reclaim e PASSED preservado |
| CA-12 mock sem credenciais | PASS | demo, evals e suíte |
| CA-13 independência de harness | PASS | runtime depende só de Ajv/yaml; processo/HTTP sem SDK proprietário |
| CA-14 aprendizado verificável | PASS | candidato, baseline/trial, assinatura, versões e revogação |
| CA-15 preservar OpenSpec | PASS | tarefas localizadas oficialmente, sync idempotente e hash estável |
| CA-16 progresso/archive com gates | PASS | CLI bloqueia task não entregue e archive sem qualidade/autoridade |
| CA-17 demo completa do núcleo | PASS | `scripts/demo.mjs` com falha/correção/integração/retomada |
| CA-18 testes executados | PASS |111 TypeScript,8 evals,5 Spring, build Angular |
| CA-19 instalação/extensão | PASS | tarball npm isolado sem Python, tipos públicos, guias e templates |
| CA-20 reprodução por script | PASS | demo executada repetidamente em diretórios novos; instalação npm documentada |

A revisão independente por outro engenheiro em outra máquina não foi realizada. CA-20 prova procedimento executável repetido, sem certificação externa. A migração0.2 está implementada; as capacidades de produção pendentes da visão maior de Autonomous Engineering não se tornam concluídas pela troca de linguagem.
