# Perfil local do operador: workspace e Gmail no MCP

O entrypoint padrão `scripts/agent-mcp.mjs` continua offline. O perfil opcional
usa `scripts/agent-operator.mjs --config CAMINHO_ABSOLUTO`: somente o operador
escolhe esse arquivo, a raiz de documentos e as mensagens permitidas. Nenhuma
toolcall, página, e-mail ou checkpoint pode fornecer configuração, módulos,
credenciais ou caminhos adicionais. O transporte continua sendo stdio local;
o cliente precisa suportá-lo. A LLM e seu fornecedor continuam à escolha do usuário.

## 1. Preparar o código e a pasta privada

Com Node.js 24, na pasta do código-fonte completo:

```powershell
npm ci
```

Crie uma pasta privada de documentos fora de checkouts Git. Copie o
[exemplo](../examples/operator-profile.json) para um arquivo privado **fora dessa
pasta de evidências**, ajuste a raiz e mantenha o perfil protegido pelas
permissões do sistema operacional. Exemplo de configuração do operador:

```json
{
  "version": 1,
  "workspaceRoot": "C:/TravelWorkspace/documents",
  "exposeWorkspaceNames": false
}
```

Salve, por exemplo, em `C:/TravelWorkspace/operator.json`. Somente IDs, hashes e
tamanhos dos documentos aparecem no MCP por padrão. Ativar
`exposeWorkspaceNames` também permite exibir nomes, caminhos relativos e a prévia
completa dos registros gerados; avalie antes o que será enviado à sua LLM.

## 2. Conferir o perfil sem rede

```powershell
node scripts/agent-operator.mjs --config "C:/TravelWorkspace/operator.json" --check
```

O check lê e valida o perfil e confere dependências locais, sem acessar Gmail,
ler corpos dos documentos ou gravar planos. `configured` significa configuração
local aceita, não autenticação de uma conta nem confirmação de reserva. Caminhos
e segredos não são impressos. Não inclua `--check` na configuração MCP: esse modo
encerra depois da conferência.

## 3. Conectar à sua IA

Nos clientes que adotem `mcpServers`, configure:

```json
{
  "mcpServers": {
    "travel-reliability": {
      "command": "node",
      "args": [
        "C:/Projects/travel-reliability/scripts/agent-operator.mjs",
        "--config",
        "C:/TravelWorkspace/operator.json"
      ]
    }
  }
}
```

Ajuste os dois caminhos absolutos. O wrapper independe do diretório corrente.
Use `node` diretamente; banners de `npm run` interferem no stdout JSON-RPC.
Reabra a conexão e peça `travel_workspace_inventory`. Depois, use
`travel_workspace_plan` com os IDs retornados. Isso prepara uma prévia, sem
salvar, aplicar, renomear ou aprovar arquivos. Para efeitos reais, use o
[CLI de organização](DOCUMENT_WORKSPACE.md), revise o plano privado e aprove seu
digest específico. Não há tool MCP de apply/rollback.

## 4. Habilitar Gmail explicitamente

Prepare primeiro o Python travado do projeto:

```powershell
uv sync --project ingest --locked
```

A normalização usa somente o interpretador absoluto preparado em `ingest/.venv`,
com `-I`, `-B`, diretório fixo e comunicação por pipes. Não procura Python no PATH,
não chama uv e não instala dependências durante a leitura. Sem esse runtime, o
perfil Gmail falha fechado com `EMAIL_RUNTIME_NOT_PREPARED`; workspace sem Gmail
não exige Python.

Acrescente ao JSON apenas seletores previamente autorizados. Este exemplo é
sintético; substitua o ID da mensagem pelo ID obtido pelo operador autorizado:

```json
{
  "version": 1,
  "workspaceRoot": "C:/TravelWorkspace/documents",
  "exposeWorkspaceNames": false,
  "gmail": {
    "maxReads": 8,
    "timeoutMs": 10000,
    "approvedScopes": [{ "tripKey": "demo-1", "recordKeys": ["R01"] }],
    "bindings": [
      {
        "tripKey": "demo-1",
        "recordKey": "R01",
        "messageId": "synthetic-message-id",
        "sourceRef": "SRC01",
        "providerKey": "synthetic-airline"
      }
    ]
  }
}
```

O processo precisa receber, por mecanismo seguro do operador, somente estas
variáveis fixas para as credenciais:

- `TRAVEL_GMAIL_ACCESS_TOKEN`: token OAuth autorizado para leitura das mensagens.
- `TRAVEL_REFERENCE_KEY_BASE64`: chave aleatória de 32–128 bytes, codificada em
  base64 padrão canônico, sem espaços ou quebras de linha.

**Não coloque valores de credenciais no JSON, argumentos de terminal, exemplos,
prints, prompts ou repositório.** O código não carrega `.env`. Configure o ambiente
do processo pelo gerenciador de segredos/host que utiliza; definir uma variável
em outro terminal não altera o ambiente de um aplicativo já aberto. O token é
capturado ao iniciar o servidor; sua atualização exige reiniciar a conexão.

Não há login automatizado, obtenção automática de token ou refresh token neste
perfil. A autorização e a verificação de aplicação exigidas pelo Google seguem a
[documentação oficial de escopos](https://developers.google.com/workspace/gmail/api/auth/scopes)
e o [contrato de leitura da mensagem](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get).

Cada binding deve corresponder exatamente a uma viagem e registro de
`approvedScopes`. Mensagens e `sourceRef` não podem ser duplicados; são permitidas
até vinte mensagens por viagem e oitenta no perfil. `providerKey` é obrigatório:
ele separa o domínio HMAC de cada fornecedor. Mantenha chave e fornecedor
consistentes ao comparar referências; mudar um deles muda os tokens derivados.
O código não infere fornecedor confiável a partir do remetente ou do corpo.

O cliente pode então chamar `travel_sync_sources` para `sourceId: "gmail"` e
somente os `tripKey`/`recordKeys` aprovados. O adaptador não procura toda a caixa,
envia, modifica ou exclui mensagens. A saída contém observações normalizadas;
conteúdo bruto, credenciais e localizadores não são retornados. Concordância
entre fontes e transporte autenticado não provam que uma reserva foi cumprida.

## Limites e falhas observáveis

O perfil deve ser um arquivo regular local, UTF-8 e JSON estrito, de até 64 KiB,
sem links simbólicos/junctions ou hardlinks. Campos adicionais, duplicação de
chaves JSON, prototypes, getters e módulos/URLs/interpretadores arbitrários são
rejeitados. A configuração não constitui um sandbox contra outro processo com
as mesmas permissões do sistema operacional: proteja perfil, checkout e venv
contra escrita por documentos, modelos e usuários não autorizados.

`maxReads` conta invocações de adaptador **por processo**, não todos os GETs,
tokens ou custos do host. Um batch Gmail pode fazer até vinte GETs e iniciar um
normalizador por mensagem; `timeoutMs` limita a espera da invocação. Reiniciar o
servidor reinicia o contador. Combine isso com quotas e limites reais do host/API.
O perfil não chama modelo nem oferece garantia percentual de economia de tokens.

Erros de perfil, token ausente, chave inválida, runtime não preparado ou escopo
indevido são devolvidos por códigos redigidos. Não existe fallback silencioso
que habilite acessos mais amplos. Nunca copie o perfil privado para a pasta de
documentos ou para a distribuição pública.

Os testes usam perfis TEMP sintéticos, transporte HTTP simulado, parser Python
local e cliente SDK MCP real. Não acessam uma conta Gmail real.
