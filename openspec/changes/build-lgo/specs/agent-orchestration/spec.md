## ADDED Requirements

### Requirement: Consumir mudanças OpenSpec
O LGO SHALL consumir artefatos nativos de uma mudança OpenSpec suportada e preservar a separação entre especificação de comportamento e estado de execução.

#### Scenario: Inspeção de uma mudança real
- **WHEN** o operador inspeciona uma mudança com proposal, tasks e deltas válidos
- **THEN** o adapter retorna modelo estruturado com requisitos, cenários, tasks, capacidades e hashes de origem
- **AND** a validação oficial da versão suportada permanece disponível

#### Scenario: Versão incompatível
- **WHEN** a versão instalada não pertence ao contrato suportado
- **THEN** a integração bloqueia com diagnóstico de incompatibilidade

### Requirement: Planejar unidades rastreáveis
O LGO SHALL converter bindings explícitos de tasks e requisitos em unidades com entradas, saídas, escopos, verificadores, risco e orçamento, registrando justificativa de cada dependência.

#### Scenario: Dependência por contrato
- **WHEN** uma unidade consome uma saída declarada de outra unidade
- **THEN** o plano registra a dependência e sua justificativa
- **AND** a posição textual da task não é usada como prova de dependência

#### Scenario: Plano inválido
- **WHEN** há ciclo, referência ausente, cobertura incompleta ou conflito de escrita sem estratégia
- **THEN** o grafo é rejeitado antes da execução

### Requirement: Executar unidades com concorrência controlada
O scheduler SHALL executar unidades prontas em paralelo dentro de limites e recursos declarados, conservando dependências e isolamento de alterações.

#### Scenario: Unidades independentes
- **WHEN** pelo menos três unidades estão prontas e seus recursos não conflitam
- **THEN** seus intervalos de execução podem sobrepor-se até o limite configurado
- **AND** cada unidade produz evidência individual

#### Scenario: Recurso exclusivo ocupado
- **WHEN** duas unidades disputam o mesmo recurso exclusivo
- **THEN** elas não executam simultaneamente nesse recurso

### Requirement: Corrigir com verificação externa
Cada worker SHALL passar por produção, verificação e correção localizada, com evidências por tentativa e limite inicial de três tentativas.

#### Scenario: Contrato HTTP incorreto
- **WHEN** o verifier detecta resposta 200 para recurso cujo cenário exige 404
- **THEN** a unidade responsável recebe feedback estruturado com esperado, observado, escopo e tentativas restantes
- **AND** unidades independentes já aprovadas permanecem preservadas

#### Scenario: Tentativas esgotadas
- **WHEN** a unidade não converge dentro do orçamento ou limite
- **THEN** ela termina bloqueada ou reprovada com evidências e próxima ação explícita
- **AND** nenhuma exceção é repetida indefinidamente

### Requirement: Integrar sem sobrescrita silenciosa
O coordenador SHALL integrar apenas saídas verificadas e detectar divergência entre base observada e destino, invalidando consumidores de saídas alteradas.

#### Scenario: Conflito após produção
- **WHEN** um arquivo de destino muda desde o snapshot usado pela unidade
- **THEN** a integração bloqueia em vez de sobrescrever a alteração concorrente

#### Scenario: Contrato compartilhado alterado
- **WHEN** uma saída compartilhada aceita é invalidada ou replanejada
- **THEN** seus consumidores transitivos são invalidados para nova verificação

### Requirement: Controlar autoridade e escopo
O runtime SHALL aplicar políticas fora do worker, rejeitar escrita indevida e impedir ações de alto risco sem autorização legítima externa.

#### Scenario: Aprovação forjada
- **WHEN** o worker retorna um campo ou arquivo declarando aprovação
- **THEN** esse conteúdo não concede autoridade ao gate

#### Scenario: Ação de alto risco
- **WHEN** uma unidade solicita operação destrutiva ou sensível sem autorização verificável
- **THEN** o gate retorna HUMAN_APPROVAL_REQUIRED ou BLOCKED antes de executar o efeito

### Requirement: Recuperar estado durável
O store SHALL persistir estados, tentativas e evidências suficientes para retomar execução interrompida sem repetir indiscriminadamente unidades aceitas.

#### Scenario: Retomada com unidade aprovada
- **WHEN** a execução é interrompida e suas entradas aprovadas permanecem válidas
- **THEN** a retomada preserva a unidade e sua contagem de tentativas

#### Scenario: Efeito externo incerto
- **WHEN** uma operação não idempotente não tem conclusão reconciliável após interrupção
- **THEN** o runtime bloqueia sua repetição automática

### Requirement: Sincronizar somente conclusão comprovada
O LGO SHALL sincronizar checkboxes a partir de unidades verificadas e integradas, bloqueando preparação de archive quando gates adicionais não forem atendidos.

#### Scenario: Checkbox sem evidência
- **WHEN** uma task está marcada mas não há execução aceita correspondente
- **THEN** esse checkbox não satisfaz o gate de conclusão

#### Scenario: Preparação incompleta
- **WHEN** uma unidade necessária falhou, foi invalidada ou aguarda autoridade
- **THEN** o LGO bloqueia archive e informa as condições pendentes

### Requirement: Aprender sem alterar produto silenciosamente
O Learning Engine SHALL produzir candidatos rastreáveis somente a partir de evidência validada e exigir promoção controlada antes de aplicar constraints futuras.

#### Scenario: Descoberta confirmada
- **WHEN** uma execução validada confirma que consumidores precisam ser revalidados após mudança de contrato
- **THEN** o engine propõe uma constraint aplicável ao planner com evidência e escopo
- **AND** não altera requisitos consolidados do OpenSpec

### Requirement: Manter interoperabilidade e observabilidade
O núcleo SHALL funcionar com adapter mock sem SDK proprietário e registrar eventos, tempos e decisões observados sem apresentar métricas simuladas como reais.

#### Scenario: Execução sem credenciais
- **WHEN** a demonstração usa somente mock e verificadores determinísticos
- **THEN** o runtime executa sem conta de fornecedor de LLM
- **AND** tokens e custos desconhecidos não são reportados como medição real
