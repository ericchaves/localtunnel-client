# Testando Conteúdo Binário com Localtunnel

Este guia mostra como testar o dump de conteúdo binário com o localtunnel client.

## Configuração Rápida

### 1. Inicie o servidor de teste Python

Em um terminal:

```bash
python3 test-binary-server.py
```

O servidor iniciará na porta 8000 e servirá:
- `/image.png` - Imagem PNG (extensão: `.png`)
- `/image.jpg` - Imagem JPEG (extensão: `.jpg`)
- `/document.pdf` - Documento PDF (extensão: `.pdf`)
- `/archive.zip` - Arquivo ZIP (extensão: `.zip`)

### 2. Inicie o localtunnel client

Em outro terminal:

```bash
# Com seu .env configurado
yarn start -- --port 8000

# Ou especificando as variáveis manualmente
yarn start -- --port 8000 --subdomain meu-teste
```

### 3. Teste os endpoints binários

```bash
# Testar PNG
curl https://seu-subdominio.lt.blu365.dev/image.png > /dev/null

# Testar JPEG
curl https://seu-subdominio.lt.blu365.dev/image.jpg > /dev/null

# Testar PDF
curl https://seu-subdominio.lt.blu365.dev/document.pdf > /dev/null

# Testar ZIP
curl https://seu-subdominio.lt.blu365.dev/archive.zip > /dev/null
```

### 4. Verifique os dumps gerados

```bash
ls -lh .dump/
```

Você deverá ver arquivos como:

```
pop-os.7389423774212296704.req.yaml     # Request YAML
pop-os.7389423774212296704.res.png      # Imagem PNG salva
pop-os.7389423774212296704.res.yaml     # Response YAML

pop-os.7389423774212296705.req.yaml
pop-os.7389423774212296705.res.jpg      # Imagem JPEG salva
pop-os.7389423774212296705.res.yaml

pop-os.7389423774212296706.req.yaml
pop-os.7389423774212296706.res.pdf      # PDF salvo
pop-os.7389423774212296706.res.yaml

pop-os.7389423774212296707.req.yaml
pop-os.7389423774212296707.res.zip      # ZIP salvo
pop-os.7389423774212296707.res.yaml
```

### 5. Verifique os YAMLs

```bash
# Ver o YAML da resposta
cat .dump/pop-os.7389423774212296704.res.yaml
```

O campo `body` deve conter uma referência ao arquivo externo:

```yaml
response:
  statusCode: 200
  headers:
    content-type:
      - image/png
    content-length:
      - "67"
  body: "{{file.contents(pop-os.7389423774212296704.res.png)}}"
```

### 6. Verifique o conteúdo binário salvo

```bash
# Verificar que o arquivo PNG é válido
file .dump/pop-os.7389423774212296704.res.png
# Saída esperada: PNG image data, 1 x 1, 8-bit/color RGB, non-interlaced

# Verificar que o PDF é válido
file .dump/pop-os.7389423774212296706.res.pdf
# Saída esperada: PDF document, version 1.4
```

## Logs Esperados

Com `DEBUG=localtunnel*`, você verá logs como:

```
localtunnel:inspector Saved binary content to: pop-os.7389423774212296704.res.png (67 bytes, type: image/png)
localtunnel:inspector Response dumped to: pop-os.7389423774212296704.res.yaml (234 bytes, path: .dump/)
```

## Extensões Suportadas

O sistema detecta automaticamente a extensão correta baseada no Content-Type:

| Content-Type | Extensão | Exemplo |
|--------------|----------|---------|
| `image/png` | `.png` | Imagens PNG |
| `image/jpeg` | `.jpg` | Imagens JPEG |
| `image/gif` | `.gif` | Imagens GIF |
| `image/webp` | `.webp` | Imagens WebP |
| `application/pdf` | `.pdf` | Documentos PDF |
| `application/zip` | `.zip` | Arquivos ZIP |
| `video/mp4` | `.mp4` | Vídeos MP4 |
| `audio/mp3` | `.mp3` | Áudio MP3 |
| `font/woff2` | `.woff2` | Fontes WOFF2 |
| *desconhecido* | `.bin` | Fallback genérico |

Para lista completa, veja `getFileExtension()` em `lib/HttpInspector.js`.

## Testando com Servidor Real

Você também pode testar com servidores reais:

```bash
# Testar com Next.js servindo imagens estáticas
yarn start -- --port 3000

# Acessar imagens do Next.js
curl https://seu-subdominio.lt.blu365.dev/_next/static/media/logo.png > /dev/null
```

## Troubleshooting

### Arquivo salvo como .bin ao invés da extensão correta

Verifique se o servidor está enviando o header `Content-Type` correto:

```bash
curl -I https://seu-subdominio.lt.blu365.dev/image.png
```

Deve conter: `Content-Type: image/png`

### Conteúdo binário aparece no YAML ao invés de referência externa

Isso acontece se o Content-Type indicar texto (como `text/plain`). Verifique os logs:

```
localtunnel:inspector Saved binary content to: ...
```

Se não aparecer, significa que `isBinaryContent()` não detectou como binário.
