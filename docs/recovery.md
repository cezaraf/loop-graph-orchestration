# Recuperação e migração de estado

Checkpoints são registros SQLite e journals de merge; logs/checkboxes não reconstruem conclusão. Preserve banco, workspace, grafo e evidências juntos. Um lease SQLite com PID/nonce impede dois controladores. Após encerramento forçado, PID morto permite retomar; PID vivo/reutilizado bloqueia conservadoramente.

```bash
lgo --root /projeto status minha-mudanca
lgo --root /projeto resume run-ID
lgo --root /projeto verify run-ID
```

Unidades PASSED mantêm suas tentativas quando plano, política, specs e hashes continuam válidos. Mock interrompido pode produzir novamente patches puros dentro do orçamento. Efeito externo não idempotente ambíguo bloqueia e exige reconciliação do provedor. Um adapter HTTP recebe AbortSignal, mas cancelamento da requisição não prova cancelamento do efeito remoto.

## Migrar Python0.1

1. Pare o controlador Python e preserve código/configuração.
2. Instale LGO0.2 e rode `migrate-state --from-python --dry-run`.
3. Corrija divergências sem editar hashes/evidências para fingir conclusão.
4. Rode `migrate-state --from-python`. Um backup consistente precede mudanças de dados.
5. Retome o mesmo run. Unidades aprovadas são preservadas, e integração/gates são revalidados.

O migrador testa cadeia original com seus bytes exatos e valida hashes de fonte/saída. A fixture em `tests/fixtures/python-0.1-state.json` foi capturada executando o runtime Python real; a suíte atual não executa Python. Quando o arquivo fcntl antigo existe, o utilitário POSIX `flock` deve estar disponível. Falta do helper ou lock em uso bloqueia. Ele não é necessário em projetos novos.

A migração conserva o caminho do workspace; mudança de máquina/diretório exige reconciliação explícita. Não há relocação silenciosa. Bancos de versão desconhecida são rejeitados. Aprovações antigas não são reutilizadas porque o domínio de autoridade mudou.

Para rollback, pare todos os controladores, mantenha cópia do estado0.2 e restaure o backup inteiro em instalação Python0.1 com os mesmos caminhos e fontes. Não combine um banco restaurado com WAL/SHM de outra execução. Não abra o mesmo banco simultaneamente com os dois runtimes.

## Replanejar ou invalidar

Use `invalidate RUN UNIT --reason TEXT` para contrato/entrada alterada; consumidores transitivos são invalidados e os patches correspondentes sofrem rollback com CAS. Use `replan RUN --plan FILE --reason TEXT` para alterar divisão de trabalho ou estratégia. Unidades idênticas independentes são preservadas; alteração de spec/policy/verifier invalida conservadoramente todos os resultados relevantes.

Pare workers antes dessas operações. Journals de integração de unidade são recuperáveis; uma interrupção durante replan/invalidation pode exigir reconciliação manual. Divergências bloqueiam em vez de sobrescrever arquivos. Backup de SQLite deve ser consistente; o migrador usa a API de backup nativa.
