const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();

// Secreto compartido con Lemon Squeezy (Settings → Webhooks → Signing secret)
// Se configura con: firebase functions:secrets:set LS_WEBHOOK_SECRET
const LS_WEBHOOK_SECRET = defineSecret('LS_WEBHOOK_SECRET');

// Estados de suscripción que mantienen acceso Premium.
// past_due incluido: Lemon Squeezy reintenta el cobro varios días antes de expirar.
const ESTADOS_ACTIVOS = ['active', 'on_trial', 'past_due', 'cancelled'];

exports.lsWebhook = onRequest({ secrets: [LS_WEBHOOK_SECRET], cors: false }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  // Verificar firma HMAC-SHA256 del cuerpo crudo (header X-Signature)
  const firma = req.get('X-Signature') || '';
  const esperada = crypto
    .createHmac('sha256', LS_WEBHOOK_SECRET.value())
    .update(req.rawBody)
    .digest('hex');
  const valida =
    firma.length === esperada.length &&
    crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada));
  if (!valida) {
    console.warn('Firma inválida en webhook');
    res.status(401).send('Invalid signature');
    return;
  }

  const evento = req.body?.meta?.event_name;
  const uid = req.body?.meta?.custom_data?.uid;
  const attrs = req.body?.data?.attributes || {};

  if (!uid) {
    // Compra sin uid (p.ej. hecha fuera de la app): no hay usuario que activar.
    console.warn(`Evento ${evento} sin custom_data.uid — ignorado`);
    res.status(200).send('Sin uid; ignorado');
    return;
  }

  let premium;
  switch (evento) {
    case 'subscription_created':
    case 'subscription_updated':
    case 'subscription_resumed':
    case 'subscription_unpaused':
    case 'subscription_payment_success':
      premium = ESTADOS_ACTIVOS.includes(attrs.status);
      break;
    case 'subscription_cancelled':
      // Cancelar no corta el acceso: sigue Premium hasta fin del período pagado.
      // Lemon Squeezy enviará subscription_expired cuando realmente termine.
      premium = true;
      break;
    case 'subscription_expired':
      premium = false;
      break;
    default:
      res.status(200).send(`Evento ignorado: ${evento}`);
      return;
  }

  await admin.firestore().doc(`usuarios/${uid}`).set(
    {
      premium,
      lsStatus: attrs.status || null,
      lsSubscriptionId: String(req.body?.data?.id || ''),
      lsCustomerId: String(attrs.customer_id || ''),
      lsVariantId: String(attrs.variant_id || ''),
      lsRenewsAt: attrs.renews_at || null,
      lsEndsAt: attrs.ends_at || null,
      premiumUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log(`${evento} → usuarios/${uid} premium=${premium} (status=${attrs.status})`);
  res.status(200).send('OK');
});
