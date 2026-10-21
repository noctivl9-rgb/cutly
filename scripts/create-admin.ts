// Crée (ou réinitialise) un compte d'administration.
// Usage : npm run admin:create -- email@domaine.fr "mot de passe long" [superadmin|author]
import { openDatabase } from '../src/db.ts';
import { createAdmin } from '../src/auth.ts';

const [email, password, role = 'superadmin'] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage : npm run admin:create -- email@domaine.fr "mot de passe (12 caractères min.)" [superadmin|author]');
  process.exit(1);
}
const db = await openDatabase();
try {
  await createAdmin(db, email, password, role === 'author' ? 'author' : 'superadmin');
  console.log(`Compte ${email} (${role}) prêt.`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await db.close();
}
