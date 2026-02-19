# Fichas Online Multiplayer (JS puro + Firebase Auth/RTDB)

Este ZIP vem com **uma pasta única** `fichas-online/` (top-level), pronta para você jogar no GitHub.

## Setup rápido
1) Firebase Console → Authentication → habilite **Anonymous**  
2) Firebase Console → Realtime Database → crie e cole `database.rules.json` em Rules  
3) Edite `js/firebase.js` e preencha `FIREBASE_CONFIG`  
4) Rode local com Live Server (VSCode) abrindo `index.html`  
5) Deploy no GitHub Pages:
- se você colocar os arquivos **na raiz do repo**, selecione Pages = root
- se você manter a pasta `fichas-online/` dentro do repo, a opção mais simples é mover o conteúdo dela pra raiz do repo (ou usar /docs)

## O que está incluído (versão mínima)
- Login (nome + roomCode) → cria sala e GM / entra como player
- Ficha(s): criar/deletar fichas, editar nome/notas/autoSum, atributos QI/FOR/DEX/VIG, rolagem 1d12
- Imagem: salvar dataBase64 por arquivo (resize/compress) ou colar data URL
- Mental: value numérico
- Logs: feed /rolls (append-only)
- Mesa(GM): lista players e fichas + controla image.width/height/fit + deletar ficha

Obs: Import/Grupos/Vantagens/Itens completos podem ser recolocados depois.
