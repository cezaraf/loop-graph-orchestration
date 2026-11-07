# Segurança, autoridade e autonomia

A referência tem um limite de confiança claro: código do controlador, políticas, bindings, verificadores e store pertencem ao operador; artefatos de produto e respostas de agentes são dados não confiáveis. O worker mock devolve patches e não recebe shell ou credenciais. Um adapter implementado em TypeScript/Node.js e carregado no mesmo processo é código confiável do operador, pois o runtime do Node não fornece isolamento para código carregado no próprio processo.

## Risco e blast radius

| Risco | Exemplo | Condição de avanço |
| --- | --- | --- |
| LOW | Teste ou mudança local reversível | Escopo restrito, oracle determinístico e orçamento disponível |
| MEDIUM | Contrato REST ou serviço compartilhado | Validar consumidores, integração e política configurada |
| HIGH | Autenticação, produção, infraestrutura crítica ou exclusão de dados | Interromper antes do efeito; exigir autoridade externa verificável |

A classificação deve considerar recursos afetados e reversibilidade. Confiança verbal do LLM não reduz risco. Uma unidade LOW que tenta escrever política é violação, não promoção automática de risco. O caminho de referência bloqueia ações de alto risco; simular a necessidade de autorização não concede permissão real.

## Controles e limites

| Ameaça | Controle de referência | Limite operacional |
| --- | --- | --- |
| Prompt injection em spec/contexto | Tratar conteúdo como dados; worker não altera plano, política, verificadores ou estado operacional | Um harness externo com shell precisa sandbox real; instruções em prompt não bastam |
| Escrita fora de escopo | Normalização de caminhos, rejeição de traversal/absolutos/symlinks e validação de patch | Verificadores confiáveis ainda são processos locais com privilégios do operador |
| Leitura de segredos | Contexto explícito e minimizado, exclusão de arquivos sensíveis nos snapshots | Não configurar adapter com acesso geral ao host ou credenciais de produção |
| Exfiltração | Mock sem rede; adapter deve receber somente contexto autorizado | HTTP/CLI externos precisam egress controlado pelo SO ou serviço de execução |
| Falsificação de sucesso | Verificador externo ao worker, hash da saída e evidência persistida | Testes incompletos continuam incompletos; outro LLM é evidência complementar |
| Bypass dos testes | Worker não escolhe verifier e não pode editar seu comando confiável | Verificadores precisam de base confiável e escopo proibido a workers |
| Sobrescrita concorrente | Escopo/recursos validados e merge por comparação com base | Modificação fora do controlador pode causar conflito e bloquear integração |
| Aprovação forjada | `approved: true` no repositório não é autoridade; gate exige mecanismo externo ou mantém bloqueio | Assinaturas só são confiáveis com chave protegida fora do worker e vínculo ao conteúdo |
| Corrupção de histórico | SQLite e vínculos de evidência permitem detectar inconsistência relevante | Mesmo usuário do SO pode editar SQLite/arquivos; não é log inviolável ou WORM |
| Aprendizado contaminado | Candidato exige execução validada, evidência, aplicabilidade e promoção controlada | Não promover heurística local para requisito de produto ou regra global sem avaliação |

As políticas integradas permanecem ativas; uma configuração crítica inválida ou comando fora da allowlist bloqueia. Um ambiente indisponível produz BLOCKED, nunca PASS. Exit code zero do agente não substitui verificações. Erros de política não são corrigidos repetindo o mesmo comando.

## Autoridade humana

A pessoa responsável aprova a operação concreta e o conteúdo específico, não uma permissão aberta ao worker. Uma integração de aprovação deve vincular `run_id`, hash do grafo, hash do conteúdo integrado, ação, escopo e validade. Identidade/chave é administrada fora do workspace e não fica nos prompts. Em instalação somente local, o operador com acesso ao host é parte da base confiável; isso não prova identidade humana perante um atacante com o mesmo acesso.

Não coloque segredo de assinatura em `.lgo/`, variável repassada ao agente ou arquivo visível no sandbox. Sem mecanismo de autoridade confiável, mantenha HUMAN_APPROVAL_REQUIRED. A referência não faz deploy, push, merge remoto ou operação destrutiva.

## Preparação para agentes reais

Execute o harness em usuário/container distinto, filesystem mínimo, rede negada por padrão, sem socket Docker, sem mounts de credenciais e sem acesso ao store. Exponha ferramentas mínimas via broker que valide cada ação. Não herde todo `process.env`. Restrinja executáveis e argumentos do verifier; `shell:false` remove interpretação de shell, mas não transforma um programa arbitrário em seguro. Um comando de build pode executar scripts do projeto: execute esse build em sandbox confiável para código não confiável.

Essas são condições de adoção, não capacidades de kernel implementadas pelo LGO. Consulte o relatório para o que foi testado na entrega.
