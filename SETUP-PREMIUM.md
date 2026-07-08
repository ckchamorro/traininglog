# Activación automática de Premium (Lemon Squeezy → Firebase)

Modelo de negocio: **pago único** ($14.99, "Premium para siempre").

Cómo funciona el flujo completo:

1. El usuario toca el botón del paywall → va al checkout de Lemon Squeezy
   llevando su `uid` de Firebase como dato custom.
2. Al pagar, Lemon Squeezy envía el evento `order_created` (webhook) a la
   Cloud Function `lsWebhook`.
3. La función verifica la firma, lee el `uid` y escribe `premium: true`
   en `usuarios/{uid}` de Firestore — para siempre.
4. La app lee ese flag al iniciar sesión y desbloquea las funciones Premium.
5. Solo un reembolso (`order_refunded`) revierte el flag a `false`.

## Configuración (una sola vez)

### 1. Crear el producto de pago único en Lemon Squeezy (modo live)

- Test mode APAGADO → Store → Products → **+ New product**
- Nombre: `Training Log Premium`, precio **Single payment / $14.99**
- **Publish**
- Botón **Share** → copiar el link de compra
  (`https://ckc.lemonsqueezy.com/checkout/buy/<uuid>`) y poner ese UUID
  en `LS_PRODUCT_UUID` de `index.html`.

### 2. Subir Firebase al plan Blaze

- https://console.firebase.google.com → proyecto **training-95b4c** →
  ⚙️ Configuración → Uso y facturación → Plan Blaze (pago por uso).
- A la escala actual el costo mensual real es $0.

### 3. Desplegar la función

```bash
npm install -g firebase-tools
firebase login
cd functions && npm install && cd ..
firebase deploy --only functions
```

Al final imprime la URL de la función (algo como
`https://lswebhook-XXXXX-uc.a.run.app`) — se usa en el paso 5.

### 4. Crear el secreto de firma

```bash
openssl rand -hex 32                            # genera la cadena; guárdala
firebase functions:secrets:set LS_WEBHOOK_SECRET # pégala cuando la pida
firebase deploy --only functions                 # re-desplegar para que la tome
```

### 5. Configurar el webhook en Lemon Squeezy

- https://app.lemonsqueezy.com → **Settings → Webhooks → +**
- **Callback URL**: la URL de la función (paso 3)
- **Signing secret**: la cadena del paso 4
- **Eventos**: marcar solo
  - `order_created`
  - `order_refunded`

### 6. Probar en modo test (¡nunca con tarjeta real!)

- Activa **Test mode** en el dashboard (interruptor abajo a la izquierda).
- Test mode tiene catálogo y webhooks separados: crea ahí un producto de
  pago único de prueba y el mismo webhook (misma URL y secreto).
- Para que la app apunte al producto de test durante la prueba, reemplaza
  temporalmente `LS_PRODUCT_UUID` (o pruébalo pegando el link de test con
  `?checkout[custom][uid]=<tu-uid>` directo en el navegador).
- Paga con la tarjeta de prueba `4242 4242 4242 4242` (fecha futura, CVC
  cualquiera).
- Verifica en Firestore que `usuarios/{uid}` tenga `premium: true` y en la
  app (recargar) que el badge ⭐ desaparezca y se desbloquee todo.

## Notas

- La app carga el flag premium al iniciar sesión (`cargarPremium`). Tras
  pagar, hay que recargar la app para ver Premium activo.
- Compras sin `uid` custom (hechas fuera de la app) se ignoran con un
  warning en los logs.
- Logs de la función: `firebase functions:log`.
