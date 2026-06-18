// VAPID-Schlüssel für Web-Push erzeugen. EINMALIG ausführen, dann die
// ausgegebenen Werte in .env (lokal) bzw. in den Render-Umgebungsvariablen
// hinterlegen. Niemals den Private Key committen.
//
//   node scripts/gen-vapid.mjs
import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();
console.log("VAPID_PUBLIC_KEY=" + keys.publicKey);
console.log("VAPID_PRIVATE_KEY=" + keys.privateKey);
console.log('VAPID_SUBJECT="mailto:dispatch@taxilive.app"');
