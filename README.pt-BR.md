# discord-orbs

[English](README.md) · **Português**

Completa as missões (quests) no aplicativo oficial do Discord para Windows e Linux.

## Instalar (jeito mais fácil)

1. Entre em [Releases](https://github.com/devbluen/discord-auto-quest/releases/latest) e baixe o `discord-orbs.exe`.
2. Abra o arquivo. Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações** → **Executar assim mesmo** (o exe não é assinado).
3. Digite `1` (Install / update) e aperte Enter, depois `Y` para reiniciar o Discord.
4. No Discord, abra a página de **Missões**. Um painel aparece no canto inferior direito e começa a trabalhar.

Para remover: abra o exe de novo e escolha `2` (Uninstall).

## Linux

Use o Discord oficial para desktop. Instale Node.js 22 ou mais novo, baixe `discord-orbs-linux.tar.gz` em [Releases](https://github.com/devbluen/discord-auto-quest/releases/latest) e extraia o arquivo. Dentro da pasta `discord-auto-quest`, rode `node src/cli.cjs install`. Feche o Discord por completo e abra de novo. Para missões de jogos, instale Wine e ative **Auto game** no painel; o pacote inclui um exe pequeno que roda fora da tela. Para remover o patch, rode `node src/cli.cjs uninstall` e reinicie o Discord.

## Gerar o exe você mesmo

Use este caminho se preferir não rodar um exe gerado por outra pessoa.

1. Instale o [Git](https://git-scm.com/download/win) e o [Node.js 22 ou mais novo](https://nodejs.org/) (botão "LTS"). Pode deixar as opções padrão.
2. Abra o **PowerShell** (menu Iniciar → digite `PowerShell`) e rode, uma linha por vez:

   ```
   git clone https://github.com/devbluen/discord-auto-quest.git
   cd discord-auto-quest
   npm install
   npm run build
   ```

3. O exe fica em `discord-auto-quest\dist\discord-orbs.exe` (dentro da sua pasta de usuário, ex.: `C:\Users\<você>\`). Abra e siga os passos 2 a 4 de [Instalar](#instalar-jeito-mais-fácil).

Para atualizar depois, rode dentro da pasta `discord-auto-quest`:

```
git pull
npm install
npm run build
```

e abra o exe novo (`1`, Install / update).

## Como funciona

- Aceita sozinho as missões que consegue completar (botão **Auto-accept** no painel).
- Ordem: primeiro as que dão mais orbs por minuto restante, depois as sem orbs, das mais curtas para as mais longas.
- O painel mostra a fila, o progresso e os erros. Os botões são **Check now** (verificar agora), **Pause** (pausar), **Copy report** (copiar relatório) e **Claim** (abre a página de missões para resgatar a recompensa).
- Uma bolinha vermelha no painel (mesmo minimizado) conta as recompensas prontas para resgatar; passe o mouse para ver o total de orbs.
- Notificações na área de trabalho quando uma missão termina, falha ou quando a fila inteira acaba. Clicar numa delas abre a página de missões. Ligue/desligue em **Notifications** no painel.
- Quando o Discord atualiza, o script se reaplica sozinho na versão nova se ela já estiver baixada quando o Discord fechar. Se o painel sumir depois de uma atualização, abra o exe e instale de novo.

| Tipo | Como |
| --- | --- |
| `WATCH_VIDEO` / `WATCH_VIDEO_ON_MOBILE` | envia o progresso do vídeo respeitando o limite de tempo do servidor |
| `PLAY_ON_DESKTOP` | no Discord oficial para Windows, finge o processo do jogo; no Discord oficial para Linux, acompanha um jogo detectado pelo Discord |
| `PLAY_ACTIVITY` | manda um heartbeat a cada 20 s usando uma DM ou canal de voz |

Não suportados: `STREAM_ON_DESKTOP` (exige uma live real com outra pessoa na call) e missões de conquista.

## Deu problema?

Clique em **Copy report** no painel e cole numa nova [issue](https://github.com/devbluen/discord-auto-quest/issues). O relatório tem dados das missões e o seu ID de usuário do Discord, nunca o seu token.

## Desenvolvimento

- `npm run autostart` instala apontando direto para o `src/` deste repositório, então qualquer mudança vale com Ctrl+R no Discord. `npm run autostart:remove` remove e `npm run status` mostra o estado.
- `npm run check` verifica a sintaxe de todos os arquivos.
- O `discord-orbs.exe` também aceita argumentos: `install|uninstall|status [--yes]`.
- As releases são publicadas pelo workflow **Release**, que só roda manualmente: Actions → Release → Run workflow, com uma tag como `v1.0.0`.

| Arquivo | Papel |
| --- | --- |
| `src/quests.js` | Roda dentro da janela do Discord: acha os módulos internos, aceita e completa as missões, desenha o painel |
| `src/inject.cjs` | Carregado pelo processo principal do Discord; injeta o `quests.js` na janela e reaplica o patch depois de atualizações |
| `src/patcher.cjs` | Acha as instalações do Discord e adiciona/remove a linha no `discord_desktop_core/index.js` que carrega o `inject.cjs` |
| `src/cli.cjs` | Instalador (menu e comandos); é o ponto de entrada do exe |
| `scripts/build.js` | Gera o exe como Node single executable application |
| `.github/workflows/release.yml` | Workflow manual que gera o exe e publica uma release |

## Segurança

- Não lê nem envia seu token: as requisições passam pelo cliente HTTP interno do Discord, só para `discord.com`.
- Sem porta de debug e sem baixar código de fora.
- Cada release vem com um checksum `discord-orbs.exe.sha256`; o exe é gerado pelo GitHub Actions a partir do código público.

**Isso viola os Termos do Discord.** A conta pode ter as missões suspensas ou ser banida. Use por sua conta e risco.
