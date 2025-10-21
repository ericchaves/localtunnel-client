# HTTP Request/Response Inspection

Este documento explica como usar os novos recursos de debug para inspecionar requisições e respostas HTTP entre o servidor localtunnel e sua aplicação local.

## Recursos

Dois novos níveis de debug foram implementados:

- **`localtunnel:inspect:request`**: Inspeciona requisições HTTP recebidas do servidor do localtunnel
- **`localtunnel:inspect:response`**: Inspeciona respostas HTTP da sua aplicação local

## Uso

### Ativar Inspeção de Requests

```bash
DEBUG=localtunnel:inspect:request lt --port 3000
```

### Ativar Inspeção de Responses

```bash
DEBUG=localtunnel:inspect:response lt --port 3000
```

### Ativar Ambos

```bash
DEBUG=localtunnel:inspect:* lt --port 3000
```

### Combinar com Outros Debugs

```bash
DEBUG=localtunnel:*,localtunnel:inspect:* lt --port 3000
```

## Tipos de Conteúdo

O sistema detecta automaticamente o tipo de conteúdo e formata adequadamente:

### 1. JSON (`application/json`, `application/*+json`)

- Exibe o body completo formatado com indentação
- Exemplo:

```
BODY:
{
  "name": "John Doe",
  "email": "john@example.com"
}
```

### 2. XML (`application/xml`, `text/xml`, `application/*+xml`)

- Exibe preview do body limitado ao tamanho configurado
- Mostra tamanho real calculado
- Exemplo:

```
BODY INFO:
  Content-Type: application/xml
  Content-Length (header): 255
  Actual Body Size: 255 bytes
  Category: xml

BODY:
<?xml version="1.0"?><root><item>data</item></root>
... [truncated, total: 255 bytes]
```

### 3. Texto (`text/*`)

- Exibe preview do body limitado ao tamanho configurado
- Mostra tamanho real calculado
- Exemplo:

```
BODY INFO:
  Content-Type: text/plain
  Content-Length (header): 570
  Actual Body Size: 570 bytes
  Category: text

BODY:
Lorem ipsum dolor sit amet...
... [truncated, total: 570 bytes]
```

### 4. Binário (images, vídeos, PDFs, etc.)

- NÃO exibe o conteúdo (evita lixo no console)
- Mostra apenas headers e tamanho
- Exemplo:

```
BODY INFO:
  Content-Type: image/png
  Content-Length (header): 1024
  Actual Body Size: 1024 bytes
  Category: binary

BODY:
[binary content - 1024 bytes]
```

## Configuração

### Variável de Ambiente: `INSPECT_BODY_PREVIEW_SIZE`

Controla o tamanho máximo (em bytes) do preview exibido para conteúdos de texto e XML.

**Padrão**: 500 bytes

**Uso**:

```bash
INSPECT_BODY_PREVIEW_SIZE=1000 DEBUG=localtunnel:inspect:* lt --port 3000
```

## Informações Exibidas

Para cada requisição/resposta, o sistema exibe:

### Headers
- Todos os headers HTTP parseados
- Primeira linha (request line ou status line)

### Body Info
- **Content-Type**: Tipo de conteúdo informado no header
- **Content-Length (header)**: Tamanho informado no header Content-Length
- **Actual Body Size**: Tamanho real calculado do body (para dupla checagem)
- **Category**: Categoria detectada (json, xml, text, binary)

### Body
- Conteúdo formatado conforme o tipo (ver seção "Tipos de Conteúdo")

## Exemplo de Saída Completa

```
================================================================================
REQUEST: POST /api/users HTTP/1.1
================================================================================
HEADERS:
  host: example.com
  content-type: application/json
  content-length: 45
  accept: application/json
  user-agent: curl/7.68.0

BODY INFO:
  Content-Type: application/json
  Content-Length (header): 45
  Actual Body Size: 45 bytes
  Category: json

BODY:
{
  "name": "John Doe",
  "email": "john@example.com"
}
================================================================================
```

## Performance

- **Zero overhead** quando os debugs não estão habilitados
- Os dados são bufferizados apenas até que os headers completos sejam recebidos
- Após exibir os dados, o buffer é liberado para economizar memória

## Casos de Uso

### Debugging de APIs

```bash
DEBUG=localtunnel:inspect:* lt --port 8080
```

Útil para verificar:
- Se os headers estão sendo transmitidos corretamente
- Se o payload JSON está completo
- Diferenças entre Content-Length e tamanho real

### Debugging de Aplicações Web

```bash
DEBUG=localtunnel:inspect:response lt --port 3000
```

Útil para verificar:
- Respostas HTML geradas
- Headers de cache
- Status codes

### Auditoria de Segurança

```bash
DEBUG=localtunnel:inspect:request lt --port 443
```

Útil para verificar:
- Headers de autenticação
- Tokens enviados
- Dados sensíveis em transit

## Testes

Execute os scripts de teste incluídos na pasta `scripts/`:

```bash
# Teste básico com vários tipos de conteúdo
node scripts/test-debug.js

# Teste de configuração de preview size
node scripts/test-preview-size.js
```

## Limitações

1. Apenas a primeira parte do body é capturada (até que os headers sejam completamente recebidos)
2. Para bodies muito grandes em modo streaming, apenas a parte inicial será exibida
3. Conteúdo binário não é decodificado (propositalmente, para evitar corromper o console)

## Troubleshooting

### Não vejo nenhuma saída de debug

Verifique se a variável DEBUG está configurada corretamente:

```bash
# Teste se o debug está funcionando
DEBUG=* lt --port 3000
```

### Preview está sendo truncado muito cedo

Aumente o tamanho do preview:

```bash
INSPECT_BODY_PREVIEW_SIZE=2000 DEBUG=localtunnel:inspect:* lt --port 3000
```

### JSON não está sendo formatado

Verifique se o Content-Type está correto. O sistema procura por:
- `application/json`
- `application/*+json` (ex: `application/vnd.api+json`)
