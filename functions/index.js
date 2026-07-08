const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();

// Secreto compartido con Lemon Squeezy (Settings → Webhooks → Signing secret)
// Se configura con: firebase functions:secrets:set LS_WEBHOOK_SECRET
const LS_WEBHOOK_SECRET = defineSecret('LS_WEBHOOK_SECRET');

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

  // Modelo de pago único: la compra activa Premium para siempre;
  // solo un reembolso lo revierte.
  let premium;
  switch (evento) {
    case 'order_created':
      premium = attrs.status === 'paid';
      break;
    case 'order_refunded':
      premium = false;
      break;
    default:
      res.status(200).send(`Evento ignorado: ${evento}`);
      return;
  }

  await admin.firestore().doc(`usuarios/${uid}`).set(
    {
      premium,
      lsOrderId: String(req.body?.data?.id || ''),
      lsOrderStatus: attrs.status || null,
      lsCustomerId: String(attrs.customer_id || ''),
      premiumUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log(`${evento} → usuarios/${uid} premium=${premium} (status=${attrs.status})`);
  res.status(200).send('OK');
});
