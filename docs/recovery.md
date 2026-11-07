# Recuperação de execuções

`resume` utiliza o checkpoint persistido, não reconstrói conclusão a partir de logs ou checkboxes. Preserve juntos o banco de estado, snapshots e evidências referenciadas. Execute um controlador por execução. Não mova arquivos durante uma retomada ativa.

## Procedimento

1. Consulte `lgo status <change>` e identifique o `run_id`.
2. Confira a falha/interrupção e os artefatos de evidência. Resolva ambiente ausente sem alterar specs silenciosamente.
3. Execute `lgo resume <run-id>` no mesmo projeto, com a mesma configuração e artifacts de origem.
4. Observe unidades reaproveitadas e unidades retomadas. Uma unidade aceita e ainda válida deve manter sua contagem de tentativas.
5. Execute `lgo verify <run-id>` para rever evidências/resultados conforme o contrato da CLI.

Veja `lgo --help` para a posição da opção de diretório do projeto. A demonstração automatizada documenta a chamada exata e comprova preservação de resultados.

## Decisões por situação

| Situação | Ação correta |
| --- | --- |
| Unidade nunca começou | Agendar quando dependências e recursos estiverem prontos |
| Worker interrompido antes de produzir saída | Retomar com tentativa/limite persistidos; não chamar efeito externo incerto automaticamente |
| Resultado verificado e registrado | Reaproveitar se entradas, política, plano e hash da saída continuam válidos |
| Spec ou plano mudou | Bloquear retomada incompatível; executar replanejamento explícito |
| Contrato compartilhado mudou | Invalidar consumidores transitivos e revalidar a integração |
| Destino divergiu da base | Exigir resolução de conflito; não sobrescrever |
| Aprovação aguardada | Manter espera até autoridade externa; worker não aprova |
| Efeito não idempotente ficou incerto | Consultar provedor por chave de idempotência ou escalar para reconciliação |

## Replanejamento

Uma correção mantém objetivo, escopo e verificadores e altera a implementação local. Replanejamento muda a divisão de trabalho ou suas premissas. Preserve histórico do plano anterior, registre motivo e valide novo DAG antes de agendar. Uma falha de especificação exige revisar o OpenSpec. Uma falha de ambiente exige corrigir ferramentas/acessos. Nenhuma delas é resolvida repetindo cegamente uma implementação.

## Backups e limites

Use backup consistente de SQLite, sem copiar um arquivo parcial enquanto há escrita. Mantenha o código da mesma versão ou aplique migração explícita. Não edite rows para converter FAILED em PASSED. O runtime local não oferece failover entre hosts, leases distribuídos ou replay de qualquer comando arbitrário. As garantias demonstradas são as dos testes de interrupção e retomada incluídos.
