# Relatório — migração para TypeScript0.2

O núcleo, a CLI, os testes e os scripts de operação foram migrados para TypeScript/Node.js. Não permanecem arquivos `.py`, pyproject ou dependência Python na instalação. A implementação de aplicação continua Java/Spring + Angular/PrimeNG. Os contratos JSON Schema permanecem1.0 e o store operacional SQLite passa a2.

## Validação executada

| Verificação | Resultado | Evidência |
| --- | --- | --- |
| Compilação TypeScript strict | PASS | `npm run build` |
| Tipos do runtime e da suíte | PASS | `npm run typecheck` |
| Suíte Node/TypeScript | PASS —111 testes, sem skips | [log](evidence/typescript-tests.log), [JUnit](evidence/typescript-tests.xml) |
|16 contratos e fixtures positivas/negativas | PASS | `tests/contracts.test.ts` |
| CLI oficial OpenSpec1.16.1, schemas e deltas | PASS | `tests/openspec.test.ts`, `tests/cli.test.ts` |
| Migração de checkpoint Python real | PASS — backup e PASSED preservado | `tests/migration.test.ts`, fixture capturada do0.1 |
| Recuperação após SIGKILL e lease morto | PASS | `tests/engine.test.ts` |
| Processo/HTTP reais de fixture e cancelamento | PASS | `tests/adapters.test.ts` |
| Demo OpenSpec + Java policy + workers paralelos | PASS | [relatório JSON](evidence/typescript-demo.json) |
| Evals determinísticos | PASS —8 casos | [evals](evidence/typescript-evals.json) |
| Pacote npm em instalação isolada, só produção | PASS — loop corrigido em2 tentativas, PATH só com Node | [smoke](evidence/typescript-package-smoke.json), [pack](evidence/typescript-pack.log) |
| npm audit produção | PASS —0 vulnerabilidades retornadas | [audit](evidence/typescript-audit.json) |
| Exemplo integrado: Spring/H2/MockMvc | PASS —5 testes | [Maven](evidence/typescript-spring-tests.log) |
| Exemplo integrado: Angular/PrimeNG | PASS — build | [Angular](evidence/typescript-angular-build.log) |

O pacote foi gerado com `npm pack`, sem publicação no registry. O smoke instala o tarball com `--omit=dev --ignore-scripts` em diretório temporário, retira Python do PATH e executa um loop com falha/correção pelo artefato instalado. Não usa o compilador ou o devDependency OpenSpec desse pacote.

Os cenários da referência0.1 foram portados, incluindo testes negativos, escopo/budget, autoridades falsas, persistência, correção, produtores/consumidores, conflitos, invalidação e replanejamento. A quantidade111 inclui fixtures positivas/negativas separadas e novos cenários de migração/distribuição; não é uma medição de qualidade por contagem.

## Execução demonstrativa medida

Run `run-fde4368eaff74be7`: ACCEPTED **no workspace da execução**. Pico3 workers; backend2 tentativas, contrato/frontend/segurança/integração1 cada. A falha externa executou Java, observou HTTP200 indevido e exigiu404. Contrato e frontend já aprovados permaneceram com1 tentativa. O store foi fechado/reaberto e as tentativas aprovadas foram preservadas.

Janela de workers2,297s; tempo até último evento3,631s; soma de trabalho de workers3,141s. Esses números são desta execução e não são benchmark contra Python. Caminho crítico calculado: backend → security → integration. Custos/tokens0 são fixtures mock, sem uso de LLM real ou estimativa de economia.

Uma execução separada HIGH retornou HUMAN_APPROVAL_REQUIRED antes do worker. Archive e entrega ao consumidor ficaram bloqueados sem autoridade. O aprendizado ficou PROPOSED; o plano futuro no relatório é um what-if, não promoção automática. Promoção/trial/revogação são exercitados com chaves exclusivamente de teste.

## Compatibilidade de estado

A fixture foi produzida pelo runtime Python0.1 real do commit949ce3b. Os testes atuais montam um banco legado com os bytes originais dos eventos e remapeiam somente o diretório do workspace. O migrador valida a cadeia, fonte/política/plano e saídas aprovadas; cria backup nativo consistente; preserva a unidade PASSED e retoma apenas a pendente. Não chama Python.

Migração implícita, versão desconhecida, histórico/saída adulterados ou política alterada são recusados antes da alteração do banco. O lock legado é respeitado via POSIX flock quando existe. Aprovações antigas não servem para execução, entrega, archive ou aprendizado no domínio TypeScript. Não há migração silenciosa de paths ou confiança em campo `approved:true`.

## Limites que permanecem

A mudança de linguagem não implementa sandbox de SO/rede, SSO/presença humana, wrappers específicos de harness, ACP/MCP, OTLP ou execução distribuída. Processos/verificadores e endpoints HTTP são integrações confiáveis do operador. O egress e a contenção de código hostil exigem infraestrutura externa. Efeito remoto não idempotente ambíguo bloqueia; cancelamento HTTP não prova cancelamento do efeito do provedor.

Recuperação de worker/checkpoint/merge é testada. Interrupções durante replan/invalidation ainda podem exigir reconciliação, em modo fechado. Regras aprendidas não alteram requisitos de produto. A compatibilidade validada é Linux/POSIX com Node24.22.1; outros majors/plataformas não são presumidos testados.

O workflow atualizado executa a suíte TypeScript, demo, evals, pacote e aplicação Java/Angular. Os resultados locais acima não representam, por si só, CI remoto aprovado; o estado do PR deve ser consultado no GitHub.
