> Relatório histórico da versão Python0.1, preservado como evidência. Para a versão atual consulte [a migração TypeScript](typescript-migration.md). Os nomes de testes Python abaixo pertencem ao [commit949ce3b](https://github.com/cezaraf/loop-graph-orchestration/tree/949ce3bd4190145c6914f86f21b3491885249ae9).

# Relatório de execução — LGO 0.1

A implementação executou OpenSpec → plano validado → workers paralelos → correção localizada → integração → gates → candidato a aprendizado, com persistência e retomada. O resultado é uma referência local funcional. As limitações de produção estão separadas dos resultados verificados.

## Evidências executadas

| Verificação | Resultado | Evidência |
| --- | --- | --- |
| Suíte Python, integração OpenSpec real e testes negativos | PASS — 80 testes | [pytest.xml](evidence/pytest.xml) |
| Evals determinísticos de falhas/ataques | PASS — 8 casos | [evals.json](evidence/evals.json) |
| Wheel em ambiente isolado | PASS — instalação, CLI e bootstrap dry-run | [wheel-install.log](evidence/wheel-install.log) |
| OpenSpec 1.16.1, `spec-driven`, mudança do próprio LGO | PASS — validação strict | [self-spec-validation.json](references/self-spec-validation.json) |
| OpenSpec do exemplo TipoExame | PASS — CLI oficial strict, tasks e requisitos estruturados | `tests/test_openspec.py`, `tests/test_cli.py` |
| Spring Boot 3.5.16, H2 e MockMvc sobre resultado integrado | PASS — 5 testes | [merged-spring-tests.log](evidence/merged-spring-tests.log) |
| Angular 20.3.35 + PrimeNG 20.4.0 sobre resultado integrado | PASS — build real | [merged-angular-build.log](evidence/merged-angular-build.log) |
| Identidade entre fontes do grafo final e aplicação compilada | PASS — hashes de todos os outputs de aplicação iguais | [merged-source-comparison.json](evidence/merged-source-comparison.json) |
| Controle negativo Spring com HTTP 200 indevido | Reprovou corretamente: esperado 404, retornado 200 | [spring-negative-control.log](../examples/tipo-exame/evidence/spring-negative-control.log) |
| Auditoria npm das dependências de produção do exemplo | PASS — zero advisories retornados na execução | [npm-audit-production.json](../examples/tipo-exame/evidence/npm-audit-production.json) |

O controle negativo Spring foi executado em cópia isolada com Spring 3.5.7; a aplicação final e os cinco testes aprovados usam 3.5.16. Auditoria npm é um resultado pontual do registry, não prova geral de segurança. E2E no navegador e deploy não foram executados.

## Demonstração medida

Execução `run-2a4fd1ae394148be`, estado **ACCEPTED no workspace local**. [Relatório JSON](evidence/demo-report.json), [grafo](evidence/demo-graph.mmd), [eventos](evidence/runtime/events.jsonl), [manifest](evidence/runtime/execution.json) estão em `docs/evidence/`. O checkpoint SQLite e os instaladores binários permanecem no pacote ZIP original; não são versionados neste repositório.

| Unidade | Tentativas | Resultado |
| --- | ---: | --- |
| contract | 1 | PASS |
| backend | 2 | PASS após corrigir 200 para 404 |
| frontend | 1 | PASS |
| security | 1 | PASS |
| integration | 1 | PASS |

Pico medido: **3 workers ativos**. Janela dos workers: **2,486 s**; soma dos tempos de worker: **3,243 s**. Tempo entre criação e último evento da execução: **3,919 s**, incluindo retomada e revalidação. São medições desta execução, sem benchmark de speedup. O caminho crítico calculado a partir das dependências e durações de worker foi `backend → security → integration`.

Uma correção foi registrada. Contrato e frontend já tinham passado quando ocorreu a falha do backend e mantiveram uma tentativa. Quatro das cinco unidades passaram na primeira tentativa (80%). Não foi estimada economia monetária ou trabalho hipotético: custo/tokens zero são valores das fixtures mock, sem uso de LLM real.

O processo pausou depois das três primeiras unidades, fechou o store e retomou em uma nova instância. As contagens aprovadas permaneceram iguais. A suíte faz também um teste mais forte: mata um subprocesso com um worker aprovado e outro em andamento, então retoma pelo SQLite. O aprovado permanece com uma tentativa; o worker mock interrompido recebe a segunda. Efeitos externos não idempotentes ambíguos são bloqueados.

## Gates e OpenSpec

Uma segunda execução com risco HIGH bloqueou a unidade antes de chamar o worker e retornou `HUMAN_APPROVAL_REQUIRED`. Um campo `approved: true` não é aceito como autoridade. Assinaturas alteradas, expiradas ou com binding/ação errados são rejeitadas pela suíte.

A demonstração não obteve aprovação real para entrega ao consumidor, sync de specs ou archive. Os arquivos da aplicação foram gerados e integrados somente em workspace de execução. A sincronização de progresso com conjunto aceito vazio preservou as tasks abertas no consumidor vazio. `prepare_archive` ficou bloqueado por autoridade e entrega. Não houve arquivamento de mudança incompleta.

O teste de entrega usa uma chave exclusiva de fixture para provar o protocolo e o merge CAS; ele não representa aprovação humana real. O comando oficial de archive permanece com o operador, depois de todas as verificações. As proteções adicionais são do LGO, não atribuídas ao OpenSpec.

## Aprendizado

A falha verificada produziu um candidato PROPOSED vinculado ao run e à evidência. O relatório mostra a consequência no planejamento como **what-if**, sem ativar regra global. A primeira categoria executável propõe uma constraint de recurso; sua eficácia causal/generalização depende de avaliação operadora.

A suíte demonstra promoção com assinatura externa de fixture, baseline mais trial validado exercitando a constraint, aplicação no próximo plano, histórico imutável de versões e revogação. Nenhuma regra modifica os requisitos consolidados de produto. A geração automática de skills, testes ou runbooks aprendidos não está implementada.

## Limitações observadas

| Capacidade | Estado | Consequência |
| --- | --- | --- |
| Planejamento por bindings, produção/consumo e edges justificadas | PASS | Humano ou adapter de planejamento deve declarar a semântica inicial |
| Gerar bindings e oracles completos diretamente de uma intenção em linguagem natural | NOT_IMPLEMENTED | O ciclo de proposta usa OpenSpec oficial; não há planejador semântico universal |
| Mock, processo CLI e HTTP no protocolo de patches | PASS | HTTP/processo testados com servidores/processos de fixture reais, sem fornecedor |
| Wrappers específicos Claude Code/Codex/OpenCode e ACP nativo | NOT_IMPLEMENTED | Guia de extensão e contratos disponíveis |
| Sandbox de SO, rede e exfiltração para processos hostis | NOT_IMPLEMENTED | Processos e verificadores exigem confiança no host; o mock não possui tools |
| Autoridade operadora HMAC fora do projeto | PASS | Não comprova identidade/presença humana; produção exige serviço protegido |
| SSO, aprovação humana real e providers de LLM/harness reais | BLOCKED | Integrações/credenciais/ambiente externo não foram fornecidos nem utilizados |
| JSON/eventos/métricas locais | PASS | Custos são reports do adapter, não comprovação de cobrança |
| Exportador OpenTelemetry/OTLP e MCP | NOT_IMPLEMENTED | Investigados, sem SDK obrigatório |
| Recuperação de worker/checkpoint/journal de merge | PASS | Unidades aprovadas são preservadas |
| Recuperação automática de interrupção em qualquer ponto de replan/invalidation | NOT_IMPLEMENTED | Divergência bloqueia; requer reconciliação operadora |
| Execução distribuída/multi-host, migrações futuras de store e coleta automática por retenção | NOT_IMPLEMENTED | Store local e política documentada; sem infraestrutura extra |

O workflow de CI está em `.github/workflows/ci.yml`. Os resultados deste relatório são da validação local anterior à publicação no GitHub; não representam execução de CI remoto.

A referência não deve ser tratada como plataforma pronta para executar ferramentas hostis ou operar produção sem controles adicionais. Os vinte critérios de núcleo têm escopo e evidência em [acceptance.md](acceptance.md).
