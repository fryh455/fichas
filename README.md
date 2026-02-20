# Fichas Online (MVP) — Firebase Auth + RTDB (GitHub Pages)

Projeto **100% HTML/CSS/JS puro**, sem bundler. Funciona via Live Server abrindo `index.html` na raiz.

## Estrutura

- `/index.html`
- `/app/gm.html`
- `/app/player.html`
- `/app/app.css`
- `/app/app.js` (único JS para as 3 páginas)
- `/app/firebase.js` (init + exports)
- `/database.rules.json`
- `/README.md`

## Setup Firebase (passo a passo)

1) Crie um projeto no Firebase Console.  
2) Authentication → **Sign-in method** → habilite **Anonymous**.  
3) Realtime Database → crie uma instância (modo bloqueado pode ser usado; você vai colar as rules abaixo).  
4) Database → Rules → cole o conteúdo de `database.rules.json` e publique.  
5) Edite `/app/firebase.js` e preencha `firebaseConfig` (já vem preenchido no ZIP).

## Rodar local

- VSCode → extensão **Live Server**
- Abra a pasta do projeto e rode o Live Server na raiz.
- Acesse `http://127.0.0.1:5500/index.html` (ou similar).

## Deploy no GitHub Pages

1) Suba o repositório com estes arquivos.
2) Settings → Pages:
   - **Branch**: `main` (ou `master`)
   - **Folder**: `/ (root)`
3) Aguarde a URL do Pages ficar disponível.

> Observação: este projeto usa imports ES Modules do Firebase via CDN. GitHub Pages serve isso normalmente.

## Checklist de testes (RTDB)

1) Criar mesa
2) Entrar na mesa
3) GM criar ficha
4) GM atribuir ficha
5) Player visualizar ficha
6) Player rolar atributo com grau e mental
7) Player rolar dados soltos
8) Import JSON (MERGE / CREATE-ONLY)

## Formato do import (GM) — novo modelo

```json
{
  "sheets":[
    {
      "name":"Nome",
      "sheetId":"opcional (se vier, vira slug final após normalização)",
      "attributes":{"QI":1,"FOR":1,"DEX":1,"VIG":1},
      "mental":0,
      "items":[
        {"name":"Espada","type":"ATIVA","atributoBase":"FOR","modMode":"SOMA","modValue":2,"notes":"..."}
      ],
      "advantages":[
        {"name":"Foco","type":"PASSIVA","atributoBase":null,"modMode":"MULT","modValue":0.5,"usesCurrent":null,"usesMax":null,"notes":null}
      ],
      "disadvantages":[
        {"name":"Ferimento","type":"PASSIVA","atributoBase":null,"modMode":"SOMA","modValue":-2,"notes":"..."}
      ]
    }
  ]
}
```

Regras:
- `sheetId` final = `slugify(name)` por padrão (ou slugify(sheetId) se vier).
- Conflitos:
  - `MERGE`: sobrescreve/merge no slug final.
  - `CREATE-ONLY`: cria novo slug com sufixo `-2`, `-3`...
- Arrays de itens/vantagens/desvantagens podem ser convertidos para objetos no RTDB.
