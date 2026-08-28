# KageSync Site

Site oficial do KageSync conectado ao Firebase `space-chat-73e54` e preparado para hospedagem na Vercel.

## Ativação inicial

1. No Firebase Authentication, ative **E-mail/senha** e **Google**.
2. Em Authentication → Settings → Authorized domains, adicione o domínio publicado pela Vercel.
3. Publique `database.rules.json` no Realtime Database:

   ```bash
   firebase deploy --only database
   ```

4. Crie a primeira conta com o e-mail administrador `oliveora72@gmail.com`.
5. Entre em `/admin` para configurar Discord, gerar keys e controlar avisos/atualizações.

## Rotas

- `/` — página pública
- `/login` — cadastro e entrada
- `/app` — painel do usuário e resgate de key
- `/admin` — painel administrativo protegido por conta Firebase

As keys são armazenadas pelo hash SHA-256. Cada key nasce com limite de um dispositivo, que será aplicado pelo aplicativo Android na integração seguinte.
