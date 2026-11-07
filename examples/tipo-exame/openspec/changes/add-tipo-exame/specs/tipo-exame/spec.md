## ADDED Requirements
### Requirement: CRUD REST
O sistema SHALL cadastrar codigo e nome, listar, consultar, alterar e excluir TipoExame por REST.
#### Scenario: Cadastro válido
- **WHEN** POST /api/tipos-exame recebe codigo e nome não vazios
- **THEN** retorna HTTP 201 com o registro criado
#### Scenario: Recurso inexistente
- **WHEN** GET /api/tipos-exame/inexistente é executado
- **THEN** retorna HTTP 404
#### Scenario: Alteração e exclusão
- **WHEN** um registro existente é atualizado e depois excluído
- **THEN** PUT retorna 200, DELETE retorna 204 e a consulta seguinte retorna 404
#### Scenario: Código duplicado
- **WHEN** o mesmo codigo é cadastrado novamente
- **THEN** retorna HTTP 409

### Requirement: Formulário
O frontend SHALL oferecer operações CRUD com componentes Angular/PrimeNG e validação dos campos.
#### Scenario: Formulário incompleto
- **WHEN** codigo ou nome está vazio
- **THEN** o envio fica desabilitado

### Requirement: Contrato
A implementação SHALL manter contrato OpenAPI com os códigos HTTP observáveis.
#### Scenario: Consulta contratada
- **WHEN** o contrato é inspecionado
- **THEN** GET por codigo declara 200 e 404

### Requirement: Segurança
O exemplo SHALL limitar o servidor a loopback, validar entradas e impedir exposição de stacktrace HTTP.
#### Scenario: Dados inválidos
- **WHEN** codigo ou nome é vazio
- **THEN** POST retorna HTTP 400
#### Scenario: Exposição limitada
- **WHEN** o servidor inicia com a configuração fornecida
- **THEN** escuta apenas 127.0.0.1 e não inclui stacktraces nas respostas

### Requirement: Integração
A entrega SHALL executar verificadores de backend, frontend e contrato antes da aceitação.
#### Scenario: Integração reprovada
- **WHEN** qualquer verificador retorna código não zero
- **THEN** a mudança não pode ser aceita nem preparada para arquivamento
