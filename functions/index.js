const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

admin.initializeApp();

// Secreto compartido con Lemon Squeezy (Settings → Webhooks → Signing secret)
// Se configura con: firebase functions:secrets:set LS_WEBHOOK_SECRET
const LS_WEBHOOK_SECRET = defineSecret('LS_WEBHOOK_SECRET');

// Contraseña de aplicación de Gmail para enviar los avisos por correo.
// Se genera en la cuenta de Google (Seguridad → Contraseñas de aplicaciones,
// requiere verificación en dos pasos) y se guarda con:
//   firebase functions:secrets:set GMAIL_APP_PASSWORD
const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD');
const CORREO_DUENA = 'ckarem@gmail.com';

// Cada vez que un usuario deja un mensaje en la colección "mensajes",
// envía un aviso por correo a la dueña con el contenido.
exports.nuevoMensajeContacto = onDocumentCreated(
  { document: 'mensajes/{msgId}', secrets: [GMAIL_APP_PASSWORD] },
  async (event) => {
    const m = event.data?.data();
    if (!m) return;

    const transporte = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: CORREO_DUENA, pass: GMAIL_APP_PASSWORD.value() },
    });

    const cuerpo =
      'Nuevo mensaje desde Training Log\n\n' +
      `${m.mensaje || ''}\n\n` +
      '——\n' +
      `De: ${m.email || 'sin correo'}\n` +
      `Fecha: ${m.fecha || ''}\n` +
      `Versión: ${m.version || ''}\n` +
      `UID: ${m.uid || ''}`;

    try {
      await transporte.sendMail({
        from: `Training Log <${CORREO_DUENA}>`,
        to: CORREO_DUENA,
        replyTo: m.email || undefined,   // responder va directo al usuario
        subject: '📨 Nuevo mensaje de un usuario de Training Log',
        text: cuerpo,
      });
      console.log('Aviso de mensaje enviado por correo');
    } catch (e) {
      // El mensaje ya quedó guardado en Firestore; el correo es solo el aviso.
      console.error('No se pudo enviar el aviso por correo:', e);
    }
  }
);

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
