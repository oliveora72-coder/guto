# KageSync Site

Site oficial do KageSync conectado ao Firebase `space-chat-73e54` e preparado para hospedagem na Vercel.

## Ativação obrigatória do Firebase

O site pode ser publicado pela Vercel sem configuração extra, mas cadastro, keys, mensagens e controles do Admin só conseguem gravar dados depois que o Firebase estiver liberado.

1. No Firebase Authentication, ative **E-mail/senha** e **Google**.
2. Em Authentication → Settings → Authorized domains, adicione o domínio publicado pela Vercel.
3. No Firebase Console, abra **Realtime Database → Regras**, substitua o conteúdo pelo arquivo `database.rules.json` deste projeto e clique em **Publicar**.
4. Como alternativa, publique as regras pela Firebase CLI:

   ```bash
   firebase login
   firebase use space-chat-73e54
   firebase deploy --only database
   ```

5. Ative ou crie a conta com o e-mail administrador `oliveora72@gmail.com`.
6. Entre em `/admin` para configurar Discord, gerar keys e controlar avisos/atualizações.

Se o painel mostrar **“Firebase ainda bloqueado”**, a interface está funcionando, mas as regras acima ainda não foram publicadas no projeto `space-chat-73e54`. A Vercel não consegue publicar as regras do Realtime Database automaticamente.

## Rotas

- `/` — página pública
- `/login` — cadastro e entrada
- `/app` — painel do usuário e resgate de key
- `/admin` — painel administrativo protegido por conta Firebase

As keys são armazenadas pelo hash SHA-256. Cada key nasce com limite de um dispositivo, que será aplicado pelo aplicativo Android na integração seguinte.
