# Undead Historic — servidor multiplayer (base gratuita)

Este pacote prepara o servidor de salas para o modo cooperativo online de 2 jogadores. Ele cria salas com codigo de 6 caracteres, permite que o segundo jogador entre e retransmite estados pequenos dos jogadores por WebSocket.

**Importante:** esta e a infraestrutura inicial de rede, nao a implementacao completa do cooperativo dentro do jogo. O HTML atual ainda precisa ser ligado a este protocolo e os sistemas de jogo compartilhados (inimigos, chefes, dano, itens, transicoes de mapa e ondas) precisam ser sincronizados antes de chamar o multiplayer de jogavel. O modo single-player deve continuar separado e inalterado.

## Protocolo disponivel

Cliente -> servidor:
- `{"type":"create-room"}`
- `{"type":"join-room","code":"ABC234"}`
- `{"type":"player-state","state":{"x":100,"y":200,"z":0,"face":1,"state":"run","t":0.2,"scene":"city","hp":100}}`
- `{"type":"ping"}`

Servidor -> cliente:
- `room-created`, `room-joined`
- `peer-joined`, `peer-left`, `room-status`
- `peer-state`
- `error`

O endpoint HTTP `/health` responde com JSON para verificacao do servico.

## Testar localmente

Requer Node.js 20 ou superior.

```bash
npm install
npm start
```

O servidor abre em `http://localhost:10000` e aceita WebSocket em `ws://localhost:10000`.

## Publicar gratuitamente no Render

1. Crie uma conta no GitHub e um repositorio novo, por exemplo `undead-historic-multiplayer`.
2. Envie para esse repositorio os arquivos desta pasta (`server.js`, `package.json`, `render.yaml` e `.gitignore`).
3. Crie uma conta no Render e escolha **New + > Blueprint**.
4. Conecte o repositorio do GitHub. O Render detecta o `render.yaml`; confirme o servico no plano **Free**.
5. Depois do deploy, abra a URL gerada pelo Render. A rota `/health` deve mostrar `{"ok":true,...}`.
6. Para o jogo usar o servidor, o cliente deve conectar no endereco WebSocket seguro `wss://NOME-DO-SERVICO.onrender.com` (substitua pelo dominio real do seu servico).

## Limites do plano gratuito

No Render Free, o servico pode dormir depois de 15 minutos sem trafego e a primeira conexao depois disso pode demorar cerca de um minuto para acordar. O servico tambem pode reiniciar; as salas sao temporarias e desaparecem quando o processo reinicia. E adequado para testes entre amigos, nao para disponibilidade garantida.

## Seguranca e limites

- Salas aceitam no maximo 2 conexoes.
- Codigos sao temporarios e gerados aleatoriamente.
- O servidor nao grava contas, senhas ou progresso.
- Este e um prototipo: antes de publicar amplamente, adicionar validacao de mensagens mais rigorosa, reconexao e protecao contra abuso.
