# Activación automática de Premium (Lemon Squeezy → Firebase)

Cómo funciona el flujo completo:

1. El usuario toca un plan en el paywall → va al checkout de Lemon Squeezy
   llevando su `uid` de Firebase como dato custom.
2. Al pagar, Lemon Squeezy envía un evento (webhook) a la Cloud Function `lsWebhook`.
3. La función verifica la firma, lee el `uid` y escribe `premium: true`
   en `usuarios/{uid}` de Firestore.
4. La app lee ese flag al iniciar sesión y desbloquea las funciones Premium.
5. Si la suscripción expira o falla el cobro definitivamente, el webhook
   escribe `premium: false`.

## Configuración (una sola vez)

### 1. Subir Firebase al plan Blaze

- https://console.firebase.google.com → proyecto **training-95b4c** →
  ⚙️ Configuración → Uso y facturación → Plan Blaze (pago por uso).
- A la escala actual el costo mensual real es $0 (el nivel gratuito cubre
  2 millones de invocaciones/mes).

### 2. Desplegar la función

En una terminal, dentro de la carpeta del proyecto:

```bash
npm install -g firebase-tools
firebase login
cd functions && npm install && cd ..
firebase deploy --only functions
```

Al final imprime la URL de la función, algo como:
`https://lswebhook-XXXXX-uc.a.run.app`
(cópiala, se usa en el paso 4).

### 3. Crear el secreto de firma

```bash
firebase functions:secrets:set LS_WEBHOOK_SECRET
```

Escribe una cadena aleatoria larga (por ejemplo genera una con
`openssl rand -hex 32`). Guárdala: es la misma que va en Lemon Squeezy.
Después de crear el secreto, vuelve a desplegar: `firebase deploy --only functions`.

### 4. Configurar el webhook en Lemon Squeezy

- https://app.lemonsqueezy.com → **Settings → Webhooks → +**
- **Callback URL**: la URL de la función (paso 2)
- **Signing secret**: la cadena del paso 3
- **Eventos**: marcar
  - `subscription_created`
  - `subscription_updated`
  - `subscription_cancelled`
  - `subscription_resumed`
  - `subscription_expired`
  - `subscription_unpaused`
  - `subscription_payment_success`

### 5. Probar en modo test (¡nunca con tarjeta real!)

- En Lemon Squeezy activa el interruptor **Test mode** (esquina inferior
  izquierda del dashboard).
- Los productos y webhooks de test mode son independientes: crea el webhook
  también en test mode (misma URL y secreto) y verifica los IDs de las
  variantes de test (pueden diferir de `LS_VARIANTS` en `index.html`).
- Haz una compra desde la app con la tarjeta de prueba `4242 4242 4242 4242`
  (cualquier fecha futura y CVC).
- Verifica en Firestore que `usuarios/{tu-uid}` tenga `premium: true`,
  y en la app (recargar) que el badge ⭐ desaparezca y se desbloquee todo.

## Notas

- La app carga el flag premium al iniciar sesión (`cargarPremium`). Tras
  pagar, hay que recargar la app para ver Premium activo.
- Compras hechas fuera de la app (sin `uid` custom) se ignoran con un
  warning en los logs de la función.
- Logs de la función: `firebase functions:log` o en la consola de
  Google Cloud.
