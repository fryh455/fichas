# Fichas Online (MVP)

## Setup Firebase
1. Crie um projeto no Firebase Console.
2. Authentication → Sign-in method → habilite **Anonymous**.
3. Realtime Database → crie em modo bloqueado.
4. Rules → cole o conteúdo de `database.rules.json`.
5. Em `/app/firebase.js`, preencha `firebaseConfig` (já está preenchido neste zip).

## Rodar local
- Abra a pasta no VS Code
- Use **Live Server** apontando para a raiz (onde está `index.html`).

## Deploy GitHub Pages
- Suba o repo para o GitHub
- Settings → Pages → Deploy from a branch → selecione branch e `/ (root)`
- Aguarde o Pages publicar.

## Checklist
- Criar mesa com roomCode
- Entrar como player com o mesmo roomCode
- GM criar ficha e atribuir ao player
- Player vê ficha e rola atributos
- GM e Player editam o campo **Anotações compartilhadas** e ambos veem sincronizado
